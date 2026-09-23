import { describe, it, expect } from 'vitest';
import { ThemePackSchema } from '../src/schema';
import { DEFAULT_THEME } from '../src/default-theme';
import { FORBIDDEN_THEME_FIELDS } from '../src/schema';

describe('ThemePackSchema', () => {
  it('accepts the bundled default theme', () => {
    const result = ThemePackSchema.safeParse(DEFAULT_THEME);
    expect(result.success).toBe(true);
  });

  it('rejects version 0 packs', () => {
    const bad = { ...DEFAULT_THEME, v: 0 };
    expect(ThemePackSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a pack missing required meta.id', () => {
    const bad = {
      ...DEFAULT_THEME,
      meta: { ...DEFAULT_THEME.meta, id: '' },
    };
    expect(ThemePackSchema.safeParse(bad).success).toBe(false);
  });

  it('accepts a pack with a placeholder unsigned signature (D-T1)', () => {
    const withSig = {
      ...DEFAULT_THEME,
      signature: {
        alg: 'ed25519',
        keyId: 'thirdline-theme-1',
        sig: 'UNSIGNED_DRAFT_FOR_REVIEW',
      },
    };
    const result = ThemePackSchema.safeParse(withSig);
    expect(result.success).toBe(true);
  });

  it('accepts a pack without a signature (pilot unsigned)', () => {
    const result = ThemePackSchema.safeParse(DEFAULT_THEME);
    expect(result.success).toBe(true);
  });

  it('rejects a pack with a signature whose alg is not ed25519', () => {
    const bad = {
      ...DEFAULT_THEME,
      signature: { alg: 'rsa', keyId: 'x', sig: 'abc' },
    };
    expect(ThemePackSchema.safeParse(bad).success).toBe(false);
  });
});

describe('FORBIDDEN_THEME_FIELDS', () => {
  it('includes privacy-critical field names', () => {
    expect(FORBIDDEN_THEME_FIELDS).toContain('members');
    expect(FORBIDDEN_THEME_FIELDS).toContain('taps');
    expect(FORBIDDEN_THEME_FIELDS).toContain('pin');
    expect(FORBIDDEN_THEME_FIELDS).toContain('emails');
  });
});
