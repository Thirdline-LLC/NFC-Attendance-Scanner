import { CheckCircle2, AlertTriangle, Download, ExternalLink, RefreshCw } from 'lucide-react';
import { formatSessionDateTime } from '@/lib/session-formatting';
import { useUpdateChecker } from './useUpdateChecker';

const btnBase =
  'flex items-center gap-2 rounded-full border px-4 py-2 text-[11px] font-bold uppercase tracking-[0.14em] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] disabled:cursor-not-allowed disabled:opacity-50';
const btnDefault = `${btnBase} border-[hsl(var(--border))] bg-[hsl(var(--card)/.68)] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--secondary))]`;
const btnPrimary = `${btnBase} border-[hsl(var(--primary)/.55)] bg-[hsl(var(--primary)/.12)] text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary)/.2)]`;

function Notice({ notice, testId }: { notice: { kind: 'ok' | 'err'; text: string } | null; testId: string }) {
  if (!notice) return null;
  return (
    <div
      className={`mt-2 flex items-start gap-2 rounded-xl border px-3 py-2 text-xs ${
        notice.kind === 'ok'
          ? 'border-[hsl(var(--accent)/.4)] bg-[hsl(var(--accent)/.08)] text-[hsl(var(--foreground))]'
          : 'border-[hsl(var(--destructive)/.4)] bg-[hsl(var(--destructive)/.08)] text-[hsl(var(--destructive))]'
      }`}
      role={notice.kind === 'err' ? 'alert' : 'status'}
      data-testid={testId}
    >
      {notice.kind === 'ok' ? (
        <CheckCircle2 aria-hidden="true" size={13} className="mt-0.5 shrink-0" />
      ) : (
        <AlertTriangle aria-hidden="true" size={13} className="mt-0.5 shrink-0" />
      )}
      <span>{notice.text}</span>
    </div>
  );
}

/**
 * PIN-gated Update card (Plan 07). Lives in the Dashboard next to the theme
 * panel — reachable only through `/dashboard`, which `LockedRoute` already
 * gates on the teacher PIN, so this needs no gate of its own.
 *
 * App and theme updates are kept visibly separate (design's own instruction):
 * one binary the operator installs themselves, one pack this app activates
 * through Plan 04's own loader. Verified download only runs on the Electron
 * shell — see `useUpdateChecker` for why the other two show a manual link
 * instead of quietly downloading nothing.
 */
export function UpdateCard() {
  const {
    state,
    lastChecked,
    check,
    target,
    currentVersion,
    activeTheme,
    canVerifiedInstall,
    appBusy,
    appNotice,
    downloadApp,
    themeBusy,
    themeNotice,
    installTheme,
    openManualLink,
  } = useUpdateChecker();

  const checking = state.status === 'checking';

  return (
    <div
      className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-sm"
      data-testid="update-card"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-[hsl(var(--muted-foreground))]">
          <Download aria-hidden="true" size={14} />
          Updates
        </div>
        <button
          type="button"
          onClick={() => void check()}
          disabled={checking}
          className={btnDefault}
          data-testid="button-check-updates"
        >
          <RefreshCw aria-hidden="true" size={13} className={checking ? 'animate-spin' : undefined} />
          {checking ? 'Checking…' : 'Check for updates'}
        </button>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-[hsl(var(--muted-foreground))]">
        <dt>This app</dt>
        <dd className="text-right font-mono text-[hsl(var(--foreground))]" data-testid="text-app-version">
          v{currentVersion}
        </dd>
        <dt>Active theme</dt>
        <dd className="text-right font-mono text-[hsl(var(--foreground))]" data-testid="text-active-theme">
          {activeTheme.id}
          {activeTheme.isCustom ? ` v${activeTheme.version}` : ''}
        </dd>
        <dt>Last checked</dt>
        <dd className="text-right text-[hsl(var(--foreground))]" data-testid="text-last-checked">
          {lastChecked ? formatSessionDateTime(lastChecked) : 'Never'}
        </dd>
      </dl>

      {state.status === 'error' ? (
        <div
          className="mt-3 flex items-start gap-2 rounded-xl border border-[hsl(var(--destructive)/.4)] bg-[hsl(var(--destructive)/.08)] px-3 py-2 text-xs text-[hsl(var(--destructive))]"
          role="alert"
          data-testid="text-update-error"
        >
          <AlertTriangle aria-hidden="true" size={13} className="mt-0.5 shrink-0" />
          <span>
            {state.message}{' '}
            <button
              type="button"
              onClick={openManualLink}
              className="font-semibold underline underline-offset-2"
              data-testid="link-manual-releases-error"
            >
              Get it manually from the release page.
            </button>
          </span>
        </div>
      ) : null}

      {state.status === 'checked' ? (
        <div className="mt-4 grid gap-3">
          <section className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background)/.5)] p-3">
            <p className="text-xs font-bold uppercase tracking-[0.12em] text-[hsl(var(--muted-foreground))]">
              App update
            </p>
            <p className="mt-1.5 text-sm text-[hsl(var(--foreground))]" data-testid="text-app-update-status">
              {state.app.available
                ? `v${state.app.latestVersion} is available (this device is on v${currentVersion}).`
                : target === 'web'
                  ? 'This web app updates itself — no separate installer to check.'
                  : state.app.reason === 'no-asset'
                    ? 'The latest release has no installer published for this build.'
                    : `Up to date (v${currentVersion}).`}
            </p>
            {state.app.available ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {canVerifiedInstall ? (
                  <button
                    type="button"
                    onClick={() => void downloadApp()}
                    disabled={appBusy}
                    className={btnPrimary}
                    data-testid="button-download-app"
                  >
                    <Download aria-hidden="true" size={13} />
                    {appBusy ? 'Downloading…' : 'Download & verify'}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={openManualLink}
                  className={btnDefault}
                  data-testid="link-manual-releases-app"
                >
                  <ExternalLink aria-hidden="true" size={13} />
                  View release
                </button>
              </div>
            ) : null}
            <Notice notice={appNotice} testId="text-app-notice" />
          </section>

          <section className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background)/.5)] p-3">
            <p className="text-xs font-bold uppercase tracking-[0.12em] text-[hsl(var(--muted-foreground))]">
              Theme pack
            </p>
            <p className="mt-1.5 text-sm text-[hsl(var(--foreground))]" data-testid="text-theme-update-status">
              {!activeTheme.isCustom
                ? 'The default theme has no pack to update — install one below to enable this.'
                : state.theme.available
                  ? `v${state.theme.latestVersion} is available (this device has v${activeTheme.version}).`
                  : state.theme.reason === 'no-asset'
                    ? 'The latest release has no pack published for this theme.'
                    : `Up to date (v${activeTheme.version}).`}
            </p>
            {state.theme.available ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {canVerifiedInstall ? (
                  <button
                    type="button"
                    onClick={() => void installTheme()}
                    disabled={themeBusy}
                    className={btnPrimary}
                    data-testid="button-install-theme-update"
                  >
                    <Download aria-hidden="true" size={13} />
                    {themeBusy ? 'Installing…' : 'Download & install'}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={openManualLink}
                  className={btnDefault}
                  data-testid="link-manual-releases-theme"
                >
                  <ExternalLink aria-hidden="true" size={13} />
                  View release
                </button>
              </div>
            ) : null}
            <Notice notice={themeNotice} testId="text-theme-notice" />
          </section>
        </div>
      ) : null}

      {!canVerifiedInstall && state.status === 'checked' && (state.app.available || state.theme.available) ? (
        <p className="mt-3 text-[10px] text-[hsl(var(--muted-foreground))]">
          Verified in-app download is only available in the macOS app — GitHub's
          release files do not allow a browser to download and check them
          directly. Use the release page to get them here.
        </p>
      ) : null}
    </div>
  );
}
