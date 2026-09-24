/**
 * SHA-256 verification of a downloaded Release asset against its `.sha256`
 * sidecar. Pure — takes bytes it is handed and does not care how they
 * arrived, so it runs the same in the Electron main process (Node) and in
 * tests (no browser/CORS dependency).
 */

/** Compute SHA-256 of a byte array and return it as lowercase hex. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const hash = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Reads the expected digest out of a `.sha256` sidecar file. This repo's own
 * `pack.mjs` writes a bare 64-character hex string with no filename suffix
 * (see `lib/themes/fixtures/*.sha256`); a `sha256sum`-style `<hex>  <name>`
 * line is also accepted by taking the first hex token, so either convention
 * verifies without a second parser.
 */
export function parseSha256Sidecar(sidecarText: string): string | null {
  const match = sidecarText.match(/[0-9a-f]{64}/i);
  return match ? match[0].toLowerCase() : null;
}

export type ChecksumVerification =
  | { ok: true }
  | { ok: false; reason: 'malformed-sidecar' | 'mismatch' };

/** Fail-closed: a sidecar that cannot be parsed refuses just as a mismatch does. */
export async function verifySha256(
  bytes: Uint8Array,
  sidecarText: string,
): Promise<ChecksumVerification> {
  const expected = parseSha256Sidecar(sidecarText);
  if (!expected) return { ok: false, reason: 'malformed-sidecar' };

  const actual = await sha256Hex(bytes);
  return actual === expected ? { ok: true } : { ok: false, reason: 'mismatch' };
}
