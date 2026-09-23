import { AlertTriangle, X } from 'lucide-react';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * Floating teacher banner shown when a theme pack was corrupt/refused and
 * the app fell back to the default theme.
 */
export function ThemeBanner() {
  const { banner, dismissBanner } = useTheme();
  if (!banner) return null;

  return (
    <div
      role="alert"
      className="fixed inset-x-0 top-0 z-50 flex items-start gap-3 border-b border-[hsl(var(--destructive)/.5)] bg-[hsl(var(--destructive)/.12)] px-4 py-3 backdrop-blur-sm"
      data-testid="theme-banner"
    >
      <AlertTriangle
        aria-hidden="true"
        size={15}
        className="mt-0.5 shrink-0 text-[hsl(var(--destructive))]"
      />
      <p className="flex-1 text-xs text-[hsl(var(--foreground))]">{banner}</p>
      <button
        type="button"
        onClick={dismissBanner}
        className="shrink-0 rounded p-0.5 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
        aria-label="Dismiss theme warning"
        data-testid="button-dismiss-theme-banner"
      >
        <X aria-hidden="true" size={14} />
      </button>
    </div>
  );
}
