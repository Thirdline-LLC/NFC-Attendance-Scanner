import { useRef, useState } from 'react';
import { Palette, Upload, RotateCcw, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * PIN-gated theme management section in the Dashboard.
 *
 * Provides Install, Activate (if a pack is installed but not active), and
 * Revert controls. Never touches IndexedDB — only localStorage + CSS vars.
 */
export function ThemeAdminPanel() {
  const { active, isCustom, installPack, revertToDefault } = useTheme();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [installing, setInstalling] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setInstalling(true);
    setNotice(null);
    try {
      const json = await file.text();
      const err = await installPack(json);
      if (err) {
        setNotice({ kind: 'err', text: err });
      } else {
        setNotice({ kind: 'ok', text: 'Theme installed and applied.' });
      }
    } catch {
      setNotice({ kind: 'err', text: 'Could not read the theme file.' });
    } finally {
      setInstalling(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  function handleRevert() {
    revertToDefault();
    setNotice({ kind: 'ok', text: 'Reverted to the default Tapin theme.' });
  }

  const btnBase =
    'flex items-center gap-2 rounded-full border px-4 py-2 text-[11px] font-bold uppercase tracking-[0.14em] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] disabled:cursor-not-allowed disabled:opacity-50';
  const btnDefault = `${btnBase} border-[hsl(var(--border))] bg-[hsl(var(--card)/.68)] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--secondary))]`;
  const btnDestructive = `${btnBase} border-[hsl(var(--destructive)/.6)] text-[hsl(var(--destructive))] hover:bg-[hsl(var(--destructive)/.12)]`;

  return (
    <div
      className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-sm"
      data-testid="theme-admin-panel"
    >
      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-[hsl(var(--muted-foreground))]">
        <Palette aria-hidden="true" size={14} />
        Theme
      </div>

      <div className="mt-3 flex items-baseline gap-2">
        <span
          className="font-mono text-sm font-semibold text-[hsl(var(--foreground))]"
          data-testid="theme-active-id"
        >
          {active.meta.packName ?? active.meta.id}
        </span>
        <span
          className="text-xs text-[hsl(var(--muted-foreground))]"
          data-testid="theme-active-version"
        >
          v{active.meta.version}
        </span>
      </div>

      {active.meta.orgName !== 'Tapin' && (
        <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
          {active.meta.orgName}
        </p>
      )}

      {notice ? (
        <div
          className={`mt-3 flex items-start gap-2 rounded-xl border px-3 py-2 text-xs ${
            notice.kind === 'ok'
              ? 'border-[hsl(var(--accent)/.4)] bg-[hsl(var(--accent)/.08)] text-[hsl(var(--foreground))]'
              : 'border-[hsl(var(--destructive)/.4)] bg-[hsl(var(--destructive)/.08)] text-[hsl(var(--destructive))]'
          }`}
          data-testid="theme-notice"
        >
          {notice.kind === 'ok' ? (
            <CheckCircle2 aria-hidden="true" size={13} className="mt-0.5 shrink-0" />
          ) : (
            <AlertTriangle aria-hidden="true" size={13} className="mt-0.5 shrink-0" />
          )}
          <span>{notice.text}</span>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={installing}
          className={btnDefault}
          data-testid="button-install-theme"
        >
          <Upload aria-hidden="true" size={13} />
          {installing ? 'Installing…' : 'Install pack'}
        </button>

        {isCustom ? (
          <button
            type="button"
            onClick={handleRevert}
            className={btnDestructive}
            data-testid="button-revert-theme"
          >
            <RotateCcw aria-hidden="true" size={13} />
            Revert to default
          </button>
        ) : null}
      </div>

      <p className="mt-3 text-[10px] text-[hsl(var(--muted-foreground))]">
        Install a <code className="font-mono">.nfc-theme</code> file from a GitHub
        Release. Themes are branding only — no student records.
      </p>

      <input
        ref={fileInputRef}
        type="file"
        accept=".nfc-theme,.json"
        className="sr-only"
        aria-hidden="true"
        onChange={handleFileChange}
        data-testid="input-theme-file"
      />
    </div>
  );
}
