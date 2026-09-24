import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSha256Sidecar, sha256Hex, verifySha256 } from '../src/checksum';

const __dirname = dirname(fileURLToPath(import.meta.url));
const THEME_FIXTURE = join(__dirname, '../../themes/fixtures/tapin-sjc-v1.0.0.nfc-theme');
const THEME_SIDECAR = join(__dirname, '../../themes/fixtures/tapin-sjc-v1.0.0.nfc-theme.sha256');

describe('sha256Hex', () => {
  it('matches a known digest', async () => {
    const bytes = new TextEncoder().encode('hello world');
    expect(await sha256Hex(bytes)).toBe(
      'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9',
    );
  });
});

describe('parseSha256Sidecar', () => {
  it('reads a bare hex digest (this repo\'s pack.mjs convention)', () => {
    expect(parseSha256Sidecar('abc123'.padEnd(64, '0') + '\n')).toBe(
      'abc123'.padEnd(64, '0'),
    );
  });

  it('reads the first hex token from a sha256sum-style "<hex>  <name>" line', () => {
    const hex = 'a'.repeat(64);
    expect(parseSha256Sidecar(`${hex}  asset.dmg\n`)).toBe(hex);
  });

  it('returns null for a sidecar with no hex digest', () => {
    expect(parseSha256Sidecar('not a checksum')).toBeNull();
  });
});

describe('verifySha256', () => {
  it('accepts a sidecar written in uppercase hex', async () => {
    const bytes = new TextEncoder().encode('tapin');
    const digest = (await sha256Hex(bytes)).toUpperCase();
    expect(await verifySha256(bytes, `${digest}  SJC Attendance-1.0.1-arm64.dmg\n`)).toEqual({
      ok: true,
    });
  });

  it('accepts bytes that match the sidecar', async () => {
    const bytes = new TextEncoder().encode('tapin');
    const digest = await sha256Hex(bytes);
    expect(await verifySha256(bytes, digest)).toEqual({ ok: true });
  });

  it('refuses (fails closed) on a mismatched digest', async () => {
    const bytes = new TextEncoder().encode('tapin');
    const wrongDigest = 'f'.repeat(64);
    expect(await verifySha256(bytes, wrongDigest)).toEqual({
      ok: false,
      reason: 'mismatch',
    });
  });

  it('refuses (fails closed) on a malformed sidecar rather than skipping verification', async () => {
    const bytes = new TextEncoder().encode('tapin');
    expect(await verifySha256(bytes, 'corrupt, not a checksum')).toEqual({
      ok: false,
      reason: 'malformed-sidecar',
    });
  });

  it('verifies against this repo\'s real theme-pack fixture and its real sidecar', async () => {
    const packBytes = readFileSync(THEME_FIXTURE);
    const sidecarText = readFileSync(THEME_SIDECAR, 'utf-8');
    expect(await verifySha256(new Uint8Array(packBytes), sidecarText)).toEqual({ ok: true });
  });

  it('refuses when the real fixture is checked against a tampered copy', async () => {
    const packBytes = readFileSync(THEME_FIXTURE);
    const sidecarText = readFileSync(THEME_SIDECAR, 'utf-8');
    const tampered = new Uint8Array(packBytes.length + 1);
    tampered.set(packBytes);
    tampered[packBytes.length] = 0x00;
    expect(await verifySha256(tampered, sidecarText)).toEqual({
      ok: false,
      reason: 'mismatch',
    });
  });
});
