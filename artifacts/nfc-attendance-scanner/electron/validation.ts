import path from 'node:path';

import type { WorkbookSaveRequest } from '../src/platform/desktop-bridge';

/**
 * The rules the main process applies to anything the renderer sends it.
 *
 * They live here, apart from `main.ts`, for one reason: `main.ts` cannot be
 * imported without Electron, and these are exactly the functions that most
 * need testing. Nothing in this file touches Electron, the filesystem or the
 * network, so its tests are plain unit tests.
 */

/**
 * The filename shape `buildAttendanceWorkbook` produces —
 * `attendance-2026-09-15-20260915T170000Z.xlsx` — and the only one accepted.
 *
 * An allowlist rather than a sanitiser. It rules out a path separator, a
 * leading dot, a Windows drive letter, a different extension, a NUL and
 * anything long enough to be an attack on the filesystem, all without the main
 * process having to reason about what a "safe" path looks like.
 */
export const EXPORT_FILENAME =
  /^attendance-\d{4}-\d{2}-\d{2}-\d{8}T\d{6}Z\.xlsx$/;

/** 64 MB of base64. A full school year of taps is a few hundred kilobytes. */
export const MAX_BASE64_LENGTH = 64 * 1024 * 1024;

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/**
 * Returns the request when every field is well formed, and `null` otherwise. A
 * renderer compromised badly enough to send something else gets an error back,
 * not a write.
 */
export function parseSaveRequest(payload: unknown): WorkbookSaveRequest | null {
  if (typeof payload !== 'object' || payload === null) return null;
  if (Array.isArray(payload)) return null;

  const { filename, base64 } = payload as Record<string, unknown>;

  if (typeof filename !== 'string' || !EXPORT_FILENAME.test(filename)) {
    return null;
  }
  if (typeof base64 !== 'string' || base64.length === 0) return null;
  if (base64.length > MAX_BASE64_LENGTH) return null;
  // Length must be a multiple of four for the string to decode to whole bytes;
  // Buffer.from would otherwise quietly truncate rather than complain.
  if (base64.length % 4 !== 0) return null;
  if (!BASE64.test(base64)) return null;

  return { filename, base64 };
}

/**
 * Whether a resolved path sits inside `root`.
 *
 * `path.resolve` collapses `..` before this compares, which is what makes the
 * comparison sufficient. The separator on the end matters: without it
 * `/app/publicity` would count as inside `/app/public`.
 */
export function isInsideDirectory(root: string, candidate: string): boolean {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(candidate);

  return (
    resolved === resolvedRoot || resolved.startsWith(resolvedRoot + path.sep)
  );
}

/**
 * Maps a URL path from the `app://` scheme onto a file inside the packaged
 * renderer, or to `null` when it escapes the bundle — in which case the caller
 * serves index.html, the same as it does for a client-side route.
 */
export function resolveBundledAsset(
  rendererDir: string,
  urlPathname: string,
): string | null {
  const requested = decodeURIComponent(urlPathname);
  const resolved = path.resolve(rendererDir, `.${requested}`);

  return isInsideDirectory(rendererDir, resolved) ? resolved : null;
}
