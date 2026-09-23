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

import { verifySha256 } from '@workspace/update';

import type { DownloadVerifiedAssetResult, WorkbookSaveResult } from '../src/platform/desktop-bridge';
import { RELEASES_PAGE_URL } from '../src/update/repo-config';
// Every rule applied to renderer input lives in validation.ts, which imports
// no Electron and is therefore unit-tested directly.
import {
  parseDownloadVerifiedAssetRequest,
  parseSaveRequest,
  resolveBundledAsset,
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

  const window = BrowserWindow.fromWebContents(event.sender);

  // The operator names the destination. That is what makes this safe: the
  // renderer never chooses a path, it only suggests a filename.
  const { canceled, filePath } = await (window
    ? dialog.showSaveDialog(window, saveDialogOptions(request.filename))
    : dialog.showSaveDialog(saveDialogOptions(request.filename)));

  if (canceled || !filePath) return { status: 'cancelled' };

  try {
    await fs.writeFile(filePath, Buffer.from(request.base64, 'base64'));
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
    title: 'Save attendance export',
    defaultPath: path.join(app.getPath('documents'), filename),
    filters: [{ name: 'Excel workbook', extensions: ['xlsx'] }],
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
 * Fetches one Release asset's bytes from the GitHub API.
 *
 * Runs in the main process specifically because it is not: the renderer's
 * `fetch` is bound by CORS, and GitHub's Release asset CDN sends no
 * `Access-Control-Allow-Origin` header on the asset response — only the
 * `/releases/latest` metadata call does. Node's `fetch` has no such
 * restriction, which is the whole reason this download does not happen in
 * `src/update/`.
 */
async function fetchReleaseAssetBytes(url: string): Promise<Uint8Array> {
  const token = process.env.TAPIN_UPDATE_TOKEN;
  const headers: Record<string, string> = { Accept: 'application/octet-stream' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`http-error:${response.status}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * Downloads one Release asset and its `.sha256` sidecar, verifies the
 * checksum, and only then hands anything back to the renderer (D6: checksum
 * fail refuses install, fail closed).
 *
 * A theme pack's verified JSON text is returned directly — the renderer
 * passes it straight to `installPack`, Plan 04's own activator, unchanged.
 * An app installer is instead written to the Downloads folder and added to
 * `writtenExports`, so `revealWorkbook` can show it in Finder; its bytes
 * never cross the bridge at all (D3: no electron-updater, no in-place swap —
 * the operator runs the installer themselves).
 */
async function downloadVerifiedAsset(
  _event: IpcMainInvokeEvent,
  payload: unknown,
): Promise<DownloadVerifiedAssetResult> {
  const request = parseDownloadVerifiedAssetRequest(payload);
  if (!request) return { ok: false, reason: 'invalid-request' };

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

  if (request.isTheme) {
    return { ok: true, kind: 'theme', text: Buffer.from(assetBytes).toString('utf-8') };
  }

  try {
    const destination = path.join(app.getPath('downloads'), request.suggestedName);
    await fs.writeFile(destination, assetBytes);
    writtenExports.add(destination);
    return { ok: true, kind: 'app', path: destination, bytes: assetBytes.byteLength };
  } catch {
    return { ok: false, reason: 'write-failed' };
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
