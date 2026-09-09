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
