import { Database, ShieldCheck } from 'lucide-react';
import type { ScanFeedback } from '@/scanner/use-scanner-session';
import { StatusIcon } from '@/ui/StatusIcon';

type FeedbackPanelProps = {
  feedback: ScanFeedback;
  lastUid: string;
  isSaving: boolean;
};

const feedbackCopy: Record<ScanFeedback, { title: string; detail: string }> = {
  ready: {
    title: 'Ready for next tap',
    detail: 'Hold a card or badge near the reader',
  },
  valid: {
    title: 'Check-in recorded',
    detail: 'This attendance is saved on this device',
  },
  duplicate: {
    title: 'Already checked in',
    detail: 'This card has already been counted',
  },
  invalid: {
    title: 'Bad read — tap again',
    detail: 'The scan did not match a 14-character card ID',
  },
};

export function FeedbackPanel({ feedback, lastUid, isSaving }: FeedbackPanelProps) {
  const copy = feedbackCopy[feedback];
  const stateClass =
    feedback === 'valid'
      ? 'border-[hsl(var(--accent)/.7)] bg-[hsl(var(--accent)/.12)] text-[hsl(var(--accent))]'
      : feedback === 'duplicate' || feedback === 'invalid'
        ? 'border-[hsl(var(--destructive)/.7)] bg-[hsl(var(--destructive)/.1)] text-[hsl(var(--destructive))]'
        : 'border-[hsl(var(--primary)/.35)] bg-[hsl(var(--primary)/.06)] text-[hsl(var(--primary))]';

  return (
    <section
      className={`feedback-panel ${feedback === 'valid' ? 'feedback-success' : feedback === 'duplicate' || feedback === 'invalid' ? 'feedback-alert' : ''} rounded-[1.35rem] border p-5 transition-colors duration-300 sm:p-6 ${stateClass}`}
      data-testid="status-scan-feedback"
      aria-live="polite"
    >
      <div className="flex items-start gap-4">
        <div className="mt-0.5 flex size-12 shrink-0 items-center justify-center rounded-2xl bg-current/10">
          <StatusIcon feedback={feedback} />
        </div>
        <div className="min-w-0">
          <p className="font-display text-xl font-semibold leading-tight tracking-[-0.02em] text-[hsl(var(--foreground))]" data-testid="text-scan-status">
            {copy.title}
          </p>
          <p className="mt-1.5 text-sm leading-5 text-[hsl(var(--muted-foreground))]">{copy.detail}</p>
        </div>
      </div>
      <div className="mt-5 flex items-center justify-between gap-3 border-t border-current/15 pt-4">
        <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] opacity-75">
          <Database aria-hidden="true" size={14} />
          {isSaving ? 'Saving locally' : 'Local record'}
        </span>
        {lastUid ? (
          <span className="font-mono text-sm font-bold tracking-[0.16em] text-[hsl(var(--foreground))]" data-testid="text-last-uid">
            •••• {lastUid.slice(-4)}
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-xs text-[hsl(var(--muted-foreground))]">
            <ShieldCheck aria-hidden="true" size={14} />
            No card yet
          </span>
        )}
      </div>
    </section>
  );
}