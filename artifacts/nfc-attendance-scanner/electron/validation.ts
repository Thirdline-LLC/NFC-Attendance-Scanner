import path from 'node:path';

import type { WorkbookSaveRequest } from '../src/platform/desktop-bridge';
import { UPDATE_REPO_NAME, UPDATE_REPO_OWNER } from '../src/update/repo-config';

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
 * `attendance-2026-09-15-20260915T170000Z.xlsx`.
 *
 * An allowlist rather than a sanitiser. It rules out a path separator, a
 * leading dot, a Windows drive letter, a different extension, a NUL and
 * anything long enough to be an attack on the filesystem, all without the main
 * process having to reason about what a "safe" path looks like.
 */
export const EXPORT_FILENAME =
  /^attendance-\d{4}-\d{2}-\d{2}-\d{8}T\d{6}Z\.xlsx$/;

/**
 * The filename shape `buildRosterWorkbook` produces —
 * `roster-2026-09-15-20260915T170000Z.xlsx` — same date-then-stamp shape as
 * the attendance export, just a different prefix.
 */
export const ROSTER_EXPORT_FILENAME =
  /^roster-\d{4}-\d{2}-\d{2}-\d{8}T\d{6}Z\.xlsx$/;

/**
 * The filename shape `buildRosterTemplateWorkbook` / `buildRosterTemplateCsv`
 * produce — `tapin-roster-template-<slug>.xlsx` or `.csv`. The slug comes from
 * `bodySlug` in `src/lib/roster-template.ts`, which is capped at 64 characters
 * and restricted to `[a-z0-9-]`, so it can never fail this pattern.
 */
export const TEMPLATE_EXPORT_FILENAME =
  /^tapin-roster-template-[a-z0-9-]{1,64}\.(?:xlsx|csv)$/;

/** Every filename shape a save request may name. */
const ALLOWED_EXPORT_FILENAMES = [
  EXPORT_FILENAME,
  ROSTER_EXPORT_FILENAME,
  TEMPLATE_EXPORT_FILENAME,
];

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

  if (
    typeof filename !== 'string' ||
    !ALLOWED_EXPORT_FILENAMES.some((pattern) => pattern.test(filename))
  ) {
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

/**
 * A Release asset URL for this public repo, and nothing else (Plan 07).
 *
 * The renderer names the asset. This is what keeps that from becoming an
 * arbitrary-URL fetch: either the GitHub API asset URL `@workspace/update`
 * parses as `apiUrl`, or the public `browser_download_url` on
 * `github.com/<owner>/<repo>/releases/download/…` for the same repo. The
 * browser URL is what a classroom of Macs should use for the disk image —
 * it is the release CDN, not the 60-request REST budget. Any other host,
 * repo, or `..` segment is refused.
 */
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const GITHUB_OWNER = escapeRegex(UPDATE_REPO_OWNER);
const GITHUB_REPO = escapeRegex(UPDATE_REPO_NAME);

const GITHUB_API_ASSET = new RegExp(
  `^https://api\\.github\\.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/assets/\\d+$`,
);
const GITHUB_BROWSER_ASSET = new RegExp(
  `^https://github\\.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/download/[^/?#]+/[^/?#]+$`,
);

export function isGithubReleaseAssetUrl(url: unknown): url is string {
  if (typeof url !== 'string') return false;
  if (url.includes('..') || /%2e%2e/i.test(url)) return false;
  return GITHUB_API_ASSET.test(url) || GITHUB_BROWSER_ASSET.test(url);
}

/**
 * The request shape for downloading and verifying one Release asset.
 *
 * `suggestedName` names the file this becomes on disk if it is an app
 * installer (never used for a theme pack, which is never written to disk).
 * It is re-validated here, not trusted from the release JSON the renderer
 * already parsed — the same allowlist-not-sanitiser approach as
 * `parseSaveRequest`.
 */
/**
 * electron-builder names the school disk image
 * `SJC Attendance-<version>-arm64.dmg` — spaces allowed, path separators and
 * `..` not. The bytes are never written under this name outside a directory
 * the main process created.
 */
function isSafeInstallerName(name: string): boolean {
  if (name.length === 0 || name.length > 180) return false;
  if (name.includes('..') || name.includes('/') || name.includes('\\') || name.includes('\0')) {
    return false;
  }
  return /^[\w .()-]+\.(dmg|apk)$/.test(name);
}

export type DownloadVerifiedAssetRequest = {
  assetUrl: string;
  sha256Url: string;
  suggestedName: string;
  /** True for a `.nfc-theme` pack: verified bytes are returned as text, never written to disk. */
  isTheme: boolean;
};

export function parseDownloadVerifiedAssetRequest(
  payload: unknown,
): DownloadVerifiedAssetRequest | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const { assetUrl, sha256Url, suggestedName, isTheme } = payload as Record<string, unknown>;

  if (!isGithubReleaseAssetUrl(assetUrl)) return null;
  if (!isGithubReleaseAssetUrl(sha256Url)) return null;
  if (typeof isTheme !== 'boolean') return null;

  if (isTheme) {
    if (typeof suggestedName !== 'string' || !suggestedName.endsWith('.nfc-theme')) {
      return null;
    }
  } else if (typeof suggestedName !== 'string' || !isSafeInstallerName(suggestedName)) {
    return null;
  }

  return { assetUrl, sha256Url, suggestedName, isTheme };
}

/**
 * Which file-type filter the desktop Save dialog should offer, picked from
 * the suggested filename's extension. A pure function so `saveDialogOptions`
 * in `main.ts` — which cannot be unit-tested directly, since importing it
 * requires Electron — can be a thin wrapper around this.
 */
export function saveDialogFilter(filename: string): { name: string; extensions: string[] } {
  return filename.toLowerCase().endsWith('.csv')
    ? { name: 'CSV file', extensions: ['csv'] }
    : { name: 'Excel workbook', extensions: ['xlsx'] };
}

/**
 * The desktop Save dialog's title, picked from the filename's shape so a
 * roster template is not offered as an "attendance export".
 */
export function saveDialogTitle(filename: string): string {
  if (TEMPLATE_EXPORT_FILENAME.test(filename)) return 'Save roster template';
  if (ROSTER_EXPORT_FILENAME.test(filename)) return 'Save roster export';
  return 'Save attendance export';
}

/** Every xlsx file is a zip archive, and every zip starts with these bytes. */
const ZIP_LOCAL_FILE_HEADER = [0x50, 0x4b, 0x03, 0x04] as const;

function startsWithZipHeader(bytes: Uint8Array): boolean {
  return ZIP_LOCAL_FILE_HEADER.every((byte, index) => bytes[index] === byte);
}

/**
 * Whether the decoded bytes are plausibly the type the filename's extension
 * claims: an `.xlsx` must open with the zip header, and a `.csv` must not
 * (a zip under a `.csv` name would be an xlsx wearing the wrong extension).
 * Checked before the Save dialog opens, so a mismatch never reaches disk.
 */
export function contentMatchesExtension(filename: string, bytes: Uint8Array): boolean {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.xlsx')) return startsWithZipHeader(bytes);
  if (lower.endsWith('.csv')) return !startsWithZipHeader(bytes);
  return false;
}

/**
 * Whether the path the operator chose in the Save dialog keeps the extension
 * of the suggested filename (the one the content check validated). Compared
 * case-insensitively, so `Roster.CSV` is still a CSV.
 */
export function hasSameExtension(suggestedFilename: string, chosenPath: string): boolean {
  const expected = path.extname(suggestedFilename).toLowerCase();
  return expected.length > 0 && path.extname(chosenPath).toLowerCase() === expected;
}

/** The in-place install IPC. Same asset rules as a non-theme download. */
export function parseInstallAppUpdateRequest(
  payload: unknown,
): DownloadVerifiedAssetRequest | null {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return null;
  const { assetUrl, sha256Url, suggestedName } = payload as Record<string, unknown>;
  return parseDownloadVerifiedAssetRequest({
    assetUrl,
    sha256Url,
    suggestedName,
    isTheme: false,
  });
}
