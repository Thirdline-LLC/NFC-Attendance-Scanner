/**
 * The entire surface the Electron preload exposes to this React app.
 *
 * There is no "read a file", no "run a command" and no way to name an
 * arbitrary path. Workbook export hands over bytes and a suggested filename;
 * the main process decides — with the operator, through the system Save
 * dialog — where they may land. Update install hands over a GitHub Release
 * asset URL the main process re-validates; the bundle it replaces is the one
 * this process is running from, never a path the page chose.
 *
 * This file is the single definition of that contract. `electron/preload.ts`
 * imports the same types, so the two halves cannot drift apart without a type
 * error.
 */

import type { InPlaceFailureReason, InPlaceProgressPhase } from '@workspace/update';

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
  | {
      ok: false;
      reason: 'invalid-request' | 'network' | 'http-error' | 'checksum' | 'write-failed';
    };

/** Pushed on `attendance:update-progress` while an in-place install is running. */
export type UpdateProgressEvent = {
  phase: InPlaceProgressPhase;
};

export type InstallAppUpdateRequest = {
  assetUrl: string;
  sha256Url: string;
  suggestedName: string;
};

export type InstallAppUpdateResult =
  | { ok: true; phase: 'relaunching' }
  | {
      ok: false;
      reason: InPlaceFailureReason | 'invalid-request';
      message: string;
    };

export type DesktopBridge = {
  /** Marks the shell, and lets a test build a convincing fake. */
  readonly platform: 'electron';
  /** CPU of this Mac. The update check uses it to pick an arm64 disk image. */
  readonly hostArch?: 'arm64' | 'x64';
  saveWorkbook(request: WorkbookSaveRequest): Promise<WorkbookSaveResult>;
  /**
   * Opens the operating system's file browser on a workbook this session
   * saved. The main process only honours paths it wrote itself, so this cannot
   * be used to go looking around the disk.
   */
  revealWorkbook(path: string): Promise<boolean>;
  /**
   * Downloads one theme-pack Release asset and its checksum sidecar in the
   * main process (Node has no CORS restriction; the renderer's own `fetch`
   * does — see `electron/main.ts`), verifies it, and only then returns the
   * pack text. App disk images use `installAppUpdate`.
   */
  downloadVerifiedAsset(
    request: DownloadVerifiedAssetRequest,
  ): Promise<DownloadVerifiedAssetResult>;
  /**
   * Verified in-place replacement of this Mac's installed app. The main
   * process emits `onUpdateProgress` while the invoke is in flight, then
   * quits on success. Absent on a bridge that only knows the older
   * download-to-Downloads behaviour.
   */
  installAppUpdate?(request: InstallAppUpdateRequest): Promise<InstallAppUpdateResult>;
  onUpdateProgress?(listener: (event: UpdateProgressEvent) => void): () => void;
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
