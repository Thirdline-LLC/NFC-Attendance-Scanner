import type { SessionSummary as SessionSummaryData } from '@/scanner/use-attendance-session';

type SessionSummaryProps = {
  summary: SessionSummaryData;
  onExport: () => void;
  onStartNewSession: () => void;
};

export function SessionSummary({
  summary,
  onExport,
  onStartNewSession,
}: SessionSummaryProps) {
  return (
    <div className="fixed inset-0 z-20 grid place-items-center bg-[hsl(var(--background)/.88)] px-5 py-8 backdrop-blur-sm">
      <section
        className="w-full max-w-xl rounded-[1.7rem] border border-[hsl(var(--primary)/.55)] bg-[hsl(var(--card))] p-6 shadow-[0_24px_90px_hsl(211_55%_5%/.5)] sm:p-8"
        role="dialog"
        aria-modal="true"
        aria-labelledby="session-summary-title"
      >
        <p className="text-xs font-bold uppercase tracking-[0.22em] text-[hsl(var(--accent))]">
          Teacher controls
        </p>
        <h2
          id="session-summary-title"
          className="mt-2 font-display text-3xl font-semibold tracking-[-0.04em] text-[hsl(var(--foreground))]"
        >
          Session complete
        </h2>
        <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">
          The session remains stored locally until you start a new one.
        </p>
        <div className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <SummaryMetric label="Unique attendance" value={summary.uniqueAttendance} />
          <SummaryMetric label="Total taps" value={summary.totalTaps} />
          <SummaryMetric label="Duplicate taps" value={summary.duplicateTaps} />
          <SummaryMetric label="Unknown cards" value={summary.unknownCards} />
        </div>
        <div className="mt-7 grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={onExport}
            className="rounded-xl bg-[hsl(var(--primary))] px-4 py-3 text-sm font-bold text-[hsl(var(--primary-foreground))] transition hover:brightness-105"
          >
            Export to Excel
          </button>
          <button
            type="button"
            onClick={onStartNewSession}
            className="rounded-xl border border-[hsl(var(--border))] px-4 py-3 text-sm font-bold text-[hsl(var(--foreground))] transition hover:bg-[hsl(var(--secondary))]"
          >
            Start New Session
          </button>
        </div>
      </section>
    </div>
  );
}

function SummaryMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--background)/.5)] p-3">
      <p className="font-display text-2xl font-semibold text-[hsl(var(--foreground))]">
        {value}
      </p>
      <p className="mt-1 text-[10px] font-semibold uppercase leading-4 tracking-[0.12em] text-[hsl(var(--muted-foreground))]">
        {label}
      </p>
    </div>
  );
}