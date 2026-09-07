import { useEffect, useRef } from 'react';
import { ArrowLeft } from 'lucide-react';
import type { SessionSummary as SessionSummaryData } from '@/scanner/use-attendance-session';

type SessionSummaryProps = {
  summary: SessionSummaryData;
  onExport: () => void;
  onStartNewSession: () => void;
  /** Closes the summary and returns to scanning; rotates nothing. */
  onDismiss: () => void;
  /**
   * True while the new-session confirmation is stacked on top. Escape then
   * belongs to that dialog alone — both listeners sit on the window, so
   * without this one press would answer the question *and* close the summary
   * behind it.
   */
  isCovered?: boolean;
};

export function SessionSummary({
  summary,
  onExport,
  onStartNewSession,
  onDismiss,
  isCovered = false,
}: SessionSummaryProps) {
  const dismissRef = useRef<HTMLButtonElement>(null);
  // Whatever had focus when End Session was pressed, so closing the summary
  // hands the keyboard back rather than dropping it on the body.
  const previouslyFocused = useRef<Element | null>(null);

  // Claiming aria-modal while leaving focus on the page behind is a lie to a
  // screen reader, so the least destructive control takes it — and a stray
  // Enter then closes the summary instead of rotating the session.
  useEffect(() => {
    previouslyFocused.current = document.activeElement;
    dismissRef.current?.focus();

    return () => {
      const previous = previouslyFocused.current;
      if (
        previous instanceof HTMLElement &&
        document.contains(previous)
      ) {
        previous.focus();
      }
    };
  }, []);

  // On the window rather than the dialog: the scanner's hidden input competes
  // for focus, and Escape has to work wherever focus ended up.
  useEffect(() => {
    if (isCovered) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onDismiss();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isCovered, onDismiss]);

  return (
    <div className="fixed inset-0 z-20 grid place-items-center bg-[hsl(var(--background)/.88)] px-5 py-8 backdrop-blur-sm">
      <section
        className="w-full max-w-xl rounded-[1.7rem] border border-[hsl(var(--primary)/.55)] bg-[hsl(var(--card))] p-6 shadow-[0_24px_90px_hsl(211_55%_5%/.5)] sm:p-8"
        role="dialog"
        aria-modal="true"
        aria-labelledby="session-summary-title"
        data-testid="dialog-session-summary"
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
          Taps from this session stay saved on this device. Starting a new
          session begins a fresh count without deleting them; the dashboard
          exports every session ever recorded here.
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
            className="rounded-xl bg-[hsl(var(--primary))] px-4 py-3 text-sm font-bold text-[hsl(var(--primary-foreground))] transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
            data-testid="button-summary-export"
          >
            Export this session
          </button>
          <button
            type="button"
            onClick={onStartNewSession}
            className="rounded-xl border border-[hsl(var(--border))] px-4 py-3 text-sm font-bold text-[hsl(var(--foreground))] transition hover:bg-[hsl(var(--secondary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
            data-testid="button-summary-new-session"
          >
            Start New Session
          </button>
        </div>
        {/* End Session sits beside the reader on a kiosk, so it gets pressed by
            accident. Leaving is free: this session keeps its count. */}
        <button
          ref={dismissRef}
          type="button"
          onClick={onDismiss}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-semibold text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--secondary))] hover:text-[hsl(var(--foreground))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
          data-testid="button-summary-dismiss"
        >
          <ArrowLeft aria-hidden="true" size={14} />
          Back to scanning
        </button>
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
