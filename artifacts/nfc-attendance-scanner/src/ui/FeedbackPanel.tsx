import { Database, ShieldCheck } from 'lucide-react';
import type {
  ScanFeedback,
  ScannerMode,
} from '@/scanner/use-attendance-session';
import type { Person } from '@/data/attendance-store';
import { StatusIcon } from '@/ui/StatusIcon';

type FeedbackPanelProps = {
  feedback: ScanFeedback;
  mode: ScannerMode;
  lastUid: string;
  lastPerson?: Person;
  lastScannedAt: string;
  isSaving: boolean;
};

function displayName(person: Person): string {
  return `${person.firstName} ${person.lastName.slice(0, 1)}.`;
}

function formatTime(timestamp: string): string {
  if (!timestamp) return '';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

export function FeedbackPanel({
  feedback,
  mode,
  lastUid,
  lastPerson,
  lastScannedAt,
  isSaving,
}: FeedbackPanelProps) {
  const lastFour = lastUid.slice(-4);
  const personName = lastPerson ? displayName(lastPerson) : '';
  const title =
    feedback === 'duplicate'
      ? `${personName || 'Card'} already checked in`
      : feedback === 'unknown'
        ? `Unknown card ••••${lastFour} — enroll later`
        : feedback === 'valid'
          ? 'Check-in recorded'
          : feedback === 'enrollment'
            ? 'Card ready to enroll'
            : feedback === 'enrolled'
              ? 'Enrollment saved'
              : feedback === 'editing'
                ? 'Card ready to edit'
                : feedback === 'updated'
                  ? 'Enrollment updated'
                  : feedback === 'existing'
                    ? 'Already enrolled'
                    : feedback === 'invalid'
                      ? 'Bad read — tap again'
                      : feedback === 'storage-error'
                        ? 'Could not save locally'
                        : feedback === 'storage-unavailable'
                          ? 'Card not recorded'
                          : mode === 'enroll'
                            ? 'Ready to enroll'
                            : 'Ready for next tap';
  const detail =
    feedback === 'valid' || feedback === 'duplicate'
      ? `${personName} · ${formatTime(lastScannedAt)}`
      : feedback === 'unknown'
        ? 'Add this card from Enroll mode'
        : feedback === 'enrollment'
          ? 'Complete the student details below'
          : feedback === 'enrolled'
            ? `${personName} is ready for check-in`
            : feedback === 'editing'
              ? 'Update the enrolled details below'
              : feedback === 'updated'
                ? `${personName} is ready for check-in`
                : feedback === 'existing'
                  ? `${personName} is already in the local roster`
                  : feedback === 'invalid'
                    ? 'The scan did not match a 14-character card ID'
                    : feedback === 'storage-error'
                      ? 'Check browser storage and try again'
                      : feedback === 'storage-unavailable'
                        ? 'This device is not letting the app save — nothing was stored for this tap'
                        : 'Hold a card or badge near the reader';
  const stateClass =
    feedback === 'valid' || feedback === 'enrolled' || feedback === 'updated'
      ? 'border-[hsl(var(--accent)/.7)] bg-[hsl(var(--accent)/.12)] text-[hsl(var(--accent))]'
      : feedback === 'duplicate' ||
          feedback === 'invalid' ||
          feedback === 'storage-error' ||
          feedback === 'storage-unavailable'
        ? 'border-[hsl(var(--destructive)/.7)] bg-[hsl(var(--destructive)/.1)] text-[hsl(var(--destructive))]'
        : 'border-[hsl(var(--primary)/.35)] bg-[hsl(var(--primary)/.06)] text-[hsl(var(--primary))]';

  return (
    <section
      className={`feedback-panel ${feedback === 'valid' || feedback === 'enrolled' || feedback === 'updated' ? 'feedback-success' : feedback === 'duplicate' || feedback === 'invalid' ? 'feedback-alert' : ''} rounded-[1.35rem] border p-5 transition-colors duration-300 sm:p-6 ${stateClass}`}
      data-testid="status-scan-feedback"
      aria-live="polite"
    >
      <div className="flex items-start gap-4">
        <div className="mt-0.5 flex size-12 shrink-0 items-center justify-center rounded-2xl bg-current/10">
          <StatusIcon feedback={feedback} />
        </div>
        <div className="min-w-0">
          <p className="font-display text-xl font-semibold leading-tight tracking-[-0.02em] text-[hsl(var(--foreground))]" data-testid="text-scan-status">
            {title}
          </p>
          {personName &&
            (feedback === 'valid' ||
              feedback === 'duplicate' ||
              feedback === 'enrolled' ||
              feedback === 'updated' ||
              feedback === 'editing' ||
              feedback === 'existing') && (
              <p className="mt-2 font-display text-2xl font-semibold tracking-[-0.03em] text-[hsl(var(--foreground))]">
                {personName}
              </p>
            )}
          <p className="mt-1.5 text-sm leading-5 text-[hsl(var(--muted-foreground))]">{detail}</p>
        </div>
      </div>
      <div className="mt-5 flex items-center justify-between gap-3 border-t border-current/15 pt-4">
        <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] opacity-75">
          <Database aria-hidden="true" size={14} />
          {isSaving ? 'Saving locally' : 'Local record'}
        </span>
        {lastUid ? (
          <span className="font-mono text-sm font-bold tracking-[0.16em] text-[hsl(var(--foreground))]" data-testid="text-last-uid">
            •••• {lastFour}
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