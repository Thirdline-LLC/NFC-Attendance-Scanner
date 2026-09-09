import { useState, type FormEvent, type ReactNode } from 'react';
import {
  BarChart3,
  Database,
  FileSpreadsheet,
  History,
  KeyRound,
  RefreshCw,
  ScanLine,
  Target,
  UserRoundPlus,
  Users,
} from 'lucide-react';
import type {
  DashboardMetrics,
  GradeBreakdownRow,
  SessionSnapshot,
  UnidentifiedCard,
} from '@/lib/attendance-metrics';
import {
  formatSessionDateLabel,
  formatSessionDateTime,
  formatSessionLastSeen,
} from '@/lib/session-formatting';
import { maskCardUid } from '@/lib/scan-format';
import { describeActivity } from '@/lib/activity-wording';
import {
  type ActivityEntry,
  isValidAttendanceTarget,
  MAX_ATTENDANCE_TARGET,
  MIN_ATTENDANCE_TARGET,
} from '@/data/attendance-store';

type DashboardProps = {
  metrics: DashboardMetrics;
  isLoading?: boolean;
  onRefresh?: () => void;
  /**
   * Writes the whole tap history to a workbook. The scanner's own export is
   * scoped to the session on screen, so without this a rotated-away session —
   * and the taps a v3 upgrade stamped `legacy` — could never reach the .xlsx
   * that is the actual system of record.
   */
  onExportAll?: () => void;
  /**
   * Stores a new per-session target. Resolves false when it could not be
   * written, so the editor can stay open rather than pretend it saved.
   * Optional: without it the target is shown but not editable.
   */
  onSaveTarget?: (target: number) => Promise<boolean>;
  /**
   * The device's activity log, newest first. Counts, timestamps and filenames
   * only — the log is how a teacher answers "where did that file go" without
   * the answer being a disclosure. Optional so the presentational tests that
   * render this component without a page keep working.
   */
  activity?: ActivityEntry[];
  /** Opens the change-PIN dialog. Optional: without it the card is not shown. */
  onChangePin?: () => void;
};

/** Enough to act on without scrolling on a phone; the count says the rest. */
const MAX_LISTED_CARDS = 5;

/** Whole numbers stay whole; anything else gets one decimal, e.g. 33.3. */
function formatAverage(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatPercent(value: number): string {
  return `${Math.round(value)}%`;
}

/** `2026-08-01` reads as `2026–27`. */
function formatSchoolYear(schoolYearStart: string): string {
  const startYear = Number(schoolYearStart.slice(0, 4));
  return `${startYear}–${String(startYear + 1).slice(-2)}`;
}

export function Dashboard({
  metrics,
  isLoading = false,
  onRefresh,
  onExportAll,
  onSaveTarget,
  activity = [],
  onChangePin,
}: DashboardProps) {
  const { ytd, gradeBreakdown, enrolledStudents, unidentified } = metrics;
  const percent = Math.round(ytd.percentOfTarget);
  // The bar caps at full; the text beside it still says 120% when earned.
  const barWidth = Math.min(100, Math.max(0, percent));

  return (
    <section
      className="mx-auto w-full max-w-5xl px-5 py-5 sm:px-8 sm:py-7"
      aria-busy={isLoading}
      data-testid="dashboard"
    >
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-2xl border border-[hsl(var(--primary)/.5)] bg-[hsl(var(--primary)/.1)] text-[hsl(var(--primary))]">
            <BarChart3 aria-hidden="true" size={22} strokeWidth={2.2} />
          </div>
          <div>
            <h1 className="font-display text-lg font-semibold tracking-[-0.025em] text-[hsl(var(--foreground))] sm:text-xl">
              Attendance dashboard
            </h1>
            <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.19em] text-[hsl(var(--muted-foreground))]">
              {formatSchoolYear(ytd.schoolYearStart)} school year
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {onExportAll ? (
            <button
              type="button"
              onClick={onExportAll}
              className="flex items-center gap-2 self-start rounded-full border border-[hsl(var(--primary)/.55)] bg-[hsl(var(--primary)/.12)] px-4 py-2 text-[11px] font-bold uppercase tracking-[0.14em] text-[hsl(var(--primary))] transition hover:bg-[hsl(var(--primary)/.2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] sm:self-auto"
              data-testid="button-export-history"
            >
              <FileSpreadsheet aria-hidden="true" size={14} />
              Export all history
            </button>
          ) : null}
          {onRefresh ? (
            <button
              type="button"
              onClick={onRefresh}
              disabled={isLoading}
              className="flex items-center gap-2 self-start rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--card)/.68)] px-4 py-2 text-[11px] font-bold uppercase tracking-[0.14em] text-[hsl(var(--foreground))] transition hover:bg-[hsl(var(--secondary))] disabled:cursor-wait disabled:opacity-60 sm:self-auto"
              data-testid="button-refresh-dashboard"
            >
              <RefreshCw
                aria-hidden="true"
                size={14}
                className={isLoading ? 'animate-spin' : undefined}
              />
              {isLoading ? 'Refreshing' : 'Refresh'}
            </button>
          ) : null}
        </div>
      </header>

      <p
        className="mt-4 flex items-start gap-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card)/.5)] px-3 py-2.5 text-xs text-[hsl(var(--muted-foreground))]"
        data-testid="text-local-only"
      >
        <Database aria-hidden="true" className="mt-0.5 shrink-0" size={14} />
        <span>
          <strong className="font-semibold text-[hsl(var(--foreground))]">Local only.</strong>{' '}
          Everything here is computed on this device from its own browser storage.
          Nothing is sent anywhere; the exported Excel file is still the record.
        </span>
      </p>

      <div className="mt-6 grid gap-4">
        <TargetCard
            ytd={ytd}
            percent={percent}
            barWidth={barWidth}
            onSaveTarget={onSaveTarget}
          />

        <div className="grid gap-4 sm:grid-cols-2">
          <Card eyebrow="Unique students" icon={<Users aria-hidden="true" size={16} />}>
            <p className="mt-3 font-display text-4xl font-semibold tracking-[-0.03em] text-[hsl(var(--foreground))]">
              <span data-testid="text-unique-students">{ytd.uniqueStudents}</span>
            </p>
            <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
              of{' '}
              <span data-testid="text-enrolled-students">{enrolledStudents}</span>{' '}
              enrolled have attended this school year
            </p>
          </Card>

          <Card eyebrow="Grade breakdown" icon={<BarChart3 aria-hidden="true" size={16} />}>
            <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
              Attended this year vs enrolled
            </p>
            <ul className="mt-3 grid gap-2.5" data-testid="list-grade-breakdown">
              {gradeBreakdown.map((row) => (
                <GradeRow key={row.grade} row={row} />
              ))}
            </ul>
          </Card>
        </div>

        <UnidentifiedCardSection
          tapCount={unidentified.tapCount}
          cardCount={unidentified.cardCount}
          cards={unidentified.cards}
        />

        <ActivitySection entries={activity} />

        {onChangePin ? <TeacherPinCard onChangePin={onChangePin} /> : null}
      </div>
    </section>
  );
}

function Card({
  eyebrow,
  icon,
  children,
}: {
  eyebrow: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-[1.35rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 sm:p-6">
      <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-[hsl(var(--primary))]">
        {icon}
        {eyebrow}
      </p>
      {children}
    </section>
  );
}

function TargetCard({
  ytd,
  percent,
  barWidth,
  onSaveTarget,
}: {
  ytd: DashboardMetrics['ytd'];
  percent: number;
  barWidth: number;
  onSaveTarget?: (target: number) => Promise<boolean>;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(String(ytd.target));
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  const open = () => {
    setDraft(String(ytd.target));
    setError('');
    setIsEditing(true);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!onSaveTarget) return;

    const next = Number(draft);
    // The store enforces this too; catching it here means the operator is told
    // what is wrong instead of watching a save fail silently.
    if (!isValidAttendanceTarget(next)) {
      setError(
        `Enter a whole number between ${MIN_ATTENDANCE_TARGET} and ${MAX_ATTENDANCE_TARGET}.`,
      );
      return;
    }

    setIsSaving(true);
    const saved = await onSaveTarget(next);
    setIsSaving(false);
    if (saved) setIsEditing(false);
    else setError('That did not save. The device would not store it.');
  };

  return (
    <Card eyebrow="Average attendance" icon={<Target aria-hidden="true" size={16} />}>
      <div className="mt-3 flex flex-wrap items-end gap-x-3 gap-y-1">
        <p className="font-display text-5xl font-semibold leading-none tracking-[-0.04em] text-[hsl(var(--foreground))]">
          <span data-testid="text-average-attendance">
            {formatAverage(ytd.averageAttendance)}
          </span>
        </p>
        <p className="pb-1 text-sm text-[hsl(var(--muted-foreground))]">
          of <span data-testid="text-attendance-target">{ytd.target}</span> target
          per session
        </p>
        {onSaveTarget && !isEditing ? (
          <button
            type="button"
            onClick={open}
            className="pb-1 text-xs font-semibold text-[hsl(var(--primary))] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
            data-testid="button-edit-target"
          >
            Change
          </button>
        ) : null}
      </div>

      {isEditing ? (
        <form
          className="mt-3 flex flex-wrap items-end gap-2"
          onSubmit={submit}
          // The browser would otherwise block submit on min/max and show its
          // own transient bubble, so an out-of-range number would produce a
          // different message depending on the engine — and none of it on a
          // kiosk where nobody is watching for a tooltip. One validator, one
          // message, rendered in the form.
          noValidate
          data-testid="form-attendance-target"
        >
          <label className="grid gap-1.5 text-xs font-semibold text-[hsl(var(--muted-foreground))]">
            Students expected each session
            <input
              autoFocus
              type="number"
              inputMode="numeric"
              min={MIN_ATTENDANCE_TARGET}
              max={MAX_ATTENDANCE_TARGET}
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                setError('');
              }}
              className="w-32 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-base text-[hsl(var(--foreground))] outline-none transition focus:border-[hsl(var(--primary))] focus:ring-2 focus:ring-[hsl(var(--primary)/.2)] sm:text-sm"
              data-testid="input-attendance-target"
            />
          </label>
          <button
            type="submit"
            disabled={isSaving}
            className="rounded-xl bg-[hsl(var(--primary))] px-4 py-2 text-sm font-bold text-[hsl(var(--primary-foreground))] transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] disabled:cursor-wait disabled:opacity-60"
            data-testid="button-save-target"
          >
            {isSaving ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            onClick={() => setIsEditing(false)}
            className="rounded-xl px-3 py-2 text-sm font-semibold text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--secondary))] hover:text-[hsl(var(--foreground))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
            data-testid="button-cancel-target"
          >
            Cancel
          </button>
          {error ? (
            <p
              className="basis-full text-xs font-semibold text-[hsl(var(--destructive))]"
              role="alert"
              data-testid="text-target-error"
            >
              {error}
            </p>
          ) : (
            <p className="basis-full text-xs leading-5 text-[hsl(var(--muted-foreground))]">
              This kiosk only. It changes what the percentage is measured
              against, never the attendance itself.
            </p>
          )}
        </form>
      ) : null}

      <div className="mt-4">
        <div className="flex items-baseline justify-between gap-3 text-sm">
          <span className="font-semibold text-[hsl(var(--foreground))]">
            <span data-testid="text-percent-of-target">{formatPercent(ytd.percentOfTarget)}</span>{' '}
            of target
          </span>
          <span className="text-[hsl(var(--muted-foreground))]">
            <span data-testid="text-sessions-count">{ytd.sessionsCount}</span>{' '}
            {ytd.sessionsCount === 1 ? 'session' : 'sessions'}
          </span>
        </div>
        <div
          className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-[hsl(var(--secondary))]"
          role="progressbar"
          aria-label="Progress toward the attendance target"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={barWidth}
          aria-valuetext={`${percent}% of target`}
        >
          <div
            className={`h-full rounded-full transition-[width] duration-500 ${percent >= 100 ? 'bg-[hsl(var(--accent))]' : 'bg-[hsl(var(--primary))]'}`}
            style={{ width: `${barWidth}%` }}
          />
        </div>
      </div>

      {ytd.hasSessions ? (
        <dl className="mt-4 grid grid-cols-2 gap-3">
          <SessionStat label="Latest session" session={ytd.latestSession} />
          <SessionStat label="Best session" session={ytd.bestSession} />
        </dl>
      ) : (
        <p
          className="mt-4 rounded-xl border border-dashed border-[hsl(var(--border))] px-3 py-2.5 text-sm text-[hsl(var(--muted-foreground))]"
          data-testid="text-no-sessions"
        >
          No sessions yet this school year
        </p>
      )}
    </Card>
  );
}

function SessionStat({
  label,
  session,
}: {
  label: string;
  session: SessionSnapshot | null;
}) {
  if (!session) return null;

  return (
    <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--background)/.5)] p-3">
      <dt className="text-[10px] font-semibold uppercase leading-4 tracking-[0.12em] text-[hsl(var(--muted-foreground))]">
        {label}
      </dt>
      <dd className="mt-1 font-display text-2xl font-semibold text-[hsl(var(--foreground))]">
        {session.attendance}
      </dd>
      <dd className="text-xs text-[hsl(var(--muted-foreground))]">
        {formatSessionDateLabel(session.date)}
      </dd>
    </div>
  );
}

function GradeRow({ row }: { row: GradeBreakdownRow }) {
  const label =
    row.grade === 'Alumni' || row.grade === 'Below 9'
      ? row.grade
      : `Grade ${row.grade}`;
  const share = row.enrolled === 0 ? 0 : (row.attended / row.enrolled) * 100;

  return (
    <li
      className="grid grid-cols-[5.5rem_1fr_auto] items-center gap-3 text-sm"
      data-testid={`row-grade-${row.grade.replace(' ', '-').toLowerCase()}`}
    >
      <span className="font-semibold text-[hsl(var(--foreground))]">{label}</span>
      <span
        className="h-2 overflow-hidden rounded-full bg-[hsl(var(--secondary))]"
        aria-hidden="true"
      >
        <span
          className="block h-full rounded-full bg-[hsl(var(--accent))]"
          style={{ width: `${Math.min(100, share)}%` }}
        />
      </span>
      <span className="font-mono text-xs text-[hsl(var(--muted-foreground))]">
        <span className="font-bold text-[hsl(var(--foreground))]">{row.attended}</span>
        {' / '}
        {row.enrolled}
      </span>
    </li>
  );
}

function UnidentifiedCardSection({
  tapCount,
  cardCount,
  cards,
}: {
  tapCount: number;
  cardCount: number;
  cards: UnidentifiedCard[];
}) {
  const listed = cards.slice(0, MAX_LISTED_CARDS);
  const unlisted = cards.length - listed.length;

  return (
    <Card eyebrow="Unidentified taps" icon={<ScanLine aria-hidden="true" size={16} />}>
      {/* Every other figure on this page is year to date, which the header
          says once; these two are all-time, so they say their own scope. */}
      <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
        Across all time, not just this year
      </p>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--background)/.5)] p-3">
          <p className="font-display text-2xl font-semibold text-[hsl(var(--foreground))]">
            <span data-testid="text-unidentified-taps">{tapCount}</span>
          </p>
          <p className="mt-1 text-[10px] font-semibold uppercase leading-4 tracking-[0.12em] text-[hsl(var(--muted-foreground))]">
            Taps
          </p>
        </div>
        <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--background)/.5)] p-3">
          <p className="font-display text-2xl font-semibold text-[hsl(var(--foreground))]">
            <span data-testid="text-unidentified-cards">{cardCount}</span>
          </p>
          <p className="mt-1 text-[10px] font-semibold uppercase leading-4 tracking-[0.12em] text-[hsl(var(--muted-foreground))]">
            Distinct cards
          </p>
        </div>
      </div>

      {cards.length === 0 ? (
        <p className="mt-4 text-sm text-[hsl(var(--muted-foreground))]">
          Every tap on record matched an enrolled card.
        </p>
      ) : (
        <>
          <p className="mt-4 flex items-start gap-2 text-sm text-[hsl(var(--muted-foreground))]">
            <UserRoundPlus aria-hidden="true" className="mt-0.5 shrink-0" size={16} />
            <span>
              These cards are not on the roster, so their taps do not count.
              Enroll each one from Enroll mode and its past taps will count
              automatically.
            </span>
          </p>
          <ul className="mt-3 grid gap-2" data-testid="list-unidentified-cards">
            {listed.map((card) => (
              <li
                key={card.uid}
                className="flex items-center justify-between gap-3 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background)/.5)] px-3 py-2.5 text-sm"
              >
                <span className="font-mono font-bold tracking-[0.16em] text-[hsl(var(--foreground))]">
                  {maskCardUid(card.uid)}
                </span>
                <span className="text-right text-xs text-[hsl(var(--muted-foreground))]">
                  {card.tapCount} {card.tapCount === 1 ? 'tap' : 'taps'}
                  <span className="block">Last seen {formatSessionLastSeen(card.lastSeenAt)}</span>
                </span>
              </li>
            ))}
          </ul>
          {unlisted > 0 ? (
            <p className="mt-2 text-xs text-[hsl(var(--muted-foreground))]">
              and {unlisted} more {unlisted === 1 ? 'card' : 'cards'}
            </p>
          ) : null}
        </>
      )}
    </Card>
  );
}

/**
 * What left the device and what was deleted. Every row is counts, a
 * timestamp and a filename: the section can be read aloud in a room full of
 * students without disclosing anything about any of them.
 */
function ActivitySection({ entries }: { entries: ActivityEntry[] }) {
  return (
    <Card eyebrow="Activity" icon={<History aria-hidden="true" size={16} />}>
      <p
        className="mt-1 text-xs text-[hsl(var(--muted-foreground))]"
        data-testid="section-activity"
      >
        Exports and deletions on this device. Counts and filenames only — never
        a name or a card.
      </p>
      {entries.length === 0 ? (
        <p
          className="mt-4 text-sm text-[hsl(var(--muted-foreground))]"
          data-testid="text-activity-empty"
        >
          Nothing exported or deleted on this device yet.
        </p>
      ) : (
        <ul className="mt-3 grid gap-2" data-testid="list-activity">
          {entries.map((entry) => {
            const { action, detail } = describeActivity(entry);
            return (
              <li
                key={entry.id ?? `${entry.at}-${entry.kind}`}
                className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background)/.5)] px-3 py-2.5 text-sm"
                data-testid={`row-activity-${entry.id ?? 'unsaved'}`}
              >
                <span className="min-w-0">
                  <span className="font-semibold text-[hsl(var(--foreground))]">
                    {action}
                  </span>
                  {detail ? (
                    <span className="text-[hsl(var(--muted-foreground))] [overflow-wrap:anywhere]">
                      {' '}
                      — {detail}
                    </span>
                  ) : null}
                </span>
                <span className="text-xs text-[hsl(var(--muted-foreground))]">
                  {formatSessionDateTime(entry.at)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/** The one place the PIN can be changed. Setting it the first time happens at the gate. */
function TeacherPinCard({ onChangePin }: { onChangePin: () => void }) {
  return (
    <Card eyebrow="Teacher PIN" icon={<KeyRound aria-hidden="true" size={16} />}>
      <p
        className="mt-1 text-xs text-[hsl(var(--muted-foreground))]"
        data-testid="section-teacher-pin"
      >
        Opens End Session, this page and the roster. A screen gate, not
        encryption — and there is no way to recover a forgotten PIN.
      </p>
      <button
        type="button"
        onClick={onChangePin}
        className="mt-4 flex items-center gap-2 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--card)/.68)] px-4 py-2 text-[11px] font-bold uppercase tracking-[0.14em] text-[hsl(var(--foreground))] transition hover:bg-[hsl(var(--secondary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
        data-testid="button-change-pin"
      >
        <KeyRound aria-hidden="true" size={14} />
        Change PIN
      </button>
    </Card>
  );
}
