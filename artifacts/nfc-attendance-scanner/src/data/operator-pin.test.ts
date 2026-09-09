import Dexie from 'dexie';
import { beforeEach, describe, expect, it } from 'vitest';
import { readSetting, writeSetting } from './attendance-store';
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
    await expect(setOperatorPin('1357')).rejects.toBeInstanceOf(
      OperatorPinExistsError,
    );
    expect(await verifyOperatorPin('2468', T0)).toEqual({ status: 'ok' });
  });

  it('changes only when the current PIN is right', async () => {
    await setOperatorPin('2468');

    expect(await changeOperatorPin('0000', '1357', T0)).toMatchObject({
      status: 'wrong',
    });
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
    // Misses seven and eight double again; the ninth would be 30 s × 2^4 =
    // 480 s, and the cap holds it at 300 s.
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
      expect(ninth.failures).toBe(9);
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
    await writeSetting('operator-pin', '{not json');
    expect(await hasOperatorPin()).toBe(false);
    await setOperatorPin('2468');
    expect(await verifyOperatorPin('2468', T0)).toEqual({ status: 'ok' });
  });

  it('names the problem when Web Crypto is missing', async () => {
    const original = Object.getOwnPropertyDescriptor(globalThis.crypto, 'subtle');
    Object.defineProperty(globalThis.crypto, 'subtle', {
      value: undefined,
      configurable: true,
    });
    try {
      await expect(setOperatorPin('2468')).rejects.toBeInstanceOf(
        PinUnavailableError,
      );
    } finally {
      if (original) Object.defineProperty(globalThis.crypto, 'subtle', original);
      else delete (globalThis.crypto as { subtle?: unknown }).subtle;
    }
  });
});
