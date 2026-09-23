import { useCallback, useState } from 'react';
import { loadThemePack } from '@workspace/themes';
import {
  decideAppUpdate,
  decideThemeUpdate,
  fetchLatestRelease,
  isNewerVersion,
  type AppUpdateDecision,
  type ThemeUpdateDecision,
  type UpdateErrorKind,
} from '@workspace/update';
import type { DownloadVerifiedAssetResult } from '@/platform/desktop-bridge';
import { getDesktopBridge } from '@/platform/desktop-bridge';
import { appVersion, buildTarget } from '@/platform/runtime';
import { useTheme } from '@/theme/ThemeProvider';
import { RELEASES_PAGE_URL, UPDATE_REPO_NAME, UPDATE_REPO_OWNER } from './repo-config';

const LAST_CHECKED_KEY = 'nfc-update:last-checked';

/** Best-effort: a missed read/write only means "last checked" is briefly stale. */
function readLastChecked(): string | null {
  try {
    return localStorage.getItem(LAST_CHECKED_KEY);
  } catch {
    return null;
  }
}

function writeLastChecked(at: string): void {
  try {
    localStorage.setItem(LAST_CHECKED_KEY, at);
  } catch {
    // See above.
  }
}

export type CheckState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'error'; message: string; kind: UpdateErrorKind }
  | { status: 'checked'; app: AppUpdateDecision; theme: ThemeUpdateDecision };

export type InstallNotice = { kind: 'ok' | 'err'; text: string } | null;

function describeDownloadFailure(
  reason: Extract<DownloadVerifiedAssetResult, { ok: false }>['reason'],
): string {
  switch (reason) {
    case 'checksum':
      return 'The download did not match its published checksum. Refused — get it manually from the release page.';
    case 'network':
      return 'Could not reach GitHub to download this.';
    case 'http-error':
      return 'GitHub returned an error while downloading this.';
    case 'write-failed':
      return 'The file could not be saved to Downloads.';
    case 'invalid-request':
      return 'The desktop shell refused this download request.';
  }
}

/**
 * Drives the Update card. Metadata check (available yes/no, latest version)
 * runs identically on every shell — the GitHub REST API sends CORS headers on
 * that endpoint. Verified download only runs where it is possible: the
 * Electron main process, which is not subject to the CORS that blocks a
 * `fetch` of the asset bytes themselves everywhere else (see
 * `electron/main.ts`). Elsewhere, "available" links to the Release page for a
 * manual download — the same fallback the design already uses for offline.
 */
export function useUpdateChecker() {
  const { active, isCustom, installPack } = useTheme();
  const [state, setState] = useState<CheckState>({ status: 'idle' });
  const [lastChecked, setLastChecked] = useState<string | null>(() => readLastChecked());
  const [appNotice, setAppNotice] = useState<InstallNotice>(null);
  const [themeNotice, setThemeNotice] = useState<InstallNotice>(null);
  const [appBusy, setAppBusy] = useState(false);
  const [themeBusy, setThemeBusy] = useState(false);

  const target = buildTarget();
  const currentVersion = appVersion();
  const desktop = getDesktopBridge();

  const check = useCallback(async () => {
    setState({ status: 'checking' });
    setAppNotice(null);
    setThemeNotice(null);

    const result = await fetchLatestRelease(UPDATE_REPO_OWNER, UPDATE_REPO_NAME, {
      fetchImpl: (url, init) => fetch(url, init),
    });

    if (!result.ok) {
      setState({ status: 'error', message: result.message, kind: result.error });
      return;
    }

    const app = decideAppUpdate(currentVersion, target, result.value);
    const theme = isCustom
      ? decideThemeUpdate(active.meta.id, active.meta.version, result.value)
      : ({ available: false, reason: 'default-theme' } as const);

    const now = new Date().toISOString();
    writeLastChecked(now);
    setLastChecked(now);
    setState({ status: 'checked', app, theme });
  }, [currentVersion, target, isCustom, active.meta.id, active.meta.version]);

  const downloadApp = useCallback(async () => {
    if (state.status !== 'checked' || !state.app.available || !desktop) return;
    const { asset, sidecarAsset, latestVersion } = state.app;
    if (!sidecarAsset) {
      setAppNotice({
        kind: 'err',
        text: 'No checksum was published for this release — refusing to download it unverified. Get it from the release page.',
      });
      return;
    }

    setAppBusy(true);
    setAppNotice(null);
    try {
      const result = await desktop.downloadVerifiedAsset({
        assetUrl: asset.apiUrl,
        sha256Url: sidecarAsset.apiUrl,
        suggestedName: asset.name,
        isTheme: false,
      });
      if (!result.ok) {
        setAppNotice({ kind: 'err', text: describeDownloadFailure(result.reason) });
        return;
      }
      if (result.kind !== 'app') {
        setAppNotice({ kind: 'err', text: 'Unexpected response from the desktop shell.' });
        return;
      }
      await desktop.revealWorkbook(result.path);
      setAppNotice({
        kind: 'ok',
        text: `Downloaded and verified v${latestVersion}. Revealed in Finder — open it to install; this app does not replace itself.`,
      });
    } finally {
      setAppBusy(false);
    }
  }, [state, desktop]);

  const installTheme = useCallback(async () => {
    if (state.status !== 'checked' || !state.theme.available || !desktop) return;
    const { asset, sidecarAsset, latestVersion } = state.theme;
    if (!sidecarAsset) {
      setThemeNotice({
        kind: 'err',
        text: 'No checksum was published for this pack — refusing to install it unverified.',
      });
      return;
    }

    setThemeBusy(true);
    setThemeNotice(null);
    try {
      const result = await desktop.downloadVerifiedAsset({
        assetUrl: asset.apiUrl,
        sha256Url: sidecarAsset.apiUrl,
        suggestedName: asset.name,
        isTheme: true,
      });
      if (!result.ok) {
        setThemeNotice({ kind: 'err', text: describeDownloadFailure(result.reason) });
        return;
      }
      if (result.kind !== 'theme') {
        setThemeNotice({ kind: 'err', text: 'Unexpected response from the desktop shell.' });
        return;
      }

      const parsed = await loadThemePack(result.text);
      if (!parsed.ok) {
        setThemeNotice({ kind: 'err', text: parsed.error });
        return;
      }

      const minAppVersion = parsed.pack.meta.minAppVersion;
      if (minAppVersion && isNewerVersion(minAppVersion, currentVersion)) {
        setThemeNotice({
          kind: 'err',
          text: `This pack needs Tapin ${minAppVersion} or newer (this device is on ${currentVersion}). Update the app first.`,
        });
        return;
      }

      const installError = await installPack(result.text);
      if (installError) {
        setThemeNotice({ kind: 'err', text: installError });
        return;
      }
      setThemeNotice({ kind: 'ok', text: `Installed and activated v${latestVersion}.` });
    } finally {
      setThemeBusy(false);
    }
  }, [state, desktop, installPack, currentVersion]);

  const openManualLink = useCallback(() => {
    if (desktop) {
      // window.open()/target=_blank are denied in the desktop shell — see main.ts.
      void desktop.openReleasesPage();
    } else {
      window.open(RELEASES_PAGE_URL, '_blank', 'noopener,noreferrer');
    }
  }, [desktop]);

  return {
    state,
    lastChecked,
    check,
    target,
    currentVersion,
    releasesUrl: RELEASES_PAGE_URL,
    activeTheme: { id: active.meta.id, version: active.meta.version, isCustom },
    canVerifiedInstall: Boolean(desktop),
    appBusy,
    appNotice,
    downloadApp,
    themeBusy,
    themeNotice,
    installTheme,
    openManualLink,
  };
}
