import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  isGithubReleaseAssetUrl,
  isInsideDirectory,
  MAX_BASE64_LENGTH,
  parseDownloadVerifiedAssetRequest,
  parseInstallAppUpdateRequest,
  parseSaveRequest,
  resolveBundledAsset,
  contentMatchesExtension,
  saveDialogFilter,
  saveDialogTitle,
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

  // Acceptance against the actual output of `buildRosterWorkbook`,
  // `buildRosterTemplateWorkbook` and `buildRosterTemplateCsv` lives in
  // `src/lib/desktop-save-allowlist.test.ts`, not here: those builders pull in
  // `@/...`-aliased modules that `electron/tsconfig.json` does not resolve
  // (it type-checks this whole directory against a deliberately narrow,
  // Electron-free project), so this file sticks to filenames of the same
  // shape rather than importing the builders.
  describe('other filename shapes a real export can produce', () => {
    it('accepts the roster export shape (roster-YYYY-MM-DD-<stamp>.xlsx)', () => {
      const filename = 'roster-2026-09-15-20260915T210000Z.xlsx';

      expect(
        parseSaveRequest({ filename, base64: VALID_BASE64 }),
      ).toEqual({ filename, base64: VALID_BASE64 });
    });

    it('accepts the roster template xlsx shape', () => {
      const filename = 'tapin-roster-template-robotics-club.xlsx';

      expect(
        parseSaveRequest({ filename, base64: VALID_BASE64 }),
      ).toEqual({ filename, base64: VALID_BASE64 });
    });

    it('accepts the roster template csv shape', () => {
      const filename = 'tapin-roster-template-robotics-club.csv';

      expect(
        parseSaveRequest({ filename, base64: VALID_BASE64 }),
      ).toEqual({ filename, base64: VALID_BASE64 });
    });

    it.each([
      ['a traversal wearing the template shape', '../../tapin-roster-template-robotics.xlsx'],
      ['an unrecognised extension', 'tapin-roster-template-robotics.sh'],
      ['a double extension', 'tapin-roster-template-robotics.xlsx.command'],
      ['a slug over 64 characters', `tapin-roster-template-${'a'.repeat(65)}.xlsx`],
      ['uppercase in the slug', 'tapin-roster-template-Robotics.xlsx'],
      ['an empty slug', 'tapin-roster-template-.xlsx'],
    ])('refuses a template filename with %s', (_case, filename) => {
      expect(parseSaveRequest({ filename, base64: VALID_BASE64 })).toBeNull();
    });

    it('accepts a slug of exactly 64 characters', () => {
      const filename = `tapin-roster-template-${'a'.repeat(64)}.xlsx`;

      expect(
        parseSaveRequest({ filename, base64: VALID_BASE64 }),
      ).toEqual({ filename, base64: VALID_BASE64 });
    });
  });
});

describe('saveDialogFilter', () => {
  it('offers the CSV filter for a .csv filename', () => {
    expect(saveDialogFilter('tapin-roster-template-robotics.csv')).toEqual({
      name: 'CSV file',
      extensions: ['csv'],
    });
  });

  it('offers the CSV filter regardless of case', () => {
    expect(saveDialogFilter('tapin-roster-template-robotics.CSV')).toEqual({
      name: 'CSV file',
      extensions: ['csv'],
    });
  });

  it('offers the Excel filter for a .xlsx filename', () => {
    expect(saveDialogFilter('attendance-2026-09-15-20260915T170000Z.xlsx')).toEqual({
      name: 'Excel workbook',
      extensions: ['xlsx'],
    });
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

describe('isGithubReleaseAssetUrl', () => {
  it('accepts the shape @workspace/update parses as an asset.apiUrl', () => {
    expect(
      isGithubReleaseAssetUrl(
        'https://api.github.com/repos/Thirdline-LLC/NFC-Attendance-Scanner/releases/assets/12345',
      ),
    ).toBe(true);
  });

  it('accepts the public browser download URL for this repo', () => {
    expect(
      isGithubReleaseAssetUrl(
        'https://github.com/Thirdline-LLC/NFC-Attendance-Scanner/releases/download/v1.0.1/SJC%20Attendance-1.0.1-arm64.dmg',
      ),
    ).toBe(true);
  });

  it.each([
    ['a download URL for a different repository', 'https://github.com/evil/NFC-Attendance-Scanner/releases/download/v1.0.0/tapin.dmg'],
    ['a different host entirely', 'https://evil.example.com/repos/Thirdline-LLC/NFC-Attendance-Scanner/releases/assets/1'],
    ['plain http, not https', 'http://api.github.com/repos/Thirdline-LLC/NFC-Attendance-Scanner/releases/assets/1'],
    ['a non-numeric asset id', 'https://api.github.com/repos/Thirdline-LLC/NFC-Attendance-Scanner/releases/assets/abc'],
    ['a different api.github.com path entirely', 'https://api.github.com/repos/Thirdline-LLC/NFC-Attendance-Scanner/releases/latest'],
    ['an API asset URL for a different repository', 'https://api.github.com/repos/evil/other/releases/assets/1'],
    ['a download URL with a .. segment', 'https://github.com/Thirdline-LLC/NFC-Attendance-Scanner/releases/download/v1.0.0/../../etc/passwd'],
    ['a non-string value', 42],
    ['null', null],
  ])('refuses %s', (_case, url) => {
    expect(isGithubReleaseAssetUrl(url)).toBe(false);
  });
});

describe('parseDownloadVerifiedAssetRequest', () => {
  const ASSET_URL =
    'https://api.github.com/repos/Thirdline-LLC/NFC-Attendance-Scanner/releases/assets/1';
  const SIDECAR_URL =
    'https://api.github.com/repos/Thirdline-LLC/NFC-Attendance-Scanner/releases/assets/2';

  it('accepts a well-formed app-installer request', () => {
    expect(
      parseDownloadVerifiedAssetRequest({
        assetUrl: ASSET_URL,
        sha256Url: SIDECAR_URL,
        suggestedName: 'tapin.dmg',
        isTheme: false,
      }),
    ).toEqual({
      assetUrl: ASSET_URL,
      sha256Url: SIDECAR_URL,
      suggestedName: 'tapin.dmg',
      isTheme: false,
    });
  });

  it('accepts a well-formed theme-pack request', () => {
    expect(
      parseDownloadVerifiedAssetRequest({
        assetUrl: ASSET_URL,
        sha256Url: SIDECAR_URL,
        suggestedName: 'tapin-sjc-v1.1.0.nfc-theme',
        isTheme: true,
      }),
    ).toEqual({
      assetUrl: ASSET_URL,
      sha256Url: SIDECAR_URL,
      suggestedName: 'tapin-sjc-v1.1.0.nfc-theme',
      isTheme: true,
    });
  });

  it('accepts the electron-builder arm64 disk image name', () => {
    expect(
      parseDownloadVerifiedAssetRequest({
        assetUrl: ASSET_URL,
        sha256Url: SIDECAR_URL,
        suggestedName: 'SJC Attendance-1.0.1-arm64.dmg',
        isTheme: false,
      }),
    ).toMatchObject({ suggestedName: 'SJC Attendance-1.0.1-arm64.dmg', isTheme: false });
  });

  it('accepts an in-place install request that uses the public download URL', () => {
    const browser =
      'https://github.com/Thirdline-LLC/NFC-Attendance-Scanner/releases/download/v1.0.1/SJC%20Attendance-1.0.1-arm64.dmg';
    const sidecar =
      'https://github.com/Thirdline-LLC/NFC-Attendance-Scanner/releases/download/v1.0.1/SJC%20Attendance-1.0.1-arm64.dmg.sha256';
    expect(
      parseInstallAppUpdateRequest({
        assetUrl: browser,
        sha256Url: sidecar,
        suggestedName: 'SJC Attendance-1.0.1-arm64.dmg',
      }),
    ).toEqual({
      assetUrl: browser,
      sha256Url: sidecar,
      suggestedName: 'SJC Attendance-1.0.1-arm64.dmg',
      isTheme: false,
    });
  });

  it('refuses an installer name that is not a .dmg or .apk', () => {
    expect(
      parseDownloadVerifiedAssetRequest({
        assetUrl: ASSET_URL,
        sha256Url: SIDECAR_URL,
        suggestedName: 'tapin.sh',
        isTheme: false,
      }),
    ).toBeNull();
  });

  it('refuses a theme request whose name is not a .nfc-theme', () => {
    expect(
      parseDownloadVerifiedAssetRequest({
        assetUrl: ASSET_URL,
        sha256Url: SIDECAR_URL,
        suggestedName: 'tapin.dmg',
        isTheme: true,
      }),
    ).toBeNull();
  });

  it('refuses a non-GitHub-API asset or sidecar url', () => {
    expect(
      parseDownloadVerifiedAssetRequest({
        assetUrl: 'https://evil.example.com/payload',
        sha256Url: SIDECAR_URL,
        suggestedName: 'tapin.dmg',
        isTheme: false,
      }),
    ).toBeNull();
    expect(
      parseDownloadVerifiedAssetRequest({
        assetUrl: ASSET_URL,
        sha256Url: 'https://evil.example.com/payload',
        suggestedName: 'tapin.dmg',
        isTheme: false,
      }),
    ).toBeNull();
  });

  it.each([
    ['a null payload', null],
    ['an array payload', []],
    ['a payload with no fields', {}],
  ])('refuses %s', (_case, payload) => {
    expect(parseDownloadVerifiedAssetRequest(payload)).toBeNull();
  });
});

describe('saveDialogTitle', () => {
  it('names each file type the desktop app saves', () => {
    expect(saveDialogTitle('tapin-roster-template-robotics.xlsx')).toBe('Save roster template');
    expect(saveDialogTitle('tapin-roster-template-robotics.csv')).toBe('Save roster template');
    expect(saveDialogTitle('roster-2026-09-15-20260915T210000Z.xlsx')).toBe('Save roster export');
    expect(saveDialogTitle('attendance-2026-09-15-20260915T170000Z.xlsx')).toBe(
      'Save attendance export',
    );
  });
});

describe('contentMatchesExtension', () => {
  const zip = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
  const csv = new TextEncoder().encode('first_name,last_name\n');

  it('requires the zip header for .xlsx', () => {
    expect(contentMatchesExtension('roster-2026-09-15-20260915T210000Z.xlsx', zip)).toBe(true);
    expect(contentMatchesExtension('roster-2026-09-15-20260915T210000Z.xlsx', csv)).toBe(false);
    expect(contentMatchesExtension('roster-2026-09-15-20260915T210000Z.xlsx', new Uint8Array())).toBe(
      false,
    );
  });

  it('refuses zip bytes under a .csv name', () => {
    expect(contentMatchesExtension('tapin-roster-template-robotics.csv', csv)).toBe(true);
    expect(contentMatchesExtension('tapin-roster-template-robotics.csv', zip)).toBe(false);
  });

  it('refuses any other extension', () => {
    expect(contentMatchesExtension('notes.txt', csv)).toBe(false);
  });
});
