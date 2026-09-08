import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  isInsideDirectory,
  MAX_BASE64_LENGTH,
  parseSaveRequest,
  resolveBundledAsset,
} from './validation';

/** A filename of exactly the shape `buildAttendanceWorkbook` produces. */
const VALID_NAME = 'attendance-2026-09-15-20260915T170000Z.xlsx';
/** Well-formed base64: length a multiple of four, alphabet respected. */
const VALID_BASE64 = 'UEsDBBQAAAAIAA==';

describe('parseSaveRequest', () => {
  it('accepts the request the renderer actually sends', () => {
    expect(
      parseSaveRequest({ filename: VALID_NAME, base64: VALID_BASE64 }),
    ).toEqual({ filename: VALID_NAME, base64: VALID_BASE64 });
  });

  it('drops any extra fields rather than passing them through', () => {
    const parsed = parseSaveRequest({
      filename: VALID_NAME,
      base64: VALID_BASE64,
      directory: '/etc',
      overwrite: true,
    });

    expect(parsed).toEqual({ filename: VALID_NAME, base64: VALID_BASE64 });
  });

  it.each([
    ['a path traversal', '../../../etc/passwd'],
    ['a traversal wearing the right extension', '../../attendance.xlsx'],
    ['an absolute path', '/etc/attendance-2026-09-15-20260915T170000Z.xlsx'],
    ['a Windows absolute path', 'C:\\Windows\\attendance.xlsx'],
    ['a backslash separator', 'sub\\attendance-2026-09-15-20260915T170000Z.xlsx'],
    ['a NUL byte', 'attendance-2026-09-15-20260915T170000Z.xlsx\u0000.sh'],
    ['a different extension', 'attendance-2026-09-15-20260915T170000Z.sh'],
    ['a double extension', 'attendance-2026-09-15-20260915T170000Z.xlsx.command'],
    ['a leading dot', '.attendance-2026-09-15-20260915T170000Z.xlsx'],
    ['a plausible but unrecognised name', 'roster-export.xlsx'],
    ['an empty name', ''],
  ])('refuses %s', (_case, filename) => {
    // Refused outright rather than sanitised: there is no legitimate caller
    // that would send any of these, so there is nothing to repair.
    expect(parseSaveRequest({ filename, base64: VALID_BASE64 })).toBeNull();
  });

  it.each([
    ['a null payload', null],
    ['a string payload', 'attendance.xlsx'],
    ['a number payload', 42],
    ['an array payload', [VALID_NAME, VALID_BASE64]],
    ['nothing at all', undefined],
    ['a payload with no fields', {}],
  ])('refuses %s', (_case, payload) => {
    expect(parseSaveRequest(payload)).toBeNull();
  });

  it.each([
    ['empty content', ''],
    ['a non-string body', 12345],
    ['characters outside the base64 alphabet', 'not base64!!'],
    ['an HTML payload', '<script>alert(1)</script>'],
    // Buffer.from would silently truncate this rather than complain.
    ['a length that is not a multiple of four', 'UEsDBBQAAAAIAA=' ],
  ])('refuses %s in the body', (_case, base64) => {
    expect(parseSaveRequest({ filename: VALID_NAME, base64 })).toBeNull();
  });

  it('refuses a body larger than the cap', () => {
    const oversized = 'A'.repeat(MAX_BASE64_LENGTH + 4);

    expect(
      parseSaveRequest({ filename: VALID_NAME, base64: oversized }),
    ).toBeNull();
  });
});

describe('isInsideDirectory', () => {
  it('accepts the directory itself and anything under it', () => {
    expect(isInsideDirectory('/app/public', '/app/public')).toBe(true);
    expect(isInsideDirectory('/app/public', '/app/public/index.html')).toBe(true);
    expect(isInsideDirectory('/app/public', '/app/public/assets/app.js')).toBe(
      true,
    );
  });

  it('rejects a sibling whose name merely starts the same way', () => {
    // A plain startsWith without the separator would let this through.
    expect(isInsideDirectory('/app/public', '/app/publicity/secrets')).toBe(
      false,
    );
  });

  it('rejects a path that walks out with ..', () => {
    expect(isInsideDirectory('/app/public', '/app/public/../../etc/passwd')).toBe(
      false,
    );
  });
});

describe('resolveBundledAsset', () => {
  const renderer = path.resolve('/app/dist/public');

  it('maps a normal request onto a file in the bundle', () => {
    expect(resolveBundledAsset(renderer, '/assets/index-abc.js')).toBe(
      path.join(renderer, 'assets', 'index-abc.js'),
    );
  });

  it('maps the root onto the bundle directory', () => {
    expect(resolveBundledAsset(renderer, '/')).toBe(renderer);
  });

  it('decodes a percent-encoded path before checking it', () => {
    // %2e%2e is "..", which a check performed before decoding would miss.
    expect(resolveBundledAsset(renderer, '/%2e%2e/%2e%2e/etc/passwd')).toBeNull();
  });

  it.each([
    '/../../../etc/passwd',
    '/assets/../../../../etc/shadow',
    '/../.ssh/id_rsa',
  ])('refuses to escape the bundle via %s', (pathname) => {
    expect(resolveBundledAsset(renderer, pathname)).toBeNull();
  });

  it('returns a path for a client-side route, which the caller falls back on', () => {
    // /roster is not a file; resolving it is fine, and the protocol handler
    // serves index.html once fs.stat says it is not there.
    expect(resolveBundledAsset(renderer, '/roster')).toBe(
      path.join(renderer, 'roster'),
    );
  });
});
