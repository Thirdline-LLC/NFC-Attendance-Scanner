import path from 'node:path';
import fs from 'node:fs/promises';

import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  protocol,
  shell,
  session,
  type IpcMainInvokeEvent,
} from 'electron';

import { runInPlaceInstall, verifySha256 } from '@workspace/update';

import type {
  DownloadVerifiedAssetResult,
  InstallAppUpdateResult,
  WorkbookSaveResult,
} from '../src/platform/desktop-bridge';
import { RELEASES_PAGE_URL } from '../src/update/repo-config';
// Every rule applied to renderer input lives in validation.ts, which imports
// no Electron and is therefore unit-tested directly.
import { createInPlaceHost, fetchReleaseAssetBytes } from './in-place-host';
import {
  parseDownloadVerifiedAssetRequest,
  parseInstallAppUpdateRequest,
  contentMatchesExtension,
  parseSaveRequest,
  resolveBundledAsset,
  saveDialogFilter,
  saveDialogTitle,
} from './validation';

// esbuild emits CommonJS for both Electron entry points (a sandboxed preload
// has to be CJS), so `__dirname` is the portable way to find the bundle.
const here = __dirname;

/**
 * The renderer's own origin, and the reason this app does not simply
 * `loadFile()`.
 *
 * A `file://` page has an opaque origin, and Chromium treats storage there as
 * untrustworthy: IndexedDB is unreliable at best. Everything this kiosk knows
 * lives in IndexedDB, so the bundle is served over a private, registered
 * scheme instead. `app://attendance` is a normal secure origin, which makes
 * Dexie behave exactly as it does on the web.
 *
 * CHANGING EITHER HALF OF THIS ORIGIN ORPHANS EVERY ROSTER AND ATTENDANCE
 * RECORD ON EVERY INSTALLED MACHINE. It is part of the app's permanent
 * identity, like the bundle id. Do not "tidy" it.
 */
const APP_SCHEME = 'app';
const APP_HOST = 'attendance';
const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;

/**
 * The stable name Electron stores browser data under, set explicitly rather
 * than inherited from package.json — which in this workspace would be
 * `@workspace/nfc-attendance-scanner`, and would differ between a development
 * run and a packaged one. On macOS this is
 * `~/Library/Application Support/SJC Attendance`.
 *
 * Same warning as the origin: changing it hides every existing record.
 */
const APP_NAME = 'SJC Attendance';

/** Where the built renderer lives, relative to this file inside the asar. */
const RENDERER_DIR = path.join(here, '..', 'public');

/**
 * In development the renderer is served by Vite so edits reload. This is the
 * ONLY case in which the app may load an http(s) URL, it is opt-in through an
 * environment variable the packaged app never sets, and `app.isPackaged`
 * forbids it in a shipped build regardless.
 */
const devServerUrl = app.isPackaged
  ? undefined
  : process.env.ELECTRON_RENDERER_URL;

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  // Radix and Recharts set inline style attributes; no inline <script> is
  // permitted, which is the half that matters.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  // 'self' for the renderer's own bundled assets, plus the GitHub REST API
  // for Plan 07's update-metadata check (D-T3: reading Release metadata is
  // allowed; downloading and verifying asset bytes happens in this main
  // process instead, which is not subject to this policy at all).
  "connect-src 'self' https://api.github.com",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

/**
 * Every file this process has actually written, in this run.
 *
 * `revealWorkbook` will only open a path in this set. Without it, "show me
 * that file" would be a renderer-controlled way to point the operating system
 * at any path on the disk.
 */
const writtenExports = new Set<string>();

app.setName(APP_NAME);
app.setPath('userData', path.join(app.getPath('appData'), APP_NAME));

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

/**
 * Serves the packaged renderer, and nothing else.
 *
 * The requested path is resolved and then checked to be inside the renderer
 * directory, so `../../` cannot walk out of the bundle. Anything that is not a
 * file on disk falls back to `index.html`, which is what makes the client-side
 * router work for `/roster` and `/dashboard` on a reload.
 */
async function handleAppRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);

  if (url.host !== APP_HOST) {
    return new Response('Not found', { status: 404 });
  }

  const resolved = resolveBundledAsset(RENDERER_DIR, url.pathname);
  const indexPath = path.join(RENDERER_DIR, 'index.html');

  const target = await (async () => {
    // `null` means the request tried to walk out of the bundle. Anything that
    // is not a file on disk — a client-side route such as /roster included —
    // falls back to index.html, which is what makes a reload work there.
    if (resolved === null) return indexPath;
    try {
      const stats = await fs.stat(resolved);
      return stats.isFile() ? resolved : indexPath;
    } catch {
      return indexPath;
    }
  })();

  const body = await fs.readFile(target);
  return new Response(new Uint8Array(body), {
    status: 200,
    headers: { 'content-type': contentTypeFor(target) },
  });
}

function contentTypeFor(filePath: string): string {
  const types: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
    '.txt': 'text/plain; charset=utf-8',
  };
  return types[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

async function saveWorkbook(
  event: IpcMainInvokeEvent,
  payload: unknown,
): Promise<WorkbookSaveResult> {
  const request = parseSaveRequest(payload);

  if (!request) {
    return { status: 'failed', message: 'The export request was malformed.' };
  }

  // Decoded once, up front: the bytes must match the extension before the
  // operator is ever asked where to put them.
  const bytes = Buffer.from(request.base64, 'base64');
  if (!contentMatchesExtension(request.filename, bytes)) {
    return {
      status: 'failed',
      message: "The file's contents do not match its file type.",
    };
  }

  const window = BrowserWindow.fromWebContents(event.sender);

  // The operator names the destination. That is what makes this safe: the
  // renderer never chooses a path, it only suggests a filename.
  const { canceled, filePath } = await (window
    ? dialog.showSaveDialog(window, saveDialogOptions(request.filename))
    : dialog.showSaveDialog(saveDialogOptions(request.filename)));

  if (canceled || !filePath) return { status: 'cancelled' };

  try {
    await fs.writeFile(filePath, bytes);
    // Confirmed rather than assumed: a write that resolved but produced an
    // empty file is a failed export, and the operator has to hear so.
    const { size } = await fs.stat(filePath);

    if (size === 0) {
      return {
        status: 'failed',
        message: 'The file was created but nothing was written to it.',
      };
    }

    writtenExports.add(filePath);
    return { status: 'saved', path: filePath, bytes: size };
  } catch (error) {
    // The message names the failure, never the contents. Nothing about a
    // student reaches this process, and nothing here is logged.
    return {
      status: 'failed',
      message:
        error instanceof Error ? error.message : 'The file could not be written.',
    };
  }
}

function saveDialogOptions(filename: string) {
  return {
    title: saveDialogTitle(filename),
    defaultPath: path.join(app.getPath('documents'), filename),
    filters: [saveDialogFilter(filename)],
    properties: ['createDirectory' as const, 'showOverwriteConfirmation' as const],
  };
}

function revealWorkbook(_event: IpcMainInvokeEvent, payload: unknown): boolean {
  // Only a path this process wrote, this run. Anything else is refused
  // outright rather than sanitised, because there is no legitimate caller.
  if (typeof payload !== 'string' || !writtenExports.has(payload)) return false;

  shell.showItemInFolder(payload);
  return true;
}

/**
 * Downloads one Release asset and its `.sha256` sidecar, verifies the
 * checksum, and only then hands anything back to the renderer (D6: checksum
 * fail refuses install, fail closed).
 *
 * Theme packs only. A verified pack's JSON is returned to the renderer,
 * which passes it to `installPack` — Plan 04's activator, unchanged. App
 * disk images go through `installAppUpdate` instead: they are verified and
 * then replace the running bundle. They are not written to Downloads and
 * their bytes never cross the bridge.
 *
 * The fetch itself lives in `in-place-host.ts` because the renderer's
 * `fetch` is bound by CORS, and GitHub's release CDN sends no
 * `Access-Control-Allow-Origin` on the asset bytes.
 */
async function downloadVerifiedAsset(
  _event: IpcMainInvokeEvent,
  payload: unknown,
): Promise<DownloadVerifiedAssetResult> {
  const request = parseDownloadVerifiedAssetRequest(payload);
  if (!request || !request.isTheme) return { ok: false, reason: 'invalid-request' };

  let assetBytes: Uint8Array;
  let sidecarBytes: Uint8Array;
  try {
    [assetBytes, sidecarBytes] = await Promise.all([
      fetchReleaseAssetBytes(request.assetUrl),
      fetchReleaseAssetBytes(request.sha256Url),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    return {
      ok: false,
      reason: message.startsWith('http-error:') ? 'http-error' : 'network',
    };
  }

  const sidecarText = Buffer.from(sidecarBytes).toString('utf-8');
  const verification = await verifySha256(assetBytes, sidecarText);
  if (!verification.ok) return { ok: false, reason: 'checksum' };

  return { ok: true, kind: 'theme', text: Buffer.from(assetBytes).toString('utf-8') };
}

/**
 * Teacher-confirmed in-place replacement of the running macOS app.
 *
 * Progress events (`downloading`, `installing`, `relaunching`) are pushed
 * while this invoke is still in flight. On success the helper is already
 * detached and `app.quit()` has been asked for; the helper waits for this
 * pid, swaps the bundle, and opens it again. A failure returns here and
 * does not quit.
 */
async function installAppUpdate(
  event: IpcMainInvokeEvent,
  payload: unknown,
): Promise<InstallAppUpdateResult> {
  const request = parseInstallAppUpdateRequest(payload);
  if (!request) {
    return {
      ok: false,
      reason: 'invalid-request',
      message: 'The desktop shell refused this update request.',
    };
  }

  try {
    return await runInPlaceInstall(
      { assetUrl: request.assetUrl, sha256Url: request.sha256Url },
      createInPlaceHost((progress) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send('attendance:update-progress', progress);
        }
      }),
    );
  } catch {
    return {
      ok: false,
      reason: 'stage-failed',
      message: 'The update could not be prepared. Nothing was installed.',
    };
  }
}

/**
 * The manual fallback link (offline, firewalled, or the operator just wants
 * to see the Release notes first). `setWindowOpenHandler` below denies every
 * `window.open`/`target=_blank`, so this is the one deliberate escape hatch —
 * and it takes no argument from the renderer: the URL is this constant, never
 * a string the page could substitute.
 */
function openReleasesPage(): boolean {
  void shell.openExternal(RELEASES_PAGE_URL);
  return true;
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1180,
    height: 860,
    minWidth: 720,
    minHeight: 600,
    // Matches --background in src/index.css, so the frame does not flash white
    // before the first paint.
    backgroundColor: '#0D1E30',
    title: APP_NAME,
    show: false,
    webPreferences: {
      preload: path.join(here, 'preload.cjs'),
      // The three that matter, stated rather than inherited from defaults that
      // could change under a major Electron upgrade.
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      nodeIntegrationInWorker: false,
      webviewTag: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      // The kiosk holds a session open for an hour at a time; a throttled
      // timer in a background window would stall the scan queue.
      backgroundThrottling: false,
    },
  });

  window.once('ready-to-show', () => window.show());

  // A link, a redirect or a stray `location =` must not be able to take the
  // window somewhere else. The renderer is the app; there is nowhere to go.
  window.webContents.on('will-navigate', (event, url) => {
    const permitted = devServerUrl
      ? url.startsWith(devServerUrl)
      : url.startsWith(APP_ORIGIN);
    if (!permitted) event.preventDefault();
  });

  // No second window, ever. `target=_blank`, `window.open`, a popup from a
  // dependency: all refused.
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  window.webContents.on('will-attach-webview', (event) => event.preventDefault());

  if (devServerUrl) {
    void window.loadURL(devServerUrl);
  } else {
    void window.loadURL(`${APP_ORIGIN}/`);
  }
}

void app.whenReady().then(() => {
  protocol.handle(APP_SCHEME, handleAppRequest);

  // Enforced by the process rather than by a meta tag the renderer ships, so a
  // compromised bundle cannot relax its own policy. Skipped against the dev
  // server, which needs a websocket for hot reload.
  if (!devServerUrl) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [CONTENT_SECURITY_POLICY],
        },
      });
    });
  }

  // Nothing in this app uses the camera, the microphone, the location or
  // notifications. Refusing every request is both correct and one less prompt
  // for a teacher to think about.
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, grant) =>
    grant(false),
  );

  ipcMain.handle('attendance:save-workbook', saveWorkbook);
  ipcMain.handle('attendance:reveal-workbook', revealWorkbook);
  ipcMain.handle('attendance:download-verified-asset', downloadVerifiedAsset);
  ipcMain.handle('attendance:install-app-update', installAppUpdate);
  ipcMain.handle('attendance:open-releases-page', openReleasesPage);

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  // The Mac convention is to stay in the dock, but a kiosk that has been
  // closed is finished; leaving it running only invites a second instance.
  app.quit();
});
