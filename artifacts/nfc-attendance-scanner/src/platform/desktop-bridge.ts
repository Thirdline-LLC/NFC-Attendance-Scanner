/**
 * The entire surface the Electron preload exposes to this React app.
 *
 * It is deliberately one verb wide. There is no "read a file", no "run a
 * command" and no way to name an arbitrary path: the renderer hands over bytes
 * and a suggested filename, and the main process decides — with the operator,
 * through the system Save dialog — where they may land. Anything the renderer
 * could be tricked into asking for is therefore something the operator has
 * already agreed to on screen.
 *
 * This file is the single definition of that contract. `electron/preload.ts`
 * imports the same types, so the two halves cannot drift apart without a type
 * error.
 */

/** What the renderer asks the desktop shell to save. */
export type WorkbookSaveRequest = {
  /**
   * The name `buildAttendanceWorkbook` produced. It is a suggestion: the main
   * process re-validates its shape and the operator may rename it in the
   * dialog.
   */
  filename: string;
  /** The `.xlsx` bytes, base64-encoded — the bridge carries no binary types. */
  base64: string;
};

/**
 * The three outcomes a save can have, kept apart on purpose.
 *
 * `cancelled` is not a failure and must never be reported as one — the
 * operator closed the dialog, nothing went wrong and there is nothing to
 * retry. `failed` is a real failure with a real reason. `saved` means the
 * bytes are on disk and the main process has confirmed the file's size, so it
 * is the only one that may say the export succeeded.
 */
export type WorkbookSaveResult =
  | { status: 'saved'; path: string; bytes: number }
  | { status: 'cancelled' }
  | { status: 'failed'; message: string };

/** What the renderer asks the main process to fetch and verify (Plan 07). */
export type DownloadVerifiedAssetRequest = {
  /** The GitHub API asset URL — `apiUrl` off a parsed `ReleaseAsset`. */
  assetUrl: string;
  /** The matching `.sha256` sidecar's GitHub API asset URL. */
  sha256Url: string;
  /** The filename this becomes on disk (app installers) or is validated against (themes). */
  suggestedName: string;
  /** True for a `.nfc-theme` pack: verified text comes back, nothing is written to disk. */
  isTheme: boolean;
};

/**
 * Checksum failure refuses (D6, fail closed) before anything reaches the
 * renderer at all — there is no "verified: false" bytes payload to mishandle.
 */
export type DownloadVerifiedAssetResult =
  | { ok: true; kind: 'theme'; text: string }
  | { ok: true; kind: 'app'; path: string; bytes: number }
  | {
      ok: false;
      reason: 'invalid-request' | 'network' | 'http-error' | 'checksum' | 'write-failed';
    };

export type DesktopBridge = {
  /** Marks the shell, and lets a test build a convincing fake. */
  readonly platform: 'electron';
  saveWorkbook(request: WorkbookSaveRequest): Promise<WorkbookSaveResult>;
  /**
   * Opens the operating system's file browser on a workbook this session
   * saved. The main process only honours paths it wrote itself, so this cannot
   * be used to go looking around the disk.
   */
  revealWorkbook(path: string): Promise<boolean>;
  /**
   * Downloads one Release asset and its checksum sidecar in the main process
   * (Node has no CORS restriction; the renderer's own `fetch` does — see
   * `electron/main.ts`), verifies it, and only then returns it.
   */
  downloadVerifiedAsset(
    request: DownloadVerifiedAssetRequest,
  ): Promise<DownloadVerifiedAssetResult>;
  /** Opens the Release notes in the OS browser — the one allowed external navigation. */
  openReleasesPage(): Promise<boolean>;
};

declare global {
  interface Window {
    /** Present only inside the Electron shell; `undefined` everywhere else. */
    attendanceDesktop?: DesktopBridge;
  }
}

/**
 * The bridge, or `undefined` when this is not the desktop app.
 *
 * The shape is checked rather than assumed: `window.attendanceDesktop` is the
 * one thing a page could plausibly have something else under, and a partial
 * object would fail later, at export time, when it matters most.
 */
export function getDesktopBridge(): DesktopBridge | undefined {
  if (typeof window === 'undefined') return undefined;

  const bridge = window.attendanceDesktop;
  if (!bridge) return undefined;
  if (bridge.platform !== 'electron') return undefined;
  if (typeof bridge.saveWorkbook !== 'function') return undefined;
  if (typeof bridge.downloadVerifiedAsset !== 'function') return undefined;

  return bridge;
}

/** Thrown when the operator closed the Save dialog. Not an error condition. */
export class ExportCancelledError extends Error {
  constructor() {
    super('The export was cancelled before a location was chosen.');
    this.name = 'ExportCancelledError';
  }
}
