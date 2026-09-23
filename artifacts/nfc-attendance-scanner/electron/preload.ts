import { contextBridge, ipcRenderer } from 'electron';

import type {
  DesktopBridge,
  DownloadVerifiedAssetRequest,
  DownloadVerifiedAssetResult,
  WorkbookSaveRequest,
  WorkbookSaveResult,
} from '../src/platform/desktop-bridge';

/**
 * The whole bridge between the React app and the desktop shell.
 *
 * It exposes two verbs and no objects. `ipcRenderer` itself is never handed
 * over, so the renderer cannot invent a channel; neither is `require`,
 * `process`, `fs`, `shell` or anything else from Node or Electron. Everything
 * crossing here is a plain string or a plain object, which is also what lets
 * `contextBridge` copy it across the isolated-world boundary at all.
 *
 * The types come from the renderer's own `desktop-bridge.ts`, so this file and
 * the app it serves cannot disagree about the contract without failing to
 * compile.
 */
const bridge: DesktopBridge = {
  platform: 'electron',

  saveWorkbook(request: WorkbookSaveRequest): Promise<WorkbookSaveResult> {
    // Re-stated field by field rather than forwarded: whatever else the
    // renderer put on that object stays on the renderer's side of the bridge.
    return ipcRenderer.invoke('attendance:save-workbook', {
      filename: String(request.filename),
      base64: String(request.base64),
    });
  },

  revealWorkbook(path: string): Promise<boolean> {
    return ipcRenderer.invoke('attendance:reveal-workbook', String(path));
  },

  downloadVerifiedAsset(
    request: DownloadVerifiedAssetRequest,
  ): Promise<DownloadVerifiedAssetResult> {
    return ipcRenderer.invoke('attendance:download-verified-asset', {
      assetUrl: String(request.assetUrl),
      sha256Url: String(request.sha256Url),
      suggestedName: String(request.suggestedName),
      isTheme: Boolean(request.isTheme),
    });
  },

  openReleasesPage(): Promise<boolean> {
    return ipcRenderer.invoke('attendance:open-releases-page');
  },
};

contextBridge.exposeInMainWorld('attendanceDesktop', bridge);
