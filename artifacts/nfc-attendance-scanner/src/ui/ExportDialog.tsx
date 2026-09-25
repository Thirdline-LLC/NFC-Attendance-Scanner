import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { AlertTriangle, CalendarRange, FileSpreadsheet, Info } from 'lucide-react';

import type { AttendanceBody, Person, TapRecord } from '@/data/attendance-store';
import { computeRangeMetrics } from '@/lib/attendance-metrics';
import {
  RANGE_PRESETS,
  RANGE_PRESET_LABELS,
  formatRangeLabel,
  resolveDateRange,
  schoolYearStart,
  type DateRange,
  type RangePreset,
} from '@/lib/date-range';
import {
  buildRangeExportFilename,
  describeSubtreeExport,
  oldestTapDay,
  retentionCaveat,
} from '@/lib/range-export';
import { formatSessionDate } from '@/lib/session-formatting';
import { useModalFocusTrap } from '@/ui/use-modal-focus-trap';

export type ExportScope = 'body' | 'subtree';

/** The active body's descendants, for the class-wide scope (Design 09 §5). */
export type ExportSubtree = {
  rootId: number;
  /** Every body on the device. */
  bodies: readonly AttendanceBody[];
  /** The whole subtree's history and roster rows, the active body's included. */
  taps: readonly TapRecord[];
  persons: readonly Person[];
  /** What the descendants are called: `periods`, or `children` for a mixed set. */
  noun: string;
};

type ExportDialogProps = {
  /** Root-first names of the active body, e.g. `['English 11', 'Period 3']`. */
  bodyPath: readonly string[];
  /** The active body's whole history and current roster. */
  taps: readonly TapRecord[];
  persons: readonly Person[];
  /**
   * Set only when the active body has descendants; the dialog then offers
   * This body only / This body + all periods. Absent, it is single-body.
   */
  subtree?: ExportSubtree;
  /** Which scope starts chosen, e.g. the one the dashboard figures show. */
  initialScope?: ExportScope;
  /** True while the workbook is being built and delivered. */
  isWorking: boolean;
  onExport: (range: DateRange, scope: ExportScope) => void;
  onCancel: () => void;
  /** Read once when the dialog opens; injectable for tests. */
  now?: string;
};

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/**
 * The dashboard's Export dialog (Design 09 §4, §5): choose a scope when the
 * active body has descendants, choose a range, see what the file will hold,
 * export the workbook.
 *
 * The preview is computed with the same helpers the workbook uses
 * (`computeRangeMetrics`, `describeSubtreeExport`), so the counts it shows
 * are the counts in the file.
 */
export function ExportDialog({
  bodyPath,
  taps,
  persons,
  subtree,
  initialScope = 'body',
  isWorking,
  onExport,
  onCancel,
  now: nowProp,
}: ExportDialogProps) {
  const [now] = useState(() => nowProp ?? new Date().toISOString());
  const today = formatSessionDate(now);
  const [preset, setPreset] = useState<RangePreset>('school-year');
  const [day, setDay] = useState(today);
  const [from, setFrom] = useState(() => schoolYearStart(now));
  const [to, setTo] = useState(today);
  const [chosenScope, setScope] = useState<ExportScope>(initialScope);
  const scope: ExportScope = subtree ? chosenScope : 'body';

  const dialogRef = useRef<HTMLElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const firstScopeRef = useRef<HTMLInputElement>(null);
  const previouslyFocused = useRef<Element | null>(null);
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const errorId = `${baseId}-error`;
  useModalFocusTrap(dialogRef);

  // Focus starts on the chosen range, and goes back to the button that
  // opened the dialog when it closes.
  useEffect(() => {
    previouslyFocused.current = document.activeElement;
    // The first choice on screen: the scope when there is one, else the range.
    (firstScopeRef.current ?? firstFieldRef.current)?.focus();
    return () => {
      const previous = previouslyFocused.current;
      if (previous instanceof HTMLElement && document.contains(previous)) previous.focus();
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isWorking) {
        event.preventDefault();
        onCancel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onCancel, isWorking]);

  const resolution = resolveDateRange({ preset, day, from, to }, now);
  const range = resolution.ok ? resolution.range : null;
  // The resolution is a fresh object every render; the preview only needs
  // recomputing when the range itself moves.
  const rangeKey = range ? `${range.preset}|${range.from}|${range.to}` : '';

  const preview = useMemo(() => {
    if (!range) return null;
    if (scope === 'subtree' && subtree) {
      const described = describeSubtreeExport({ ...subtree, bodyPath, range });
      const archived = described.subtree.periods.filter((period) => period.archived).length;
      return {
        tapCount: described.subtree.taps.length,
        meetingsHeld: described.subtree.meetingsHeld,
        uniquePresent: described.subtree.uniquePresent,
        enrolled: described.subtree.enrolled,
        bodies: { count: described.subtree.periods.length, archived },
        filename: described.filename,
        caveat: described.caveat,
      };
    }
    const metrics = computeRangeMetrics(taps, persons, range);
    return {
      tapCount: metrics.taps.length,
      meetingsHeld: metrics.meetingsHeld,
      uniquePresent: metrics.uniquePresent,
      enrolled: metrics.enrolled,
      bodies: null,
      filename: buildRangeExportFilename(bodyPath, range),
      caveat: retentionCaveat(range, oldestTapDay(taps)),
    };
  }, [rangeKey, scope, subtree, taps, persons, bodyPath]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (range && !isWorking) onExport(range, scope);
  };

  const scopeOptions: { value: ExportScope; label: string; hint: string }[] = subtree
    ? [
        { value: 'body', label: 'This body only', hint: bodyPath[bodyPath.length - 1] ?? '' },
        {
          value: 'subtree',
          label: `This body + all ${subtree.noun}`,
          hint: 'Adds a Period column and a Summary by period sheet',
        },
      ]
    : [];

  const dateInput =
    'mt-1.5 block min-h-11 w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 text-sm text-[hsl(var(--foreground))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]';
  const fieldLabel = 'block text-xs font-semibold text-[hsl(var(--muted-foreground))]';

  return (
    <div className="fixed inset-0 z-30 flex overflow-y-auto bg-[hsl(var(--background)/.88)] px-5 py-8 backdrop-blur-sm">
      <section
        ref={dialogRef}
        className="m-auto w-full max-w-xl rounded-[1.7rem] border border-[hsl(var(--primary)/.45)] bg-[hsl(var(--card))] p-6 shadow-[0_24px_90px_hsl(211_55%_5%/.5)] sm:p-8"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="dialog-export"
      >
        <form onSubmit={submit} noValidate>
          <div className="flex items-start gap-3">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl border border-[hsl(var(--primary)/.5)] bg-[hsl(var(--primary)/.1)] text-[hsl(var(--primary))]">
              <FileSpreadsheet aria-hidden="true" size={20} />
            </span>
            <div className="min-w-0">
              <h2
                id={titleId}
                className="font-display text-2xl font-semibold tracking-[-0.03em] text-[hsl(var(--foreground))]"
              >
                Export attendance
              </h2>
              <p className="mt-0.5 truncate text-sm text-[hsl(var(--muted-foreground))]" data-testid="text-export-body">
                {bodyPath.join(' › ')}
              </p>
            </div>
          </div>

          {subtree ? (
            <fieldset className="mt-6">
              <legend className="text-sm font-semibold text-[hsl(var(--foreground))]">Covers</legend>
              <div className="mt-3 grid gap-2 sm:grid-cols-2" data-testid="export-scope-options">
                {scopeOptions.map((option) => (
                  <label key={option.value} className="relative">
                    <input
                      ref={option.value === scope ? firstScopeRef : undefined}
                      type="radio"
                      name={`${baseId}-scope`}
                      value={option.value}
                      checked={scope === option.value}
                      onChange={() => setScope(option.value)}
                      aria-labelledby={`${baseId}-scope-${option.value}-label`}
                      aria-describedby={`${baseId}-scope-${option.value}`}
                      className="peer sr-only"
                      data-testid={`radio-scope-${option.value}`}
                    />
                    <span className="flex min-h-11 h-full cursor-pointer flex-col justify-center rounded-xl border border-[hsl(var(--border))] px-3 py-2.5 transition hover:border-[hsl(var(--primary)/.6)] peer-checked:border-[hsl(var(--primary))] peer-checked:bg-[hsl(var(--primary)/.1)] peer-checked:shadow-[inset_0_0_0_1px_hsl(var(--primary))] peer-focus-visible:ring-2 peer-focus-visible:ring-[hsl(var(--ring))] peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-[hsl(var(--card))]">
                      <span
                        id={`${baseId}-scope-${option.value}-label`}
                        className="text-sm font-semibold text-[hsl(var(--foreground))]"
                      >
                        {option.label}
                      </span>
                      <span
                        id={`${baseId}-scope-${option.value}`}
                        className="mt-0.5 truncate text-xs text-[hsl(var(--muted-foreground))]"
                      >
                        {option.hint}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}

          <fieldset className="mt-6">
            <legend className="text-sm font-semibold text-[hsl(var(--foreground))]">Range</legend>
            <p className="mt-0.5 text-xs text-[hsl(var(--muted-foreground))]">
              Whole days on this device’s school calendar, both ends included.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="export-range-presets">
              {RANGE_PRESETS.map((option) => (
                <label key={option} className="relative">
                  <input
                    ref={option === preset ? firstFieldRef : undefined}
                    type="radio"
                    name={`${baseId}-preset`}
                    value={option}
                    checked={preset === option}
                    onChange={() => setPreset(option)}
                    className="peer sr-only"
                    data-testid={`radio-range-${option}`}
                  />
                  <span className="flex min-h-11 cursor-pointer items-center justify-center rounded-xl border border-[hsl(var(--border))] px-2 text-center text-sm font-semibold text-[hsl(var(--foreground))] transition hover:border-[hsl(var(--primary)/.6)] peer-checked:border-[hsl(var(--primary))] peer-checked:bg-[hsl(var(--primary))] peer-checked:text-[hsl(var(--primary-foreground))] peer-focus-visible:ring-2 peer-focus-visible:ring-[hsl(var(--ring))] peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-[hsl(var(--card))]">
                    {RANGE_PRESET_LABELS[option]}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          {preset === 'day' ? (
            <div className="mt-4">
              <label className={fieldLabel} htmlFor={`${baseId}-day`}>
                Day
              </label>
              <input
                id={`${baseId}-day`}
                type="date"
                value={day}
                onChange={(event) => setDay(event.target.value)}
                aria-invalid={!resolution.ok}
                aria-describedby={!resolution.ok ? errorId : undefined}
                className={dateInput}
                data-testid="input-export-day"
              />
            </div>
          ) : null}

          {preset === 'custom' ? (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div>
                <label className={fieldLabel} htmlFor={`${baseId}-from`}>
                  From
                </label>
                <input
                  id={`${baseId}-from`}
                  type="date"
                  value={from}
                  onChange={(event) => setFrom(event.target.value)}
                  aria-invalid={!resolution.ok}
                  aria-describedby={!resolution.ok ? errorId : undefined}
                  className={dateInput}
                  data-testid="input-export-from"
                />
              </div>
              <div>
                <label className={fieldLabel} htmlFor={`${baseId}-to`}>
                  To
                </label>
                <input
                  id={`${baseId}-to`}
                  type="date"
                  value={to}
                  onChange={(event) => setTo(event.target.value)}
                  aria-invalid={!resolution.ok}
                  aria-describedby={!resolution.ok ? errorId : undefined}
                  className={dateInput}
                  data-testid="input-export-to"
                />
              </div>
            </div>
          ) : null}

          {!resolution.ok ? (
            <p
              id={errorId}
              className="mt-3 flex items-start gap-2 rounded-xl border border-[hsl(var(--destructive)/.5)] bg-[hsl(var(--destructive)/.09)] px-3 py-2.5 text-sm text-[hsl(var(--destructive))]"
              role="alert"
              data-testid="text-export-range-error"
            >
              <AlertTriangle aria-hidden="true" className="mt-0.5 shrink-0" size={16} />
              {resolution.error}
            </p>
          ) : null}

          {preview && range ? (
            <div
              className="mt-5 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--background)/.55)] p-4"
              aria-live="polite"
              data-testid="export-preview"
            >
              <p className="flex items-center gap-2 font-display text-base font-semibold text-[hsl(var(--foreground))]">
                <CalendarRange aria-hidden="true" size={16} className="shrink-0 text-[hsl(var(--primary))]" />
                <span data-testid="text-export-range">{formatRangeLabel(range)}</span>
              </p>
              {preview.tapCount === 0 ? (
                <p className="mt-2 text-sm leading-6 text-[hsl(var(--muted-foreground))]" data-testid="text-export-empty">
                  No taps in this range. The file will still list{' '}
                  {preview.enrolled === 0 ? 'the empty roster' : plural(preview.enrolled, 'student')}
                  , with no meetings held.
                </p>
              ) : (
                <dl className="mt-3 grid grid-cols-3 gap-2 text-center" data-testid="list-export-counts">
                  {[
                    ['Meetings', preview.meetingsHeld],
                    ['Taps', preview.tapCount],
                    ['Students present', preview.uniquePresent],
                  ].map(([label, value]) => (
                    <div key={label} className="flex flex-col-reverse rounded-xl bg-[hsl(var(--card))] px-2 py-2.5">
                      <dt className="text-[11px] text-[hsl(var(--muted-foreground))]">{label}</dt>
                      <dd className="font-display text-xl font-semibold tabular-nums text-[hsl(var(--foreground))]">
                        {value}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
              {preview.bodies ? (
                <p className="mt-3 text-xs leading-5 text-[hsl(var(--muted-foreground))]" data-testid="text-export-bodies">
                  {plural(preview.bodies.count, 'row')} in Summary by period
                  {preview.bodies.archived > 0 ? `, ${preview.bodies.archived} archived` : ''}. A student
                  in two {subtree?.noun ?? 'children'} counts in each, and once in the totals.
                </p>
              ) : null}
              <p className="mt-3 text-xs leading-5 text-[hsl(var(--muted-foreground))]">
                Sheets: Summary, {preview.bodies ? 'Summary by period, ' : ''}Attendance, By meeting
                {range.preset === 'all-time' ? ', and the Activity log' : ''}.
              </p>
              <p className="mt-1 break-words text-xs leading-5 text-[hsl(var(--muted-foreground))]">
                File: <span className="font-semibold text-[hsl(var(--foreground))]" data-testid="text-export-filename">{preview.filename}</span>
              </p>
              {preview.caveat ? (
                <p
                  className="mt-3 flex items-start gap-2 text-xs leading-5 text-[hsl(var(--muted-foreground))]"
                  data-testid="text-export-retention"
                >
                  <Info aria-hidden="true" size={14} className="mt-0.5 shrink-0" />
                  {preview.caveat}
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="mt-7 grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={isWorking}
              className="min-h-11 rounded-xl border border-[hsl(var(--border))] px-4 py-3 text-sm font-bold text-[hsl(var(--foreground))] transition hover:bg-[hsl(var(--secondary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] disabled:opacity-60"
              data-testid="button-export-cancel"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!range || isWorking}
              aria-describedby={!resolution.ok ? errorId : undefined}
              className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[hsl(var(--primary))] px-4 py-3 text-sm font-bold text-[hsl(var(--primary-foreground))] transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] disabled:cursor-not-allowed disabled:opacity-60"
              data-testid="button-export-confirm"
            >
              <FileSpreadsheet aria-hidden="true" size={15} />
              {isWorking ? 'Exporting…' : 'Export workbook'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
