import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, BarChart3, RotateCcw } from 'lucide-react';
import { listPersons, listTapRecords } from '@/data/attendance-store';
import {
  computeDashboardMetrics,
  type DashboardMetrics,
} from '@/lib/attendance-metrics';
import { Dashboard } from '@/ui/Dashboard';

/**
 * The container behind `Dashboard`: it reads the whole tap history and the
 * roster together and folds them into metrics. Both reads happen in one pass so
 * a tap recorded between them cannot be counted against a roster that predates
 * it.
 */
export function DashboardPage() {
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadFailed(false);
    try {
      const [taps, persons] = await Promise.all([
        listTapRecords(),
        listPersons(),
      ]);
      // The school-year boundary and every grade label hang off `now`, so it is
      // read once here rather than inside the metrics.
      setMetrics(
        computeDashboardMetrics(taps, persons, new Date().toISOString()),
      );
    } catch {
      setLoadFailed(true);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main
      className="grain relative min-h-[100dvh] overflow-hidden bg-[hsl(var(--background))]"
      data-testid="dashboard-page"
    >
      <div className="pointer-events-none absolute -left-40 -top-48 size-[34rem] rounded-full bg-[hsl(var(--accent)/.055)] blur-3xl" />
      <div className="pointer-events-none absolute -bottom-56 -right-32 size-[34rem] rounded-full bg-[hsl(var(--primary)/.05)] blur-3xl" />

      <div className="relative mx-auto flex w-full max-w-5xl flex-col gap-5 py-5 sm:py-7">
        <header
          className="station-enter flex flex-wrap items-center justify-between gap-3 px-5 sm:px-8"
          data-testid="header-dashboard"
        >
          <Link
            to="/"
            className="flex items-center gap-2 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--card)/.68)] px-3 py-2 text-[11px] font-bold uppercase tracking-[0.14em] text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--secondary))] hover:text-[hsl(var(--foreground))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
            data-testid="link-scanner"
          >
            <ArrowLeft aria-hidden="true" size={14} />
            Back to scanner
          </Link>
          <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.19em] text-[hsl(var(--muted-foreground))]">
            <BarChart3 aria-hidden="true" size={14} className="text-[hsl(var(--accent))]" />
            Year to date
          </p>
        </header>

        {/* A refresh that fails keeps the numbers already on screen; they are
            still true, only older than the button implied. */}
        {loadFailed && metrics ? (
          <p
            className="station-enter mx-5 flex items-start gap-2.5 rounded-2xl border border-[hsl(var(--destructive)/.5)] bg-[hsl(var(--destructive)/.09)] px-4 py-3 text-sm text-[hsl(var(--destructive))] sm:mx-8"
            role="alert"
            data-testid="text-dashboard-stale"
          >
            <AlertTriangle aria-hidden="true" className="mt-0.5 shrink-0" size={16} />
            <span>
              Could not re-read this device’s storage. These numbers are from
              the last successful read.
            </span>
          </p>
        ) : null}

        {loadFailed && !metrics ? (
          <section
            className="station-enter mx-5 rounded-[1.7rem] border border-[hsl(var(--destructive)/.5)] bg-[hsl(var(--card)/.88)] p-5 sm:mx-8 sm:p-7"
            role="alert"
            data-testid="text-dashboard-load-error"
          >
            <div className="flex items-start gap-3 text-[hsl(var(--destructive))]">
              <AlertTriangle aria-hidden="true" size={22} strokeWidth={2.2} className="mt-0.5 shrink-0" />
              <div className="min-w-0">
                <h2 className="font-display text-lg font-semibold tracking-[-0.02em] text-[hsl(var(--foreground))]">
                  Could not read this device’s attendance
                </h2>
                <p className="mt-1.5 text-sm leading-5 text-[hsl(var(--muted-foreground))]">
                  Nothing has been deleted — the taps are still on the device,
                  and the exported Excel file is unaffected.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void load()}
              disabled={isLoading}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg border border-[hsl(var(--destructive)/.6)] px-3 py-2 text-xs font-bold uppercase tracking-[0.14em] text-[hsl(var(--destructive))] transition hover:bg-[hsl(var(--destructive)/.12)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] disabled:cursor-not-allowed disabled:opacity-60 sm:w-fit"
              data-testid="button-dashboard-retry"
            >
              <RotateCcw aria-hidden="true" size={14} />
              Retry
            </button>
          </section>
        ) : null}

        {!metrics && !loadFailed ? (
          <p
            className="station-enter mx-5 rounded-[1.7rem] border border-dashed border-[hsl(var(--primary)/.34)] bg-[hsl(var(--card)/.5)] px-5 py-10 text-center text-sm text-[hsl(var(--muted-foreground))] sm:mx-8"
            aria-busy="true"
            data-testid="text-dashboard-loading"
          >
            Adding up this device’s attendance…
          </p>
        ) : null}

        {metrics ? (
          <div className="station-enter" style={{ animationDelay: '80ms' }}>
            <Dashboard
              metrics={metrics}
              isLoading={isLoading}
              onRefresh={() => void load()}
            />
          </div>
        ) : null}
      </div>
    </main>
  );
}
