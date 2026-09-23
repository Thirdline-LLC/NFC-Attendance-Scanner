import type { ThemePack } from './schema';

/**
 * Decode a data URI to a Uint8Array.
 * Supports `data:<type>;base64,<data>` format.
 */
function decodeDataUri(dataUri: string): Uint8Array | null {
  const match = dataUri.match(/^data:[^;]+;base64,(.+)$/);
  if (!match) return null;

  try {
    const binStr = atob(match[1]);
    const bytes = new Uint8Array(binStr.length);
    for (let i = 0; i < binStr.length; i++) {
      bytes[i] = binStr.charCodeAt(i);
    }
    return bytes;
  } catch {
    return null;
  }
}

/**
 * Compute SHA-256 of a byte array and return as lowercase hex string.
 * Uses the WebCrypto API, available in browsers and Node.js ≥18.
 */
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export type ChecksumResult =
  | { ok: true }
  | { ok: false; failed: string[] };

/**
 * Optionally verify asset SHA-256 checksums in a packed theme.
 *
 * - If `checksums` is absent or empty, returns `{ ok: true }` (no-op).
 * - Only verifies assets whose packed value is a data URI; path-style values
 *   (source manifests not yet packed) are skipped.
 * - ed25519 signature verification is intentionally NOT implemented (D-T1).
 *   A missing or placeholder `signature.sig` is accepted for the pilot.
 */
export async function verifyChecksums(pack: ThemePack): Promise<ChecksumResult> {
  const { checksums, assets } = pack;
  if (!checksums || Object.keys(checksums).length === 0) return { ok: true };

  const assetMap: Record<string, string | undefined> = {
    'assets/logo-mark.svg': assets.logoMark,
    'assets/logo-wordmark.svg': assets.logoWordmark,
    'assets/favicon.svg': assets.favicon,
    'assets/splash.svg': assets.splash,
  };

  const failed: string[] = [];

  for (const [path, expected] of Object.entries(checksums)) {
    const value = assetMap[path];
    if (!value || !value.startsWith('data:')) continue;

    const expectedHex = expected.startsWith('sha256:')
      ? expected.slice('sha256:'.length)
      : expected;

    const bytes = decodeDataUri(value);
    if (!bytes) {
      failed.push(path);
      continue;
    }

    const actual = await sha256Hex(bytes);
    if (actual !== expectedHex) {
      failed.push(path);
    }
  }

  return failed.length === 0 ? { ok: true } : { ok: false, failed };
}

/**
 * Scan a raw parsed object for fields forbidden in theme packs.
 * Returns the names of any forbidden top-level keys found.
 * Themes must never carry education records (FERPA).
 */
export function scanForForbiddenFields(raw: unknown): string[] {
  if (typeof raw !== 'object' || raw === null) return [];
  const FORBIDDEN = [
    'members', 'students', 'roster',
    'emails', 'email',
    'uids', 'uid', 'cardUid',
    'taps', 'sessions',
    'pin', 'pinHash',
  ];
  return FORBIDDEN.filter((key) => key in (raw as Record<string, unknown>));
}
