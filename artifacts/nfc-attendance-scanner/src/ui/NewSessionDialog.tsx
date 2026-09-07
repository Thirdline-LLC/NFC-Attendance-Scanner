import { useEffect, useRef } from 'react';
import { AlertTriangle, Download, RotateCcw } from 'lucide-react';
import type { SessionMetrics } from '@/scanner/use-attendance-session';
import { formatSessionDateTime } from '@/lib/session-formatting';
import { ExportNotice, type ExportResult } from '@/ui/ExportNotice';
import { useModalFocusTrap } from '@/ui/use-modal-focus-trap';

type NewSessionDialogProps = {
  /** This session's figures, so the operator sees what is about to leave the screen. */
  metrics: SessionMetrics;
  /** The session's first tap, or its persisted start time before any tap. */
  sessionStartedAt: string;
  /** Runs the same export the summary offers. Deliberately leaves the dialog open. */
  onExport: () => void;
  /** What that export did, so "Export first" can be seen to have worked. */
  exportResult?: ExportResult;
  onConfirm: () => void;
  onCancel: () => void;
};

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/**
 * Rotating the session id deletes nothing — every tap stays in IndexedDB — but
 * from the front desk it looks like a wipe: the count drops to zero and this
 * screen's export stops covering those taps. That gap is worth one confirmation,
 * with the export offered inside the dialog so "export first" does not mean
 * "back out and find the other button".
 */
export function NewSessionDialog({
  metrics,
  sessionStartedAt,
  onExport,
  exportResult = null,
  onConfirm,
  onCancel,
}: NewSessionDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  // Whatever had the keyboard when the question was asked — usually "Start New
  // Session" in the summary underneath.
  const previouslyFocused = useRef<Element | null>(null);
  useModalFocusTrap(dialogRef);

  // Least destructive button first: a stray Enter on a kiosk must not rotate.
  // Focus is handed back on the way out, because the summary may still be open
  // behind this: it claims aria-modal, and cancelling used to drop the keyboard
  // on <body> inside it — ScannerScreen only refocuses the reader once every
  // overlay is gone.
  useEffect(() => {
    previouslyFocused.current = document.activeElement;
    cancelRef.current?.focus();

    return () => {
      const previous = previouslyFocused.current;
      if (previous instanceof HTMLElement && document.contains(previous)) {
        previous.focus();
      }
    };
  }, []);

  // On the window rather than the dialog: the scanner's hidden input and the
  // summary underneath both compete for focus, and Escape has to work anyway.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onCancel();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  return (
    // Scrolls, and centres through the child's `m-auto`, so no button can end
    // up off-screen on a short viewport. See SessionSummary for the why.
    <div
      ref={dialogRef}
      className="fixed inset-0 z-50 flex overflow-y-auto overscroll-contain bg-[hsl(var(--background)/.86)] px-5 py-8 backdrop-blur-sm"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="new-session-title"
      data-testid="dialog-new-session"
    >
      <div className="m-auto w-full max-w-md rounded-[1.35rem] border border-[hsl(var(--destructive)/.5)] bg-[hsl(var(--card))] p-5 shadow-[0_24px_90px_hsl(211_55%_5%/.5)] sm:p-6">
        <div className="flex items-start gap-2.5">
          <AlertTriangle
            aria-hidden="true"
            className="mt-0.5 shrink-0 text-[hsl(var(--destructive))]"
            size={18}
          />
          <div className="min-w-0">
            <h2
              id="new-session-title"
              className="font-display text-lg font-semibold tracking-[-0.02em] text-[hsl(var(--foreground))]"
            >
              Start a new session?
            </h2>
            <p
              className="mt-2 text-sm leading-snug text-[hsl(var(--muted-foreground))]"
              data-testid="text-new-session-counts"
            >
              This session has {plural(metrics.totalTaps, 'tap')} and{' '}
              {metrics.uniqueAttendance} checked in.
            </p>
            <p
              className="mt-2 text-sm font-semibold leading-snug text-[hsl(var(--foreground))]"
              data-testid="text-new-session-meeting"
            >
              Meeting date and time: {formatSessionDateTime(sessionStartedAt)}
            </p>
          </div>
        </div>

        <p className="mt-3 text-sm leading-snug text-[hsl(var(--muted-foreground))]">
          Those taps stay saved on this device, but they will no longer appear
          on this screen or in this screen&rsquo;s export. Export first if you
          have not already.
        </p>

        <button
          type="button"
          onClick={onExport}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-[hsl(var(--primary))] px-4 py-3 text-sm font-bold text-[hsl(var(--primary-foreground))] transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
          data-testid="button-dialog-export"
        >
          <Download aria-hidden="true" size={15} />
          Export first
        </button>

        <ExportNotice result={exportResult} />
        <button
          type="button"
          onClick={onConfirm}
          className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-[hsl(var(--destructive)/.6)] bg-[hsl(var(--destructive)/.12)] px-4 py-3 text-sm font-bold text-[hsl(var(--destructive))] transition hover:bg-[hsl(var(--destructive)/.2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
          data-testid="button-dialog-confirm"
        >
          <RotateCcw aria-hidden="true" size={15} />
          Start new session
        </button>
        <button
          ref={cancelRef}
          type="button"
          onClick={onCancel}
          className="mt-3 w-full text-xs font-semibold text-[hsl(var(--muted-foreground))] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
          data-testid="button-dialog-cancel"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
