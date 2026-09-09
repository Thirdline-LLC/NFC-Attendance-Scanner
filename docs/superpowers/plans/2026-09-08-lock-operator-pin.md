# Teacher PIN gate — implementation plan (branch 2 of 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A student can run the desk (check-in, enroll) while everything that discloses or deletes records — the End Session overlay, `/roster`, `/dashboard` — sits behind a teacher PIN.

**Architecture:** A pure data module (`operator-pin.ts`) hashes and verifies a 4–8 digit PIN with PBKDF2 through Web Crypto, in the existing `settings` table, with a doubling lockout after five misses. An in-memory `OperatorLockProvider` inside the router holds one `unlocked` flag and relocks on navigation to `/`, on the summary closing, after five idle minutes, and on reload. One `PinDialog` serves three modes; `LockedRoute` wraps the two admin routes and mounts nothing until the unlock; the scanner gates its End Session button and shows a banner while no PIN exists.

**Tech Stack:** React, react-router-dom 7, Dexie 4, Web Crypto (`crypto.subtle`, PBKDF2-SHA-256), vitest + jsdom + fake-indexeddb + Testing Library (+ fake timers).

**Spec:** `docs/superpowers/specs/2026-09-08-ferpa-safe-kiosk-design.md`, section 1 ("The lock"), plus the *Teacher PIN* card and the copy table.

## Global Constraints

- Run from `artifacts/nfc-attendance-scanner/`; pnpm only. Tests `pnpm exec vitest run --config vitest.config.ts <file>`; suite `pnpm run test`; types `pnpm run typecheck`.
- No new Dexie version: the PIN lives in the existing `settings` table as rows `operator-pin` and `operator-pin-attempts`.
- The PIN is never logged, never stored in plain text, never in an activity row, never printed in an error.
- Copy is exactly the spec's table (repeated per task below). The dialog's test ids: `dialog-pin`, `text-pin-title`, `input-pin`, `input-pin-confirm`, `input-pin-current`, `button-pin-submit`, `button-pin-cancel`, `text-pin-error`, `text-pin-status`. The scanner banner: `text-pin-unset`. The locked shell: `locked-page`.
- **Enter is honoured only when ≥ 100 ms have passed since the previous keystroke** in a PIN field; non-digits are dropped; the field stops at 8. Tests therefore submit by clicking `button-pin-submit`, and exercise Enter only with fake timers.
- Branch `lock/operator-pin` from `main` at `f4b9e24` or later. Commit per task with the session's attribution trailer.

---

## File structure

| File | Responsibility |
|---|---|
| `src/data/attendance-store.ts` (modify) | `readSetting(key)`, `writeSetting(key, value)` — the two generic accessors the PIN module needs |
| `src/data/operator-pin.ts` (create) | PIN hashing, verification, lockout; `PinUnavailableError`, `OperatorPinExistsError` |
| `src/data/operator-pin.test.ts` (create) | every verdict, the lockout schedule, the two errors |
| `src/lock/pin-entry.ts` (create) | `digitsOnly`, `isHumanEnter`, `MIN_PAUSE_BEFORE_ENTER_MS` — the reader defence, pure |
| `src/lock/pin-entry.test.ts` (create) | those three |
| `src/lock/OperatorLockProvider.tsx` (create) | context, idle timer, `useOperatorLock`, `RelockOnScanner` |
| `src/lock/OperatorLockProvider.test.tsx` (create) | unlock/relock, idle, activity resets, relock on `/` |
| `src/lock/PinDialog.tsx` (create) | the one modal, three modes |
| `src/lock/PinDialog.test.tsx` (create) | set / unlock / change, errors, lockout countdown, reader burst, Escape |
| `src/lock/LockedRoute.tsx` (create) | the gate around a route |
| `src/app/AppRouter.tsx` (modify) | provider, `RelockOnScanner`, `LockedRoute` on two routes |
| `src/app/AppRouter.test.tsx` (modify) | gate behaviour end to end; existing cases pass the gate |
| `src/scanner/ScannerScreen.tsx` (modify) | End Session gate, capture off while the dialog is up, relock on summary close, lock glyph, unset banner |
| `src/scanner/ScannerScreen.test.tsx`, `ScannerScreen.browser.test.tsx` (modify) | gate cases; existing End Session cases pass the gate |
| `src/ui/Dashboard.tsx`, `src/dashboard/DashboardPage.tsx` (+ test) (modify) | the *Teacher PIN* card and the change flow |
| `.claude/skills/run-nfc-attendance-scanner/driver.mjs`, `SKILL.md` (modify) | PIN selectors and a note |

---

### Task 0: Branch

- [ ] `git checkout -b lock/operator-pin main` from the repo root; then in the app dir `pnpm run typecheck && pnpm run test` → clean, **469 passed**.

---

### Task 1: Settings accessors and the PIN module

**Files:** modify `src/data/attendance-store.ts` (after `setAttendanceTarget`); create `src/data/operator-pin.ts`, `src/data/operator-pin.test.ts`.

**Interfaces (produced):**

```ts
// attendance-store.ts
export async function readSetting(key: string): Promise<string | undefined>;
export async function writeSetting(key: string, value: string): Promise<void>;

// operator-pin.ts
export const PIN_MIN_LENGTH = 4;
export const PIN_MAX_LENGTH = 8;
export const LOCKOUT_AFTER_FAILURES = 5;
export class PinUnavailableError extends Error {}   // no crypto.subtle
export class OperatorPinExistsError extends Error {} // setOperatorPin on a device that has one
export type PinVerification =
  | { status: 'ok' }
  | { status: 'unset' }
  | { status: 'wrong'; failures: number; lockedUntil: string | null }
  | { status: 'locked'; lockedUntil: string };
export function isValidPin(pin: string): boolean;
export async function hasOperatorPin(): Promise<boolean>;
export async function setOperatorPin(pin: string): Promise<void>;
export async function verifyOperatorPin(pin: string, now?: Date): Promise<PinVerification>;
export async function changeOperatorPin(current: string, next: string, now?: Date): Promise<PinVerification>;
```

- [ ] **Step 1: failing tests** — `src/data/operator-pin.test.ts`:

```ts
import Dexie from 'dexie';
import { beforeEach, describe, expect, it } from 'vitest';
import { readSetting } from './attendance-store';
import {
  changeOperatorPin,
  hasOperatorPin,
  isValidPin,
  LOCKOUT_AFTER_FAILURES,
  OperatorPinExistsError,
  PinUnavailableError,
  setOperatorPin,
  verifyOperatorPin,
} from './operator-pin';

const DATABASE_NAME = 'attendance-scanner-local';
const T0 = new Date('2026-09-15T20:00:00.000Z');
const after = (ms: number) => new Date(T0.getTime() + ms);

describe('isValidPin', () => {
  it('accepts four to eight digits and nothing else', () => {
    expect(isValidPin('2468')).toBe(true);
    expect(isValidPin('24681357')).toBe(true);
    expect(isValidPin('246')).toBe(false);
    expect(isValidPin('246813579')).toBe(false);
    expect(isValidPin('24a8')).toBe(false);
    expect(isValidPin(' 2468')).toBe(false);
  });
});

describe('operator PIN', () => {
  beforeEach(async () => {
    localStorage.clear();
    await Dexie.delete(DATABASE_NAME);
  });

  it('is unset on a fresh device and verifies once set', async () => {
    expect(await hasOperatorPin()).toBe(false);
    expect(await verifyOperatorPin('2468', T0)).toEqual({ status: 'unset' });

    await setOperatorPin('2468');

    expect(await hasOperatorPin()).toBe(true);
    expect(await verifyOperatorPin('2468', T0)).toEqual({ status: 'ok' });
    expect(await verifyOperatorPin('0000', T0)).toEqual({
      status: 'wrong',
      failures: 1,
      lockedUntil: null,
    });
  });

  it('never stores the PIN itself', async () => {
    await setOperatorPin('2468');
    const stored = await readSetting('operator-pin');
    expect(stored).toBeDefined();
    expect(stored).not.toContain('2468');
    expect(JSON.parse(stored as string)).toMatchObject({
      v: 1,
      algorithm: 'PBKDF2-SHA-256',
      iterations: 100000,
    });
  });

  it('refuses to be set twice and refuses a malformed PIN', async () => {
    await expect(setOperatorPin('12')).rejects.toBeInstanceOf(RangeError);
    await setOperatorPin('2468');
    await expect(setOperatorPin('1357')).rejects.toBeInstanceOf(OperatorPinExistsError);
    expect(await verifyOperatorPin('2468', T0)).toEqual({ status: 'ok' });
  });

  it('changes only when the current PIN is right', async () => {
    await setOperatorPin('2468');

    expect(await changeOperatorPin('0000', '1357', T0)).toMatchObject({ status: 'wrong' });
    expect(await verifyOperatorPin('2468', T0)).toEqual({ status: 'ok' });

    expect(await changeOperatorPin('2468', '1357', T0)).toEqual({ status: 'ok' });
    expect(await verifyOperatorPin('1357', T0)).toEqual({ status: 'ok' });
    expect((await verifyOperatorPin('2468', T0)).status).toBe('wrong');
  });

  it('locks for 30 s after five misses, doubles, caps at five minutes, and clears on success', async () => {
    await setOperatorPin('2468');

    for (let miss = 1; miss < LOCKOUT_AFTER_FAILURES; miss += 1) {
      expect(await verifyOperatorPin('0000', T0)).toEqual({
        status: 'wrong',
        failures: miss,
        lockedUntil: null,
      });
    }
    expect(await verifyOperatorPin('0000', T0)).toEqual({
      status: 'wrong',
      failures: 5,
      lockedUntil: after(30_000).toISOString(),
    });
    // Locked means locked — the right PIN is not even checked.
    expect(await verifyOperatorPin('2468', after(10_000))).toEqual({
      status: 'locked',
      lockedUntil: after(30_000).toISOString(),
    });

    // Sixth miss, once the first lock has expired: a minute.
    expect(await verifyOperatorPin('0000', after(31_000))).toMatchObject({
      failures: 6,
      lockedUntil: after(31_000 + 60_000).toISOString(),
    });
    // Ninth miss would be 30 s × 2^4 = 480 s; the cap holds it at 300 s.
    let t = after(31_000 + 60_000 + 1000);
    for (let miss = 7; miss <= 8; miss += 1) {
      const verdict = await verifyOperatorPin('0000', t);
      expect(verdict.status).toBe('wrong');
      if (verdict.status === 'wrong') {
        t = new Date(Date.parse(verdict.lockedUntil as string) + 1000);
      }
    }
    const ninth = await verifyOperatorPin('0000', t);
    expect(ninth.status).toBe('wrong');
    if (ninth.status === 'wrong') {
      expect(Date.parse(ninth.lockedUntil as string) - t.getTime()).toBe(300_000);
      t = new Date(Date.parse(ninth.lockedUntil as string) + 1000);
    }

    expect(await verifyOperatorPin('2468', t)).toEqual({ status: 'ok' });
    expect(await verifyOperatorPin('0000', t)).toEqual({
      status: 'wrong',
      failures: 1,
      lockedUntil: null,
    });
  });

  it('treats an unreadable stored record as unset rather than locking the teacher out', async () => {
    const { writeSetting } = await import('./attendance-store');
    await writeSetting('operator-pin', '{not json');
    expect(await hasOperatorPin()).toBe(false);
    await setOperatorPin('2468');
    expect(await verifyOperatorPin('2468', T0)).toEqual({ status: 'ok' });
  });

  it('names the problem when Web Crypto is missing', async () => {
    const original = Object.getOwnPropertyDescriptor(globalThis.crypto, 'subtle');
    Object.defineProperty(globalThis.crypto, 'subtle', { value: undefined, configurable: true });
    try {
      await expect(setOperatorPin('2468')).rejects.toBeInstanceOf(PinUnavailableError);
    } finally {
      if (original) Object.defineProperty(globalThis.crypto, 'subtle', original);
      else delete (globalThis.crypto as { subtle?: unknown }).subtle;
    }
  });
});
```

- [ ] **Step 2:** run → FAIL (module missing).
- [ ] **Step 3: implement.** In `attendance-store.ts` after `setAttendanceTarget`:

```ts
/**
 * Raw access to the device settings table for modules that own a setting of
 * their own (the teacher PIN). Values are strings; callers encode.
 */
export async function readSetting(key: string): Promise<string | undefined> {
  return (await settingsTable.get(key))?.value;
}

export async function writeSetting(key: string, value: string): Promise<void> {
  await settingsTable.put({ key, value });
}
```

`src/data/operator-pin.ts`:

```ts
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

function fromBase64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
}

async function derive(pin: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const api = subtle();
  const key = await api.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await api.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
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
      typeof parsed === 'object' && parsed !== null &&
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
      failures: Number.isInteger(parsed.failures) ? (parsed.failures as number) : 0,
      lockedUntil: typeof parsed.lockedUntil === 'string' ? parsed.lockedUntil : null,
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
    throw new RangeError(`A PIN is ${PIN_MIN_LENGTH} to ${PIN_MAX_LENGTH} digits.`);
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
export async function verifyOperatorPin(pin: string, now: Date = new Date()): Promise<PinVerification> {
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
            Math.min(LOCKOUT_CAP_MS, LOCKOUT_BASE_MS * 2 ** (failures - LOCKOUT_AFTER_FAILURES)),
        ).toISOString()
      : null;
  await writeAttempts({ failures, lockedUntil });
  return { status: 'wrong', failures, lockedUntil };
}

/** Verifies `current` exactly as `verifyOperatorPin` does; writes `next` only on 'ok'. */
export async function changeOperatorPin(current: string, next: string, now: Date = new Date()): Promise<PinVerification> {
  const verdict = await verifyOperatorPin(current, now);
  if (verdict.status !== 'ok') return verdict;
  await storePin(next);
  return verdict;
}
```

- [ ] **Step 4:** run → all pass. **Step 5:** typecheck; commit `Add the teacher PIN: PBKDF2 in the settings table, with a doubling lockout`.

---

### Task 2: The reader defence, pure

**Files:** create `src/lock/pin-entry.ts`, `src/lock/pin-entry.test.ts`.

- [ ] **Step 1: tests**

```ts
import { describe, expect, it } from 'vitest';
import { digitsOnly, isHumanEnter, MIN_PAUSE_BEFORE_ENTER_MS } from './pin-entry';

describe('digitsOnly', () => {
  it('keeps digits, drops everything else, and stops at the PIN maximum', () => {
    expect(digitsOnly('2468')).toBe('2468');
    expect(digitsOnly('04A1B2C3D4E5F6')).toBe('04123456');
    expect(digitsOnly('123456789')).toBe('12345678');
    expect(digitsOnly('')).toBe('');
  });
});

describe('isHumanEnter', () => {
  it('honours Enter only after a pause a reader never makes', () => {
    expect(MIN_PAUSE_BEFORE_ENTER_MS).toBe(100);
    expect(isHumanEnter(null, 1000)).toBe(true);
    expect(isHumanEnter(1000, 1010)).toBe(false);
    expect(isHumanEnter(1000, 1099)).toBe(false);
    expect(isHumanEnter(1000, 1100)).toBe(true);
  });
});
```

- [ ] **Step 2:** FAIL. **Step 3:**

```ts
import { PIN_MAX_LENGTH } from '@/data/operator-pin';

/**
 * A person pauses before pressing Enter; a keyboard-wedge reader presses it
 * within about 10 ms of the last character. Anything faster than this is the
 * reader, and on a locked page the reader is typing into the PIN field.
 */
export const MIN_PAUSE_BEFORE_ENTER_MS = 100;

/** What a PIN field keeps of whatever was typed into it. */
export function digitsOnly(value: string): string {
  return value.replace(/[^0-9]/g, '').slice(0, PIN_MAX_LENGTH);
}

/** True when Enter arrived a human-length pause after the previous key. */
export function isHumanEnter(lastKeystrokeAt: number | null, enterAt: number): boolean {
  return lastKeystrokeAt === null || enterAt - lastKeystrokeAt >= MIN_PAUSE_BEFORE_ENTER_MS;
}
```

- [ ] **Step 4–5:** pass; commit `Tell a reader's Enter from a person's`.

---

### Task 3: The lock provider

**Files:** create `src/lock/OperatorLockProvider.tsx`, `src/lock/OperatorLockProvider.test.tsx`.

**Interfaces (produced):** `IDLE_RELOCK_MS = 300_000`; `OperatorLockProvider({ children, initiallyUnlocked? })`; `useOperatorLock(): { unlocked; unlock(); relock() }` (throws without a provider); `RelockOnScanner()` (renders null; needs a router).

- [ ] **Step 1: tests**

```tsx
import { act, cleanup, renderHook, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import {
  IDLE_RELOCK_MS,
  OperatorLockProvider,
  RelockOnScanner,
  useOperatorLock,
} from './OperatorLockProvider';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const wrapper = ({ children }: { children: ReactNode }) => (
  <OperatorLockProvider>{children}</OperatorLockProvider>
);

describe('OperatorLockProvider', () => {
  it('starts locked, unlocks, relocks', () => {
    const { result } = renderHook(() => useOperatorLock(), { wrapper });
    expect(result.current.unlocked).toBe(false);
    act(() => result.current.unlock());
    expect(result.current.unlocked).toBe(true);
    act(() => result.current.relock());
    expect(result.current.unlocked).toBe(false);
  });

  it('throws without a provider, so a missing one is a build error not a silent open door', () => {
    expect(() => renderHook(() => useOperatorLock())).toThrow(/OperatorLockProvider/);
  });

  it('relocks after five idle minutes, and any key or tap restarts the clock', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useOperatorLock(), { wrapper });
    act(() => result.current.unlock());

    act(() => vi.advanceTimersByTime(IDLE_RELOCK_MS - 60_000));
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' })));
    act(() => vi.advanceTimersByTime(IDLE_RELOCK_MS - 60_000));
    expect(result.current.unlocked).toBe(true);

    act(() => vi.advanceTimersByTime(60_000));
    expect(result.current.unlocked).toBe(false);
  });

  it('relocks when the location becomes the scanner', async () => {
    function Probe() {
      const { unlocked, unlock } = useOperatorLock();
      const navigate = useNavigate();
      return (
        <>
          <span data-testid="state">{unlocked ? 'open' : 'locked'}</span>
          <button onClick={unlock}>unlock</button>
          <button onClick={() => navigate('/')}>home</button>
        </>
      );
    }
    render(
      <MemoryRouter initialEntries={['/roster']}>
        <OperatorLockProvider>
          <RelockOnScanner />
          <Routes>
            <Route path="*" element={<Probe />} />
          </Routes>
        </OperatorLockProvider>
      </MemoryRouter>,
    );
    act(() => screen.getByText('unlock').click());
    expect(screen.getByTestId('state').textContent).toBe('open');
    act(() => screen.getByText('home').click());
    expect(screen.getByTestId('state').textContent).toBe('locked');
  });
});
```

- [ ] **Step 2:** FAIL. **Step 3:**

```tsx
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useLocation } from 'react-router-dom';

/** Five minutes without a key or a tap and the teacher is assumed gone. */
export const IDLE_RELOCK_MS = 5 * 60_000;

type OperatorLock = {
  unlocked: boolean;
  unlock: () => void;
  relock: () => void;
};

const OperatorLockContext = createContext<OperatorLock | null>(null);

/**
 * One in-memory flag: whether the teacher has unlocked this device since the
 * page loaded. Deliberately not persisted — a reload is locked, and so is a
 * tab the teacher walked away from. `initiallyUnlocked` exists for tests of
 * screens that are not about the lock.
 */
export function OperatorLockProvider({
  children,
  initiallyUnlocked = false,
}: {
  children: ReactNode;
  initiallyUnlocked?: boolean;
}) {
  const [unlocked, setUnlocked] = useState(initiallyUnlocked);
  const unlock = useCallback(() => setUnlocked(true), []);
  const relock = useCallback(() => setUnlocked(false), []);

  useEffect(() => {
    if (!unlocked) return;
    let timer = window.setTimeout(relock, IDLE_RELOCK_MS);
    const restart = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(relock, IDLE_RELOCK_MS);
    };
    window.addEventListener('pointerdown', restart);
    window.addEventListener('keydown', restart);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('pointerdown', restart);
      window.removeEventListener('keydown', restart);
    };
  }, [unlocked, relock]);

  const value = useMemo(() => ({ unlocked, unlock, relock }), [unlocked, unlock, relock]);
  return <OperatorLockContext.Provider value={value}>{children}</OperatorLockContext.Provider>;
}

export function useOperatorLock(): OperatorLock {
  const lock = useContext(OperatorLockContext);
  if (!lock) {
    throw new Error('useOperatorLock needs an OperatorLockProvider above it.');
  }
  return lock;
}

/**
 * Relocks whenever the location becomes the scanner. Mounted inside the
 * router: leaving an admin page is the teacher handing the device back.
 */
export function RelockOnScanner() {
  const { pathname } = useLocation();
  const { relock } = useOperatorLock();
  useEffect(() => {
    if (pathname === '/') relock();
  }, [pathname, relock]);
  return null;
}
```

- [ ] **Step 4–5:** pass; commit `Hold the teacher's unlock in memory, and drop it on idle or on the way back to the desk`.

---

### Task 4: The PIN dialog

**Files:** create `src/lock/PinDialog.tsx`, `src/lock/PinDialog.test.tsx`.

**Interfaces (produced):**

```ts
type PinDialogProps =
  | { mode: 'gate'; onUnlocked: () => void; onCancel: () => void }
  | { mode: 'change'; onChanged: () => void; onCancel: () => void };
export function PinDialog(props: PinDialogProps): JSX.Element;
```

**Copy (verbatim):** titles *Set a teacher PIN* / *Enter the teacher PIN* / *Change the teacher PIN*; set helper *4 to 8 digits. Only the teacher should know it — it opens the roster, the dashboard and exports. There is no way to recover a forgotten PIN: write it down somewhere safe.*; errors *That PIN is not right.* / *Too many tries — wait {n} seconds.* / *The PINs do not match.* / *This device isn't letting the app read its settings.* / *This device cannot secure a PIN — open the app from its installed or https address.*; status while reading *Checking this device…*.

- [ ] **Step 1: tests** (`src/lock/PinDialog.test.tsx`)

```tsx
import Dexie from 'dexie';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as attendanceStore from '@/data/attendance-store';
import * as operatorPin from '@/data/operator-pin';
import { setOperatorPin, verifyOperatorPin } from '@/data/operator-pin';
import { PinDialog } from './PinDialog';

const DATABASE_NAME = 'attendance-scanner-local';

describe('PinDialog', () => {
  beforeEach(async () => {
    localStorage.clear();
    await Dexie.delete(DATABASE_NAME);
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('asks to set a PIN on a device that has none, twice, and records it', async () => {
    const onUnlocked = vi.fn();
    const record = vi.spyOn(attendanceStore, 'recordActivity').mockResolvedValue();
    const user = userEvent.setup();
    render(<PinDialog mode="gate" onUnlocked={onUnlocked} onCancel={() => {}} />);

    expect((await screen.findByTestId('text-pin-title')).textContent).toBe('Set a teacher PIN');
    expect(screen.getByTestId('dialog-pin').textContent).toContain('no way to recover');

    await user.type(screen.getByTestId('input-pin'), '2468');
    await user.type(screen.getByTestId('input-pin-confirm'), '2469');
    await user.click(screen.getByTestId('button-pin-submit'));
    expect(screen.getByTestId('text-pin-error').textContent).toBe('The PINs do not match.');
    expect(onUnlocked).not.toHaveBeenCalled();

    await user.clear(screen.getByTestId('input-pin-confirm'));
    await user.type(screen.getByTestId('input-pin-confirm'), '2468');
    await user.click(screen.getByTestId('button-pin-submit'));

    await waitFor(() => expect(onUnlocked).toHaveBeenCalledTimes(1));
    expect(await verifyOperatorPin('2468')).toEqual({ status: 'ok' });
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ kind: 'pin-set' }));
    expect(JSON.stringify(record.mock.calls[0][0])).not.toContain('2468');
  });

  it('unlocks with the right PIN and names a wrong one without saying which digits', async () => {
    await setOperatorPin('2468');
    const onUnlocked = vi.fn();
    const user = userEvent.setup();
    render(<PinDialog mode="gate" onUnlocked={onUnlocked} onCancel={() => {}} />);

    expect((await screen.findByTestId('text-pin-title')).textContent).toBe('Enter the teacher PIN');
    expect(screen.queryByTestId('input-pin-confirm')).toBeNull();

    await user.type(screen.getByTestId('input-pin'), '0000');
    await user.click(screen.getByTestId('button-pin-submit'));
    expect((await screen.findByTestId('text-pin-error')).textContent).toBe('That PIN is not right.');
    expect((screen.getByTestId('input-pin') as HTMLInputElement).value).toBe('');

    await user.type(screen.getByTestId('input-pin'), '2468');
    await user.click(screen.getByTestId('button-pin-submit'));
    await waitFor(() => expect(onUnlocked).toHaveBeenCalledTimes(1));
  });

  it('counts down a lockout and refuses even the right PIN meanwhile', async () => {
    await setOperatorPin('2468');
    for (let miss = 0; miss < 5; miss += 1) await verifyOperatorPin('0000');
    const onUnlocked = vi.fn();
    const user = userEvent.setup();
    render(<PinDialog mode="gate" onUnlocked={onUnlocked} onCancel={() => {}} />);

    await user.type(await screen.findByTestId('input-pin'), '2468');
    await user.click(screen.getByTestId('button-pin-submit'));

    const error = await screen.findByTestId('text-pin-error');
    expect(error.textContent).toMatch(/^Too many tries — wait \d+ seconds\.$/);
    expect(onUnlocked).not.toHaveBeenCalled();
  });

  it('ignores a card tapped into the field: digits only, at most eight, and no submit', async () => {
    await setOperatorPin('2468');
    const verify = vi.spyOn(operatorPin, 'verifyOperatorPin');
    const user = userEvent.setup();
    render(<PinDialog mode="gate" onUnlocked={() => {}} onCancel={() => {}} />);

    const field = (await screen.findByTestId('input-pin')) as HTMLInputElement;
    await user.type(field, '04A1B2C3D4E5F6{Enter}');

    expect(field.value).toBe('04123456');
    expect(verify).not.toHaveBeenCalled();
    expect(screen.queryByTestId('text-pin-error')).toBeNull();
  });

  it('honours Enter after a human pause', async () => {
    await setOperatorPin('2468');
    vi.useFakeTimers();
    const onUnlocked = vi.fn();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<PinDialog mode="gate" onUnlocked={onUnlocked} onCancel={() => {}} />);

    const field = await screen.findByTestId('input-pin');
    await user.type(field, '2468');
    await act(async () => {
      vi.advanceTimersByTime(150);
    });
    await user.type(field, '{Enter}');

    await waitFor(() => expect(onUnlocked).toHaveBeenCalledTimes(1));
  });

  it('changes the PIN only with the current one, and records the change', async () => {
    await setOperatorPin('2468');
    const onChanged = vi.fn();
    const record = vi.spyOn(attendanceStore, 'recordActivity').mockResolvedValue();
    const user = userEvent.setup();
    render(<PinDialog mode="change" onChanged={onChanged} onCancel={() => {}} />);

    expect((await screen.findByTestId('text-pin-title')).textContent).toBe('Change the teacher PIN');
    await user.type(screen.getByTestId('input-pin-current'), '0000');
    await user.type(screen.getByTestId('input-pin'), '1357');
    await user.type(screen.getByTestId('input-pin-confirm'), '1357');
    await user.click(screen.getByTestId('button-pin-submit'));
    expect((await screen.findByTestId('text-pin-error')).textContent).toBe('That PIN is not right.');

    await user.type(screen.getByTestId('input-pin-current'), '2468');
    await user.click(screen.getByTestId('button-pin-submit'));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(await verifyOperatorPin('1357')).toEqual({ status: 'ok' });
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ kind: 'pin-changed' }));
  });

  it('cancels on Escape and on the button', async () => {
    await setOperatorPin('2468');
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(<PinDialog mode="gate" onUnlocked={() => {}} onCancel={onCancel} />);
    await screen.findByTestId('input-pin');

    await user.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledTimes(1);
    await user.click(screen.getByTestId('button-pin-cancel'));
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it('says when the settings cannot be read, and retries', async () => {
    const has = vi
      .spyOn(operatorPin, 'hasOperatorPin')
      .mockRejectedValueOnce(new Error('closed'))
      .mockResolvedValueOnce(false);
    const user = userEvent.setup();
    render(<PinDialog mode="gate" onUnlocked={() => {}} onCancel={() => {}} />);

    expect((await screen.findByTestId('text-pin-error')).textContent).toBe(
      "This device isn't letting the app read its settings.",
    );
    await user.click(screen.getByTestId('button-pin-retry'));
    expect((await screen.findByTestId('text-pin-title')).textContent).toBe('Set a teacher PIN');
    expect(has).toHaveBeenCalledTimes(2);
  });

  it('names the missing Web Crypto rather than crashing', async () => {
    vi.spyOn(operatorPin, 'hasOperatorPin').mockResolvedValue(false);
    vi.spyOn(operatorPin, 'setOperatorPin').mockRejectedValue(new operatorPin.PinUnavailableError());
    const user = userEvent.setup();
    render(<PinDialog mode="gate" onUnlocked={() => {}} onCancel={() => {}} />);

    await user.type(await screen.findByTestId('input-pin'), '2468');
    await user.type(screen.getByTestId('input-pin-confirm'), '2468');
    await user.click(screen.getByTestId('button-pin-submit'));

    expect((await screen.findByTestId('text-pin-error')).textContent).toBe(
      'This device cannot secure a PIN — open the app from its installed or https address.',
    );
  });
});
```

- [ ] **Step 2:** FAIL. **Step 3: implement** `src/lock/PinDialog.tsx` — state `phase: 'checking' | 'storage-error' | 'set' | 'unlock' | 'change'`, `fields: { current, pin, confirm }`, `error: string | null`, `lockedUntil: string | null`, `busy`. On mount in gate mode call `hasOperatorPin()` → `'set'`/`'unlock'`; a throw → `'storage-error'` with a Retry button (`button-pin-retry`) that re-runs it. In change mode phase is `'change'` immediately. Each field is a `PinField` — `<input type="password" inputMode="numeric" pattern="[0-9]*" autoComplete="off" maxLength={PIN_MAX_LENGTH}>` whose `onChange` applies `digitsOnly`, whose `onKeyDown` stamps `lastKeystrokeAt` for non-Enter keys and, for Enter, calls `event.preventDefault()` and submits only when `isHumanEnter(lastKeystrokeAt, Date.now())`. Submit: set → mismatch error, else `setOperatorPin(pin)` then best-effort `recordActivity({ at, kind: 'pin-set' })` then `onUnlocked()`; unlock → `verifyOperatorPin(pin)`: `ok` → `onUnlocked()`; `wrong` → error *That PIN is not right.* and clear the field (if `lockedUntil` came back, show the countdown instead); `locked` → countdown; `unset` → switch phase to `'set'`; change → mismatch check, then `changeOperatorPin(current, next)`, same verdict handling, `ok` → `recordActivity({ kind: 'pin-changed' })` best-effort then `onChanged()`. Any `PinUnavailableError` → the Web Crypto text; any other throw → the settings text. The countdown: a 1 s interval while `lockedUntil` is in the future renders `Too many tries — wait ${Math.max(1, Math.ceil((Date.parse(lockedUntil) - Date.now()) / 1000))} seconds.` and clears when it passes. Focus: first visible field on mount; `useModalFocusTrap(dialogRef)`; Escape on `window` → `onCancel`; restore the previously focused element on unmount, as `NewSessionDialog` does. Markup follows `NewSessionDialog`: fixed overlay, `role="dialog"`, `aria-modal`, `aria-labelledby` the title, `data-testid="dialog-pin"`. Submit button disabled while `busy` or while the primary field is not a valid PIN.

- [ ] **Step 4–5:** all pass; commit `One dialog for the teacher PIN: set, unlock, change — and deaf to a card reader`.

---

### Task 5: The gate on the two admin routes

**Files:** create `src/lock/LockedRoute.tsx`; modify `src/app/AppRouter.tsx`, `src/app/AppRouter.test.tsx`.

- [ ] **Step 1: tests.** In `AppRouter.test.tsx` add `import { setOperatorPin } from '@/data/operator-pin';` and `within` from Testing Library; a helper:

```tsx
/** Types the teacher PIN into the gate and submits by button. */
async function passGate(user: ReturnType<typeof userEvent.setup>, pin = '2468') {
  const dialog = await screen.findByTestId('dialog-pin');
  await user.type(within(dialog).getByTestId('input-pin'), pin);
  await user.click(within(dialog).getByTestId('button-pin-submit'));
  await waitFor(() => expect(screen.queryByTestId('dialog-pin')).toBeNull());
}
```

In the `AppRouter` describe's `beforeEach`, after the delete: `await setOperatorPin('2468');`. Then update the existing cases: after every `renderAt('/roster')` / `renderAt('/dashboard')` / click on `link-roster` or `link-dashboard` **from the scanner**, insert `await passGate(user)` (creating `user` where the test has none) before asserting the page. `crosses between the two admin pages` passes the gate once at `/roster` only — the dashboard must then open without a second prompt; assert `screen.queryByTestId('dialog-pin')` is null after clicking `link-dashboard`. Add:

```tsx
  it('shows the gate and mounts nothing until the teacher unlocks', async () => {
    const user = userEvent.setup();
    renderAt('/roster');

    expect(await screen.findByTestId('locked-page')).toBeTruthy();
    expect(screen.getByTestId('text-scans-paused')).toBeTruthy();
    expect(screen.queryByTestId('roster-manager')).toBeNull();

    await passGate(user);
    expect(await screen.findByTestId('roster-manager')).toBeTruthy();
  });

  it('returns to the scanner when the gate is cancelled', async () => {
    const user = userEvent.setup();
    renderAt('/dashboard');
    await screen.findByTestId('dialog-pin');

    await user.click(screen.getByTestId('button-pin-cancel'));

    expect(await screen.findByTestId('scanner-station')).toBeTruthy();
    expect(window.location.pathname).toBe('/');
  });

  it('locks again once the teacher has gone back to the scanner', async () => {
    const user = userEvent.setup();
    renderAt('/roster');
    await passGate(user);
    await screen.findByTestId('roster-manager');

    await user.click(screen.getByTestId('link-scanner'));
    await screen.findByTestId('scanner-station');
    await user.click(screen.getByTestId('link-roster'));

    expect(await screen.findByTestId('dialog-pin')).toBeTruthy();
    expect(screen.queryByTestId('roster-manager')).toBeNull();
  });

  it('offers to set a PIN on a device that has none', async () => {
    await Dexie.delete('attendance-scanner-local');
    renderAt('/roster');
    expect((await screen.findByTestId('text-pin-title')).textContent).toBe('Set a teacher PIN');
  });
```

- [ ] **Step 2:** FAIL. **Step 3:** `src/lock/LockedRoute.tsx`:

```tsx
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { PinDialog } from '@/lock/PinDialog';
import { useOperatorLock } from '@/lock/OperatorLockProvider';
import { ScansPausedNotice } from '@/ui/ScansPausedNotice';

/**
 * The teacher's half of the app. Until the unlock, the page inside is not
 * mounted at all — no roster read, no history read — and the shell says the
 * one thing that is still true here: the reader is not recording.
 */
export function LockedRoute({ children }: { children: ReactNode }) {
  const { unlocked, unlock } = useOperatorLock();
  const navigate = useNavigate();

  if (unlocked) return <>{children}</>;

  return (
    <main
      className="grain relative min-h-[100dvh] overflow-hidden bg-[hsl(var(--background))]"
      data-testid="locked-page"
    >
      <div className="relative mx-auto flex w-full max-w-5xl flex-col gap-5 px-5 py-5 sm:px-8 sm:py-7">
        <ScansPausedNotice />
      </div>
      <PinDialog mode="gate" onUnlocked={unlock} onCancel={() => navigate('/')} />
    </main>
  );
}
```

`AppRouter.tsx`:

```tsx
import { OperatorLockProvider, RelockOnScanner } from '@/lock/OperatorLockProvider';
import { LockedRoute } from '@/lock/LockedRoute';
// ...
    <BrowserRouter basename={routerBasename(import.meta.env.BASE_URL)}>
      {/* One unlock per visit to the teacher's side; the way back to the
          scanner is the way the device is handed back, so it relocks there. */}
      <OperatorLockProvider>
        <RelockOnScanner />
        <Routes>
          <Route path="/" element={<ScannerScreen />} />
          <Route path="/roster" element={<LockedRoute><RosterPage /></LockedRoute>} />
          <Route path="/dashboard" element={<LockedRoute><DashboardPage /></LockedRoute>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </OperatorLockProvider>
    </BrowserRouter>
```

- [ ] **Step 4–5:** `AppRouter.test.tsx` green; typecheck; commit `Put the roster and the dashboard behind the teacher PIN`.

---

### Task 6: The scanner: End Session gated, banner, glyph

**Files:** modify `src/scanner/ScannerScreen.tsx`, `src/scanner/ScannerScreen.test.tsx`, `src/scanner/ScannerScreen.browser.test.tsx`.

- [ ] **Step 1: tests.** `renderScanner()` wraps in `<OperatorLockProvider>`; add the `passGate` helper from Task 5 (copy it — same body); every describe whose tests click `button-end-session` seeds `await setOperatorPin('2468')` in its `beforeEach` and calls `await passGate(user)` right after the click (lines ~151, 180, 326, 400, 507, 622, 709 today; the browser test at ~72 likewise — edit it by hand, it cannot run here). New describe:

```tsx
describe('ScannerScreen teacher gate', () => {
  beforeEach(async () => {
    localStorage.clear();
    await Dexie.delete('attendance-scanner-local');
    await addPerson(knownPerson);
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('asks for the PIN before the summary, and the summary follows the right PIN', async () => {
    await setOperatorPin('2468');
    const user = userEvent.setup();
    renderScanner();
    await screen.findByText('Tap to check in');

    await user.click(screen.getByTestId('button-end-session'));
    expect(await screen.findByTestId('dialog-pin')).toBeTruthy();
    expect(screen.queryByTestId('dialog-session-summary')).toBeNull();
    expect(screen.getByTestId('text-scanner-focus').textContent).toContain('Scanner off');

    await user.type(screen.getByTestId('input-pin'), '0000');
    await user.click(screen.getByTestId('button-pin-submit'));
    expect((await screen.findByTestId('text-pin-error')).textContent).toBe('That PIN is not right.');

    await passGate(user);
    expect(await screen.findByTestId('dialog-session-summary')).toBeTruthy();
  });

  it('drops a card tapped while the PIN dialog is up', async () => {
    await setOperatorPin('2468');
    const user = userEvent.setup();
    renderScanner();
    await screen.findByText('Tap to check in');
    await user.click(screen.getByTestId('button-end-session'));
    await screen.findByTestId('dialog-pin');

    await user.keyboard(`${knownUid}{Enter}`);

    expect(screen.getByTestId('text-attendance-count').textContent).toBe('0');
    expect(await listTapRecords()).toHaveLength(0);
  });

  it('locks again when the summary closes', async () => {
    await setOperatorPin('2468');
    const user = userEvent.setup();
    renderScanner();
    await screen.findByText('Tap to check in');
    await user.click(screen.getByTestId('button-end-session'));
    await passGate(user);
    await user.click(await screen.findByTestId('button-summary-dismiss'));

    await user.click(screen.getByTestId('button-end-session'));
    expect(await screen.findByTestId('dialog-pin')).toBeTruthy();
  });

  it('marks the admin links locked, and says so until a PIN exists', async () => {
    renderScanner();
    await screen.findByText('Tap to check in');
    expect(screen.getByTestId('text-pin-unset').textContent).toContain('No teacher PIN set');
    expect(screen.getByTestId('link-roster').getAttribute('aria-label')).toContain('teacher PIN required');

    const user = userEvent.setup();
    await user.click(screen.getByTestId('button-end-session'));
    await user.type(await screen.findByTestId('input-pin'), '2468');
    await user.type(screen.getByTestId('input-pin-confirm'), '2468');
    await user.click(screen.getByTestId('button-pin-submit'));

    await screen.findByTestId('dialog-session-summary');
    expect(screen.queryByTestId('text-pin-unset')).toBeNull();
  });
});
```

- [ ] **Step 2:** FAIL. **Step 3:** in `ScannerScreen.tsx`: import `Lock` from lucide, `PinDialog`, `useOperatorLock`, `hasOperatorPin`. State `const { unlocked, unlock, relock } = useOperatorLock(); const [pinOpen, setPinOpen] = useState(false); const [pinIsSet, setPinIsSet] = useState<boolean | null>(null);` with `useEffect(() => { void hasOperatorPin().then(setPinIsSet).catch(() => setPinIsSet(null)); }, []);`. Find the effect that computes `captureEnabled` from the open overlays (`grep -n setCaptureEnabled`) and add `pinOpen` to its condition. The End Session button: `onClick={() => (unlocked ? endSession() : setPinOpen(true))}`. Render, beside the other overlays: `{pinOpen && <PinDialog mode="gate" onUnlocked={() => { unlock(); setPinIsSet(true); setPinOpen(false); endSession(); }} onCancel={() => { setPinOpen(false); refocus(); }} />}` (refocus = the same `window.setTimeout(() => { if (captureEnabledRef.current) inputRef.current?.focus(); }, 0)` the other handlers use). `handleDismissSummary` calls `relock()` first; `handleConfirmNewSession` calls `relock()` after `await startNewSession()`. Header links: `aria-label={unlocked ? 'Students' : 'Students (teacher PIN required)'}` and `{!unlocked && <Lock aria-hidden="true" size={12} />}` — same for Dashboard. Banner, rendered above the main section when `pinIsSet === false`:

```tsx
        {pinIsSet === false && (
          <p
            className="station-enter mt-4 flex items-start gap-2.5 rounded-2xl border border-[hsl(var(--destructive)/.5)] bg-[hsl(var(--destructive)/.09)] px-4 py-3 text-sm text-[hsl(var(--destructive))]"
            role="status"
            data-testid="text-pin-unset"
          >
            <Lock aria-hidden="true" className="mt-0.5 shrink-0" size={16} />
            <span>
              <strong className="font-semibold">No teacher PIN set</strong> — the
              roster, dashboard and exports are open to anyone at this device. A
              teacher sets one from End Session or the Students page.
            </span>
          </p>
        )}
```

- [ ] **Step 4–5:** scanner suite green; typecheck; commit `Gate End Session behind the teacher PIN, and say out loud when there is none`.

---

### Task 7: The Teacher PIN card

**Files:** modify `src/ui/Dashboard.tsx` (prop `onChangePin?: () => void`; a card after `ActivitySection`), `src/dashboard/DashboardPage.tsx` (state `changingPin`, `pinNotice`; renders `PinDialog mode="change"`), `src/dashboard/DashboardPage.test.tsx`.

- [ ] **Step 1: tests** (DashboardPage — render inside `OperatorLockProvider initiallyUnlocked`? No: `DashboardPage` does not read the lock; render as today):

```tsx
  it('changes the teacher PIN from the dashboard and logs it', async () => {
    await setOperatorPin('2468');
    await seedTwoSessions();
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByTestId('button-change-pin'));
    await user.type(await screen.findByTestId('input-pin-current'), '2468');
    await user.type(screen.getByTestId('input-pin'), '1357');
    await user.type(screen.getByTestId('input-pin-confirm'), '1357');
    await user.click(screen.getByTestId('button-pin-submit'));

    expect((await screen.findByTestId('text-pin-changed')).textContent).toContain('Teacher PIN changed');
    expect(await verifyOperatorPin('1357')).toEqual({ status: 'ok' });
    await waitFor(() =>
      expect(within(screen.getByTestId('list-activity')).getAllByRole('listitem')[0].textContent).toContain('Teacher PIN changed'),
    );
  });
```

- [ ] **Step 2–5:** implement — card:

```tsx
function TeacherPinCard({ onChangePin }: { onChangePin: () => void }) {
  return (
    <Card eyebrow="Teacher PIN" icon={<KeyRound aria-hidden="true" size={16} />}>
      <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]" data-testid="section-teacher-pin">
        Opens End Session, this page and the roster. A screen gate, not encryption — and there is no way to recover a forgotten PIN.
      </p>
      <button type="button" onClick={onChangePin} className={/* the refresh button's classes */} data-testid="button-change-pin">
        <KeyRound aria-hidden="true" size={14} />
        Change PIN
      </button>
    </Card>
  );
}
```

rendered when `onChangePin` is given. The page: `{changingPin && <PinDialog mode="change" onChanged={async () => { setChangingPin(false); setPinNotice('Teacher PIN changed.'); setActivity(await listActivity()); }} onCancel={() => setChangingPin(false)} />}` and a `role="status"` `<p data-testid="text-pin-changed">` for the notice. Commit `Let the teacher change the PIN from the dashboard`.

---

### Task 8: Driver selectors and the skill note

- [ ] Add to `SEL` in `driver.mjs`: `pinDialog: '[data-testid="dialog-pin"]', pinInput: '[data-testid="input-pin"]', pinConfirm: '[data-testid="input-pin-confirm"]', pinSubmit: '[data-testid="button-pin-submit"]'`, with a comment that End Session, `/roster` and `/dashboard` now sit behind the dialog and that a fresh database shows the *set* form (two fields). In `SKILL.md` add a short **Teacher PIN** section saying the same and that the smoke flow never meets it. Commit `Teach the driver where the teacher PIN dialog is`.

---

### Task 9: Whole suite, merge

- [ ] `pnpm run typecheck && pnpm run test` → clean, 469 + the new cases. `pnpm run test:browser` is not runnable here (no Chromium installed — noted 2026-09-08); say so in the merge message.
- [ ] From the repo root: `git checkout main && git merge --no-ff lock/operator-pin -m "Merge lock/operator-pin: …"`, re-run typecheck + suite on `main`, `git ls-remote origin refs/heads/main` to confirm nothing pushed. Do not push.
