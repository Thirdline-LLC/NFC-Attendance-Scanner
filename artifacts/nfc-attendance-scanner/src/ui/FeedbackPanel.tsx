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
  /** When a repeat tap's student was actually counted; falls back to the tap. */
  lastCountedAt?: string;
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

/** The scan, as the two lines of copy need to see it. */
type PanelWording = {
  personName: string;
  lastUid: string;
  lastScannedAt: string;
  lastCountedAt: string;
};

/** The outcomes worth a tick and the accent colour. */
function isSuccess(feedback: ScanFeedback): boolean {
  return (
    feedback === 'valid' ||
    feedback === 'enrolled' ||
    feedback === 'updated' ||
    feedback === 'bound'
  );
}

function panelTitle(
  feedback: ScanFeedback,
  mode: ScannerMode,
  firstRun: boolean,
  { personName, lastUid }: PanelWording,
): string {
  switch (feedback) {
    case 'duplicate':
      return `${personName || 'Card'} already checked in`;
    case 'unknown':
      return `Unknown card ${maskCardUid(lastUid)} — tap saved`;
    case 'valid':
      return 'Check-in recorded';
    case 'enrollment':
      return 'Card ready to enroll';
    case 'enrolled':
      return 'Enrollment saved';
    case 'editing':
      return 'Card ready to edit';
    case 'updated':
      return 'Enrollment updated';
    case 'existing':
      return 'Already enrolled';
    case 'bound':
      return 'Card linked';
    case 'invalid':
      return 'Bad read — tap again';
    case 'storage-error':
      return 'Could not save locally';
    case 'storage-unavailable':
      return 'Card not recorded';
    case 'ready':
      if (mode === 'enroll') return 'Ready to enroll';
      return firstRun ? 'No students enrolled yet' : 'Ready for next tap';
  }
}

function panelDetail(
  feedback: ScanFeedback,
  firstRun: boolean,
  { personName, lastScannedAt, lastCountedAt }: PanelWording,
): string {
  switch (feedback) {
    case 'duplicate':
      return `Already counted at ${formatTime(lastCountedAt || lastScannedAt)} — no need to tap again`;
    case 'valid':
      return `${personName} · ${formatTime(lastScannedAt)}`;
    case 'unknown':
      return 'Switch to Enroll and tap this card to add the student';
    case 'enrollment':
      return 'Complete the student details below';
    case 'enrolled':
      return `${personName} is enrolled — switch to Check-in to record attendance`;
    case 'editing':
      return 'Update the enrolled details below';
    case 'updated':
      return `${personName} is saved — switch to Check-in to record attendance`;
    case 'existing':
      return `${personName} is already in the local roster`;
    case 'bound':
      return `${personName} now taps with this card`;
    case 'invalid':
      return 'The scan did not match a 14-character card ID';
    case 'storage-error':
      return 'Check browser storage and try again';
    case 'storage-unavailable':
      return 'This device is not letting the app save — nothing was stored for this tap';
    case 'ready':
      return firstRun
        ? 'Switch to Enroll above, then tap a card to add the first student'
        : 'Hold a card or badge near the reader';
  }
}

export function FeedbackPanel({
  feedback,
  mode,
  lastUid,
  lastPerson,
  lastScannedAt,
  lastCountedAt = '',
  isSaving,
  rosterEmpty,
}: FeedbackPanelProps) {
  const personName = lastPerson ? displayName(lastPerson) : '';
  // Nobody enrolled: every card tapped here would come back "unknown", so the
  // resting state names the missing step instead of inviting a tap.
  const firstRun = rosterEmpty && mode === 'checkin';
  const wording = { personName, lastUid, lastScannedAt, lastCountedAt };
  const title = panelTitle(feedback, mode, firstRun, wording);
  const detail = panelDetail(feedback, firstRun, wording);
  const stateClass = isSuccess(feedback)
    ? 'border-[hsl(var(--accent)/.7)] bg-[hsl(var(--accent)/.12)] text-[hsl(var(--accent))]'
    : feedback === 'duplicate' ||
        feedback === 'invalid' ||
        feedback === 'storage-error' ||
        feedback === 'storage-unavailable'
      ? 'border-[hsl(var(--destructive)/.7)] bg-[hsl(var(--destructive)/.1)] text-[hsl(var(--destructive))]'
      : 'border-[hsl(var(--primary)/.35)] bg-[hsl(var(--primary)/.06)] text-[hsl(var(--primary))]';

  return (
    <section
      className={`feedback-panel ${isSuccess(feedback) ? 'feedback-success' : feedback === 'duplicate' || feedback === 'invalid' ? 'feedback-alert' : ''} rounded-[1.35rem] border p-5 transition-colors duration-300 sm:p-6 ${stateClass}`}
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
              feedback === 'existing' ||
              feedback === 'bound') && (
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
