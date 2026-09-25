import { useState, type FormEvent, type ReactNode } from 'react';
import { ThemeAdminPanel } from '@/theme/ThemeAdminPanel';
import { UpdateCard } from '@/update/UpdateCard';
import {
  Archive,
  BarChart3,
  Database,
  FileSpreadsheet,
  History,
  KeyRound,
  Layers,
  RefreshCw,
  ScanLine,
  Target,
  Trash2,
  UserRoundPlus,
  Users,
} from 'lucide-react';
import type {
  DashboardMetrics,
  GradeBreakdownRow,
  PeriodBreakdownRow,
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
  type AlumniRemoval,
  type AttendanceBody,
  type HistoryPurge,
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
  /**
   * Whether the teacher PIN currently gates the locked routes, and whether a
   * PIN has ever been set on this device. The switch is shown once `hasPin`
   * is true, or once `pinRequired` is false — the recovery path for a device
   * stuck with the gate off and no PIN (see `onTogglePinRequired`).
   */
  pinRequired?: boolean;
  hasPin?: boolean;
  /**
   * The teacher asked to flip the switch to `next`. Turning it off is a
   * request, not an action: the caller verifies the current PIN first and
   * only then persists it, which is why this takes no promise to await —
   * the card does not know whether the flip actually happened.
   */
  onTogglePinRequired?: (next: boolean) => void;
  /**
   * "Require PIN to switch periods" (Design 09 §3). Optional, paired with
   * its toggle — without the toggle the row is not shown. Like the switch
   * above, a flip is a request: turning it off asks for the PIN first.
   */
  switchPinRequired?: boolean;
  onToggleSwitchPinRequired?: (next: boolean) => void;
  /**
   * The body this device is currently attached to (D-T2). Optional,
   * paired with `onChangeBody` — without both the card is not shown.
   */
  activeBody?: AttendanceBody;
  /** `name · typeLabel`, or the path for a nested body. */
  activeBodyLabel?: string;
  /** Opens the body switcher: create a body, or attach to a different one. */
  onChangeBody?: () => void;
  /**
   * Opens the 08b vocabulary admin screen (saved type labels and custom
   * field definitions). Optional: without it the body card shows no link to
   * it, the same way `onChangeBody` gates the card itself.
   */
  onManageVocabulary?: () => void;
  /**
   * Switches the figures above between the active body and that body plus
   * its descendants. Omitted in presentational tests that only render numbers.
   */
  onMetricsScopeChange?: (scope: 'body' | 'subtree') => void;
  /**
   * The class view's per-child table (Design 09 §2). Shown only with the
   * "This body + descendants" figures, and only when the active body has
   * children. `childLabel` names the first column ("period"), from the
   * children's own type label.
   */
  periodBreakdown?: { childLabel: string; rows: PeriodBreakdownRow[] };
  /**
   * The two retention actions with their previews. Optional: the
   * presentational tests render without a page. A `null` preview means the
   * read has not answered yet.
   */
  retention?: RetentionControls;
};

export type RetentionControls = {
  /** `YYYY-MM-DD`, the boundary the purge deletes before. */
  schoolYearStart: string;
  history: HistoryPurge | null;
  alumni: AlumniRemoval | null;
  onPurgeHistory: () => void;
  onRemoveAlumni: () => void;
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
  pinRequired = true,
  hasPin = false,
  onTogglePinRequired,
  switchPinRequired = false,
  onToggleSwitchPinRequired,
  activeBody,
  activeBodyLabel,
  onChangeBody,
  onManageVocabulary,
  onMetricsScopeChange,
  periodBreakdown,
  retention,
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
        {onMetricsScopeChange ? (
          <MetricsScopeToggle
            scope={metrics.scope}
            onChange={onMetricsScopeChange}
          />
        ) : null}

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
            {metrics.scope === 'subtree' ? (
              <p
                className="mt-2 text-xs leading-5 text-[hsl(var(--muted-foreground))]"
                data-testid="text-rollup-identity"
              >
                Same email counts once across these bodies. With no email, the
                card is the identity. Two enrollments that share neither still
                count twice.
              </p>
            ) : null}
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

        {metrics.scope === 'subtree' && periodBreakdown && periodBreakdown.rows.length > 0 ? (
          <PeriodBreakdownTable {...periodBreakdown} />
        ) : null}

        <UnidentifiedCardSection
          tapCount={unidentified.tapCount}
          cardCount={unidentified.cardCount}
          cards={unidentified.cards}
          summedAcrossBodies={metrics.scope === 'subtree'}
        />

        <ActivitySection entries={activity} />

        {retention ? <RetentionSection {...retention} /> : null}

        {activeBody && onChangeBody ? (
          <BodyCard
            body={activeBody}
            label={activeBodyLabel}
            onChangeBody={onChangeBody}
            onManageVocabulary={onManageVocabulary}
          />
        ) : null}

        {onChangePin ? (
          <TeacherPinCard
            onChangePin={onChangePin}
            pinRequired={pinRequired}
            hasPin={hasPin}
            onTogglePinRequired={onTogglePinRequired}
            switchPinRequired={switchPinRequired}
            onToggleSwitchPinRequired={onToggleSwitchPinRequired}
          />
        ) : null}

        {onChangePin ? <ThemeAdminPanel /> : null}

        {onChangePin ? <UpdateCard /> : null}
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

/**
 * Design 09 §2: one row per period under the class, with the same year-to-date
 * rules as the roll-up above it. A real table so a screen reader can read a
 * row against its column headers.
 */
function PeriodBreakdownTable({
  childLabel,
  rows,
}: {
  childLabel: string;
  rows: PeriodBreakdownRow[];
}) {
  const heading = childLabel.charAt(0).toUpperCase() + childLabel.slice(1);
  const cell = 'px-3 py-2.5 text-right tabular-nums';
  return (
    <Card eyebrow={`By ${childLabel}`} icon={<Layers aria-hidden="true" size={16} />}>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[26rem] text-sm" data-testid="table-period-breakdown">
          <caption className="pb-2 text-left text-xs leading-5 text-[hsl(var(--muted-foreground))]">
            This school year. Average attendance is students present per meeting as a share of
            that {childLabel}’s roster.
          </caption>
          <thead>
            <tr className="border-b border-[hsl(var(--border))] text-[11px] font-semibold text-[hsl(var(--muted-foreground))]">
              <th scope="col" className="px-3 py-2 text-left font-semibold">
                {heading}
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                Meetings held
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                Unique present
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                Avg attendance
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.bodyId}
                className="border-b border-[hsl(var(--border)/.6)] last:border-b-0"
                data-testid={`row-period-${row.bodyId}`}
              >
                <th
                  scope="row"
                  className="px-3 py-2.5 text-left font-semibold text-[hsl(var(--foreground))]"
                >
                  {row.name}
                  {row.archived ? (
                    <span className="font-normal text-[hsl(var(--muted-foreground))]"> · Archived</span>
                  ) : null}
                </th>
                <td className={`${cell} text-[hsl(var(--foreground))]`}>{row.meetingsHeld}</td>
                <td className={`${cell} text-[hsl(var(--foreground))]`}>
                  {row.uniquePresent}
                  <span className="text-[hsl(var(--muted-foreground))]"> of {row.enrolled}</span>
                </td>
                <td className={`${cell} text-[hsl(var(--foreground))]`}>
                  {row.averageAttendancePercent === null ? (
                    <span className="text-[hsl(var(--muted-foreground))]">
                      —<span className="sr-only">
                        {row.enrolled === 0 ? ' no students enrolled' : ' no meetings yet'}
                      </span>
                    </span>
                  ) : (
                    formatPercent(row.averageAttendancePercent)
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function MetricsScopeToggle({
  scope,
  onChange,
}: {
  scope: 'body' | 'subtree';
  onChange: (scope: 'body' | 'subtree') => void;
}) {
  const buttonClass = (selected: boolean) =>
    `rounded-full px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.14em] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] ${
      selected
        ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]'
        : 'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]'
    }`;

  return (
    <div
      className="flex flex-col gap-2 rounded-[1.35rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
      data-testid="metrics-scope"
    >
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[hsl(var(--muted-foreground))]">
        Metrics
      </p>
      <div className="flex w-fit rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--background)/.5)] p-1">
        <button
          type="button"
          className={buttonClass(scope === 'body')}
          aria-pressed={scope === 'body'}
          onClick={() => onChange('body')}
          data-testid="button-metrics-this-body"
        >
          This body
        </button>
        <button
          type="button"
          className={buttonClass(scope === 'subtree')}
          aria-pressed={scope === 'subtree'}
          onClick={() => onChange('subtree')}
          data-testid="button-metrics-subtree"
        >
          This body + descendants
        </button>
      </div>
    </div>
  );
}

function UnidentifiedCardSection({
  tapCount,
  cardCount,
  cards,
  summedAcrossBodies,
}: {
  tapCount: number;
  cardCount: number;
  cards: UnidentifiedCard[];
  summedAcrossBodies: boolean;
}) {
  const listed = cards.slice(0, MAX_LISTED_CARDS);
  const unlisted = cards.length - listed.length;

  return (
    <Card eyebrow="Unidentified taps" icon={<ScanLine aria-hidden="true" size={16} />}>
      {/* Every other figure on this page is year to date, which the header
          says once; these two are all-time, so they say their own scope. */}
      <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
        {summedAcrossBodies
          ? 'Sum of each body’s unknown cards — the same card in two bodies counts twice. Across all time, not just this year.'
          : 'Across all time, not just this year'}
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
            {summedAcrossBodies ? 'Sum of each body’s unknown cards' : 'Distinct cards'}
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
                key={`${card.bodyId ?? 'body'}-${card.uid}`}
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

/**
 * The body this kiosk is attached to (D-T2). Reassignment points the device
 * at a different body; it never wipes the one just left, and never requires
 * exporting first. Export stays this body only — a subtree workbook is not
 * this screen.
 */
function BodyCard({
  body,
  label,
  onChangeBody,
  onManageVocabulary,
}: {
  body: AttendanceBody;
  label?: string;
  onChangeBody: () => void;
  onManageVocabulary?: () => void;
}) {
  return (
    <Card eyebrow="Active body" icon={<Layers aria-hidden="true" size={16} />}>
      <p
        className="mt-1 text-sm font-semibold text-[hsl(var(--foreground))]"
        data-testid="text-active-body"
      >
        {label ?? (
          <>
            {body.name} <span className="text-[hsl(var(--muted-foreground))]">· {body.typeLabel}</span>
          </>
        )}
      </p>
      <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
        The body this device is scanning for. Every body keeps its own roster
        and history — switching never deletes another body's data. Export stays
        this body only.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onChangeBody}
          className="flex items-center gap-2 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--card)/.68)] px-4 py-2 text-[11px] font-bold uppercase tracking-[0.14em] text-[hsl(var(--foreground))] transition hover:bg-[hsl(var(--secondary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
          data-testid="button-change-body"
        >
          <Layers aria-hidden="true" size={14} />
          Change body…
        </button>
        {onManageVocabulary ? (
          <button
            type="button"
            onClick={onManageVocabulary}
            className="flex items-center gap-2 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--card)/.68)] px-4 py-2 text-[11px] font-bold uppercase tracking-[0.14em] text-[hsl(var(--foreground))] transition hover:bg-[hsl(var(--secondary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
            data-testid="button-manage-vocabulary"
          >
            <Layers aria-hidden="true" size={14} />
            Body vocabulary…
          </button>
        ) : null}
      </div>
    </Card>
  );
}

/** The one place the PIN can be changed. Setting it the first time happens at the gate. */
function TeacherPinCard({
  onChangePin,
  pinRequired,
  hasPin,
  onTogglePinRequired,
  switchPinRequired,
  onToggleSwitchPinRequired,
}: {
  onChangePin: () => void;
  pinRequired: boolean;
  hasPin: boolean;
  onTogglePinRequired?: (next: boolean) => void;
  switchPinRequired: boolean;
  onToggleSwitchPinRequired?: (next: boolean) => void;
}) {
  // Ordinarily the switch only appears once a PIN exists — reaching the
  // dashboard at all normally means the LockedRoute gate already made the
  // teacher set one. The `!pinRequired` half covers the one state that
  // isn't reachable that way: the gate off with no PIN behind it (a
  // hand-edited settings row, or a device upgraded from an odd state).
  // Hiding the switch there would strand the teacher with no way back to a
  // PIN at all, so it stays visible and routes an "on" tap to Set PIN
  // instead of silently flipping the setting.
  const showSwitch = (hasPin || !pinRequired) && onTogglePinRequired;

  return (
    <Card eyebrow="Teacher PIN" icon={<KeyRound aria-hidden="true" size={16} />}>
      <p
        className="mt-1 text-xs text-[hsl(var(--muted-foreground))]"
        data-testid="section-teacher-pin"
      >
        Opens End Session, this page and the roster. A screen gate, not
        encryption — and there is no way to recover a forgotten PIN.
      </p>

      {showSwitch ? (
        <div className="mt-3 flex items-start justify-between gap-3 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--background)/.5)] p-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[hsl(var(--foreground))]">
              Require teacher PIN
            </p>
            <p className="mt-0.5 text-xs leading-snug text-[hsl(var(--muted-foreground))]">
              Off leaves the dashboard and roster open on this device with no
              gate and no idle relock. Appropriate only where the device
              itself stays with a teacher — never on an unattended kiosk.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={pinRequired}
            aria-label="Require teacher PIN"
            onClick={() => onTogglePinRequired(!pinRequired)}
            data-testid="switch-pin-required"
            className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] ${
              pinRequired
                ? 'border-[hsl(var(--primary)/.6)] bg-[hsl(var(--primary))]'
                : 'border-[hsl(var(--border))] bg-[hsl(var(--card))]'
            }`}
          >
            <span
              className={`inline-block size-[18px] transform rounded-full bg-[hsl(var(--primary-foreground))] shadow transition ${
                pinRequired ? 'translate-x-[22px]' : 'translate-x-1'
              }`}
            />
          </button>
        </div>
      ) : null}

      {onToggleSwitchPinRequired ? (
        <SettingSwitch
          label="Require PIN to switch periods"
          description={
            hasPin
              ? 'Asks for the teacher PIN before the scanner switches between periods of a class. For an unattended kiosk; off lets whoever is at the desk switch.'
              : 'Set a teacher PIN first: this asks for it before the scanner switches periods. Until then, periods switch without a PIN.'
          }
          checked={switchPinRequired}
          // Turning it on needs a PIN to ask for. Turning it off stays
          // possible either way, so a stuck "on" can always be cleared.
          disabled={!hasPin && !switchPinRequired}
          onToggle={() => onToggleSwitchPinRequired(!switchPinRequired)}
          testId="switch-switch-pin-required"
        />
      ) : null}

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

/** A labelled on/off row, as the teacher-PIN switch above draws it. */
function SettingSwitch({
  label,
  description,
  checked,
  disabled = false,
  onToggle,
  testId,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onToggle: () => void;
  testId: string;
}) {
  const descriptionId = `${testId}-description`;
  return (
    <div className="mt-3 flex items-start justify-between gap-3 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--background)/.5)] p-3">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-[hsl(var(--foreground))]">{label}</p>
        <p
          id={descriptionId}
          className="mt-0.5 text-xs leading-snug text-[hsl(var(--muted-foreground))]"
        >
          {description}
        </p>
      </div>
      {/* The visible track stays the teacher-PIN switch's size; the button
          around it is the 44px target. */}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        aria-describedby={descriptionId}
        onClick={onToggle}
        disabled={disabled}
        data-testid={testId}
        className="group -m-2.5 flex size-16 shrink-0 items-center justify-center rounded-full focus-visible:outline-none disabled:cursor-not-allowed"
      >
        <span
          className={`relative inline-flex h-6 w-11 items-center rounded-full border transition group-focus-visible:ring-2 group-focus-visible:ring-[hsl(var(--ring))] group-disabled:opacity-50 ${
            checked
              ? 'border-[hsl(var(--primary)/.6)] bg-[hsl(var(--primary))]'
              : 'border-[hsl(var(--border))] bg-[hsl(var(--card))]'
          }`}
        >
          <span
            className={`inline-block size-[18px] transform rounded-full shadow transition ${
              checked
                ? 'translate-x-[22px] bg-[hsl(var(--primary-foreground))]'
                : 'translate-x-1 bg-[hsl(var(--muted-foreground))]'
            }`}
          />
        </span>
      </button>
    </div>
  );
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/**
 * The two things a teacher does at the start of a school year, once the
 * export is safe. Both are previewed from the store, both are disabled when
 * there is nothing to do, and neither ever runs on its own.
 */
function RetentionSection({
  schoolYearStart,
  history,
  alumni,
  onPurgeHistory,
  onRemoveAlumni,
}: RetentionControls) {
  const boundary = formatSessionDateLabel(schoolYearStart);
  const actionClass =
    'mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-[hsl(var(--destructive)/.6)] px-3 py-2.5 text-xs font-bold uppercase tracking-[0.14em] text-[hsl(var(--destructive))] transition hover:bg-[hsl(var(--destructive)/.12)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] disabled:cursor-not-allowed disabled:opacity-50';

  return (
    <Card eyebrow="Data retention" icon={<Archive aria-hidden="true" size={16} />}>
      <p
        className="mt-1 text-xs text-[hsl(var(--muted-foreground))]"
        data-testid="section-retention"
      >
        Taps are kept for the current school year only. At the start of each
        year, export all history, then run both. Neither can be undone.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--background)/.5)] p-3">
          <p
            className="text-sm text-[hsl(var(--foreground))]"
            data-testid="text-retention-history"
          >
            {history === null
              ? 'Checking…'
              : history.tapCount === 0
                ? 'Nothing older than this school year.'
                : `${plural(history.tapCount, 'tap')} across ${plural(history.sessionCount, 'session')} before ${boundary}`}
          </p>
          <button
            type="button"
            onClick={onPurgeHistory}
            disabled={history === null || history.tapCount === 0}
            className={actionClass}
            data-testid="button-purge-history"
          >
            <Trash2 aria-hidden="true" size={14} />
            Delete attendance before {boundary}
          </button>
        </div>
        <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--background)/.5)] p-3">
          <p
            className="text-sm text-[hsl(var(--foreground))]"
            data-testid="text-retention-alumni"
          >
            {alumni === null
              ? 'Checking…'
              : alumni.studentCount === 0
                ? 'No graduated students on this device.'
                : `${plural(alumni.studentCount, 'graduated student')}, ${plural(alumni.tapCount, 'tap')}`}
          </p>
          <button
            type="button"
            onClick={onRemoveAlumni}
            disabled={alumni === null || alumni.studentCount === 0}
            className={actionClass}
            data-testid="button-remove-alumni"
          >
            <Trash2 aria-hidden="true" size={14} />
            Remove graduated students
          </button>
        </div>
      </div>
    </Card>
  );
}
