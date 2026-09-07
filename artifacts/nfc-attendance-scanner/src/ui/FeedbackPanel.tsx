import { Database, ShieldCheck } from 'lucide-react';
import type {
  ScanFeedback,
  ScannerMode,
} from '@/scanner/use-attendance-session';
import type { Person } from '@/data/attendance-store';
import { maskCardUid } from '@/lib/scan-format';
import { StatusIcon } from '@/ui/StatusIcon';

type FeedbackPanelProps = {
  feedback: ScanFeedback;
  mode: ScannerMode;
  lastUid: string;
  lastPerson?: Person;
  lastScannedAt: string;
  isSaving: boolean;
  /**
   * True once the opening read has confirmed there is nobody on this device.
   * That is the state a kiosk is in on its very first morning, and the idle
   * panel is the only thing a volunteer reads before their first tap — so it
   * has to name the step that has to happen before a card can check anyone
   * in. The caller keeps the "still loading" case out of it, so a device with
   * a roster never flashes the first-run wording while the store opens.
   */
  rosterEmpty: boolean;
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
  rosterEmpty,
}: FeedbackPanelProps) {
  const personName = lastPerson ? displayName(lastPerson) : '';
  // Nobody enrolled: every card tapped here would come back "unknown", so the
  // resting state names the missing step instead of inviting a tap.
  const firstRun = rosterEmpty && mode === 'checkin';
  const title =
    feedback === 'duplicate'
      ? `${personName || 'Card'} already checked in`
      : feedback === 'unknown'
        ? `Unknown card ${maskCardUid(lastUid)} — tap saved`
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
                            : firstRun
                              ? 'No students enrolled yet'
                              : 'Ready for next tap';
  const detail =
    feedback === 'duplicate'
      ? `Already counted at ${formatTime(lastScannedAt)} — no need to tap again`
      : feedback === 'valid'
        ? `${personName} · ${formatTime(lastScannedAt)}`
        : feedback === 'unknown'
          ? 'Switch to Enroll and tap this card to add the student'
          : feedback === 'enrollment'
            ? 'Complete the student details below'
            : feedback === 'enrolled'
              ? `${personName} is enrolled — switch to Check-in to record attendance`
              : feedback === 'editing'
                ? 'Update the enrolled details below'
                : feedback === 'updated'
                  ? `${personName} is saved — switch to Check-in to record attendance`
                  : feedback === 'existing'
                    ? `${personName} is already in the local roster`
                    : feedback === 'invalid'
                      ? 'The scan did not match a 14-character card ID'
                      : feedback === 'storage-error'
                        ? 'Check browser storage and try again'
                        : feedback === 'storage-unavailable'
                          ? 'This device is not letting the app save — nothing was stored for this tap'
                          : firstRun
                            ? 'Switch to Enroll above, then tap a card to add the first student'
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
            {maskCardUid(lastUid)}
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
