import { describe, it, expect } from 'vitest';
import { loadThemePack } from '../src/loader';
import { DEFAULT_THEME } from '../src/default-theme';
import type { ThemePack } from '../src/schema';

const VALID_PACK: ThemePack = {
  ...DEFAULT_THEME,
  meta: { id: 'test-pack', orgName: 'Test Org', version: '1.0.0' },
};

describe('loadThemePack', () => {
  it('loads the default theme successfully', async () => {
    const result = await loadThemePack(JSON.stringify(DEFAULT_THEME));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.pack.meta.id).toBe('default');
      expect(result.warnings).toEqual([]);
    }
  });

  it('fails on invalid JSON', async () => {
    const result = await loadThemePack('not-json{{{');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/JSON/i);
      expect(result.fallback.meta.id).toBe('default');
    }
  });

  it('fails on schema validation error (missing meta.id)', async () => {
    const bad = { ...VALID_PACK, meta: { ...VALID_PACK.meta, id: '' } };
    const result = await loadThemePack(JSON.stringify(bad));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/validation/i);
    }
  });

  it('fails closed on a tampered pack (wrong v field)', async () => {
    const tampered = JSON.stringify(VALID_PACK).replace('"v":1', '"v":2');
    const result = await loadThemePack(tampered);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fallback).toBe(DEFAULT_THEME);
    }
  });

  it('rejects a pack containing forbidden student fields', async () => {
    const withPii = { ...VALID_PACK, members: [{ name: 'Alice' }] };
    const result = await loadThemePack(JSON.stringify(withPii));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/forbidden/i);
    }
  });

  it('rejects a pack with a taps field', async () => {
    const withTaps = { ...VALID_PACK, taps: [] };
    const result = await loadThemePack(JSON.stringify(withTaps));
    expect(result.ok).toBe(false);
  });

  it('accepts an unsigned pilot pack (D-T1 — no ed25519 verification)', async () => {
    const unsigned = {
      ...VALID_PACK,
      signature: {
        alg: 'ed25519',
        keyId: 'thirdline-theme-1',
        sig: 'UNSIGNED_DRAFT_FOR_REVIEW',
      },
    };
    const result = await loadThemePack(JSON.stringify(unsigned));
    expect(result.ok).toBe(true);
  });

  it('returns warnings for checksum mismatches without failing', async () => {
    const withBadChecksum = {
      ...VALID_PACK,
      assets: {
        ...VALID_PACK.assets,
        logoMark: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
      },
      checksums: {
        'assets/logo-mark.svg': 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
      },
    };
    const result = await loadThemePack(JSON.stringify(withBadChecksum));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toMatch(/checksum/i);
    }
  });

  it('loads cleanly when checksums are absent', async () => {
    const noCsums = { ...VALID_PACK };
    delete (noCsums as Partial<ThemePack>).checksums;
    const result = await loadThemePack(JSON.stringify(noCsums));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warnings).toEqual([]);
    }
  });
});
