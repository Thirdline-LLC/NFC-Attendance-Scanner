import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadThemePack } from '../src/loader';
import { scanForForbiddenFields } from '../src/verify';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, '../fixtures');
const FIXTURE = join(FIXTURES, 'tapin-sjc-v1.0.2.nfc-theme');

describe('tapin-sjc packed fixture', () => {
  it('fixture file exists', () => {
    expect(existsSync(FIXTURE)).toBe(true);
  });

  it('loads cleanly and passes validation', async () => {
    const json = readFileSync(FIXTURE, 'utf-8');
    const result = await loadThemePack(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.pack.meta.version).toBe('1.0.2');
    }
  });

  it('contains zero student/education record fields', () => {
    const raw = JSON.parse(readFileSync(FIXTURE, 'utf-8')) as unknown;
    const forbidden = scanForForbiddenFields(raw);
    expect(forbidden).toEqual([]);
  });

  it('has correct product name — Tapin, not a school name', async () => {
    const json = readFileSync(FIXTURE, 'utf-8');
    const result = await loadThemePack(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.pack.copy.appName).toBe('Tapin');
    }
  });

  it('has all assets embedded as data URIs', () => {
    const pack = JSON.parse(readFileSync(FIXTURE, 'utf-8')) as {
      assets: Record<string, string>;
    };
    for (const [key, value] of Object.entries(pack.assets)) {
      if (value) {
        expect(value, `${key} should be a data URI`).toMatch(/^data:/);
      }
    }
  });

  it('has checksums matching embedded assets (SHA-256 round-trip)', async () => {
    const json = readFileSync(FIXTURE, 'utf-8');
    const result = await loadThemePack(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warnings).toEqual([]);
    }
  });

  it('has no signature field (unsigned pilot, D-T1)', () => {
    const pack = JSON.parse(readFileSync(FIXTURE, 'utf-8')) as Record<string, unknown>;
    expect('signature' in pack).toBe(false);
  });
});
