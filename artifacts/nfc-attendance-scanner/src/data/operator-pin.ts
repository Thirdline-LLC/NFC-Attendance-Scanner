import { readSetting, writeSetting } from '@/data/attendance-store';

export const PIN_MIN_LENGTH = 4;
export const PIN_MAX_LENGTH = 8;
/** Misses before the first lock. */
export const LOCKOUT_AFTER_FAILURES = 5;

const PIN_KEY = 'operator-pin';
const ATTEMPTS_KEY = 'operator-pin-attempts';
const ITERATIONS = 100_000;
const LOCKOUT_BASE_MS = 30_000;
const LOCKOUT_CAP_MS = 5 * 60_000;
const PIN_PATTERN = new RegExp(`^[0-9]{${PIN_MIN_LENGTH},${PIN_MAX_LENGTH}}$`);

/** Web Crypto is missing: an insecure origin. Every shipped shell has it. */
export class PinUnavailableError extends Error {
  constructor() {
    super('This device cannot secure a PIN: Web Crypto is unavailable.');
    this.name = 'PinUnavailableError';
  }
}

/** `setOperatorPin` on a device that already has one; use `changeOperatorPin`. */
export class OperatorPinExistsError extends Error {
  constructor() {
    super('A teacher PIN is already set on this device.');
    this.name = 'OperatorPinExistsError';
  }
}

export type PinVerification =
  | { status: 'ok' }
  | { status: 'unset' }
  | { status: 'wrong'; failures: number; lockedUntil: string | null }
  | { status: 'locked'; lockedUntil: string };

type StoredPin = {
  v: 1;
  algorithm: 'PBKDF2-SHA-256';
  iterations: number;
  salt: string;
  hash: string;
};

type Attempts = { failures: number; lockedUntil: string | null };

export function isValidPin(pin: string): boolean {
  return PIN_PATTERN.test(pin);
}

function subtle(): SubtleCrypto {
  const api = globalThis.crypto?.subtle;
  if (!api) throw new PinUnavailableError();
  return api;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
}

async function derive(
  pin: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const api = subtle();
  const key = await api.importKey(
    'raw',
    new TextEncoder().encode(pin),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await api.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key,
    256,
  );
  return new Uint8Array(bits);
}

/** Compares every byte regardless of where the first difference is. */
function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= a[index] ^ b[index];
  return diff === 0;
}

/**
 * The stored record, or null when there is none — or when it cannot be read.
 * An unreadable row is treated as unset on purpose: anyone who can corrupt it
 * already has the whole database, and a teacher must never be locked out by
 * a row that no PIN could ever match.
 */
async function readStoredPin(): Promise<StoredPin | null> {
  const raw = await readSetting(PIN_KEY);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      (parsed as StoredPin).v === 1 &&
      typeof (parsed as StoredPin).salt === 'string' &&
      typeof (parsed as StoredPin).hash === 'string' &&
      Number.isInteger((parsed as StoredPin).iterations)
    ) {
      return parsed as StoredPin;
    }
  } catch {
    // Fall through: unreadable is unset.
  }
  return null;
}

async function readAttempts(): Promise<Attempts> {
  const raw = await readSetting(ATTEMPTS_KEY);
  if (!raw) return { failures: 0, lockedUntil: null };
  try {
    const parsed = JSON.parse(raw) as Partial<Attempts>;
    return {
      failures: Number.isInteger(parsed.failures)
        ? (parsed.failures as number)
        : 0,
      lockedUntil:
        typeof parsed.lockedUntil === 'string' ? parsed.lockedUntil : null,
    };
  } catch {
    return { failures: 0, lockedUntil: null };
  }
}

async function writeAttempts(attempts: Attempts): Promise<void> {
  await writeSetting(ATTEMPTS_KEY, JSON.stringify(attempts));
}

async function storePin(pin: string): Promise<void> {
  if (!isValidPin(pin)) {
    throw new RangeError(
      `A PIN is ${PIN_MIN_LENGTH} to ${PIN_MAX_LENGTH} digits.`,
    );
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(pin, salt, ITERATIONS);
  const record: StoredPin = {
    v: 1,
    algorithm: 'PBKDF2-SHA-256',
    iterations: ITERATIONS,
    salt: toBase64(salt),
    hash: toBase64(hash),
  };
  await writeSetting(PIN_KEY, JSON.stringify(record));
  await writeAttempts({ failures: 0, lockedUntil: null });
}

export async function hasOperatorPin(): Promise<boolean> {
  return (await readStoredPin()) !== null;
}

/** First run only: a device that has a PIN keeps it. */
export async function setOperatorPin(pin: string): Promise<void> {
  if (await hasOperatorPin()) throw new OperatorPinExistsError();
  await storePin(pin);
}

/**
 * A screen gate, not a cryptographic one: the lockout exists to stop casual
 * guessing at the desk. After five misses the door closes for 30 s, doubling
 * per further miss up to five minutes; a locked verdict is returned without
 * deriving anything, and a correct PIN clears the count.
 */
export async function verifyOperatorPin(
  pin: string,
  now: Date = new Date(),
): Promise<PinVerification> {
  const stored = await readStoredPin();
  if (!stored) return { status: 'unset' };

  const attempts = await readAttempts();
  if (attempts.lockedUntil && Date.parse(attempts.lockedUntil) > now.getTime()) {
    return { status: 'locked', lockedUntil: attempts.lockedUntil };
  }

  const hash = await derive(pin, fromBase64(stored.salt), stored.iterations);
  if (equalBytes(hash, fromBase64(stored.hash))) {
    await writeAttempts({ failures: 0, lockedUntil: null });
    return { status: 'ok' };
  }

  const failures = attempts.failures + 1;
  const lockedUntil =
    failures >= LOCKOUT_AFTER_FAILURES
      ? new Date(
          now.getTime() +
            Math.min(
              LOCKOUT_CAP_MS,
              LOCKOUT_BASE_MS * 2 ** (failures - LOCKOUT_AFTER_FAILURES),
            ),
        ).toISOString()
      : null;
  await writeAttempts({ failures, lockedUntil });
  return { status: 'wrong', failures, lockedUntil };
}

/** Verifies `current` exactly as `verifyOperatorPin` does; writes `next` only on 'ok'. */
export async function changeOperatorPin(
  current: string,
  next: string,
  now: Date = new Date(),
): Promise<PinVerification> {
  const verdict = await verifyOperatorPin(current, now);
  if (verdict.status !== 'ok') return verdict;
  await storePin(next);
  return verdict;
}
