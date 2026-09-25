import { currentSeniorGradYear } from '@/lib/attendance-export';
import { formatSessionDate, formatSessionDateLabel } from '@/lib/session-formatting';

/**
 * The range presets of the Export dialog (Design 09 §4), in the order the
 * dialog lists them.
 */
export const RANGE_PRESETS = [
  'today',
  'day',
  'last-7-days',
  'past-month',
  'past-year',
  'school-year',
  'all-time',
  'custom',
] as const;

export type RangePreset = (typeof RANGE_PRESETS)[number];

export const RANGE_PRESET_LABELS: Record<RangePreset, string> = {
  today: 'Today',
  day: 'Single day',
  'last-7-days': 'Last 7 days',
  'past-month': 'Past month',
  'past-year': 'Past year',
  'school-year': 'This school year',
  'all-time': 'All time',
  custom: 'Custom',
};

/**
 * An inclusive span of meeting days.
 *
 * Both ends are calendar dates (`YYYY-MM-DD`) on the school's session
 * calendar — the same local day `formatSessionDate` files a tap and a
 * session under, which is what the device clock reads on a kiosk in the
 * school. A range is therefore "local midnight to local midnight" by
 * construction: a tap belongs to it when its own session date falls between
 * `from` and `to`, both included, and the comparison is a string compare, as
 * in `selectYearToDateTaps` and the retention purge. Using the session
 * calendar rather than the host's zone keeps a range and the workbook's
 * Meeting Date column from ever disagreeing about which day a tap was on.
 *
 * `null` ends are unbounded; only All time has them.
 */
export type DateRange = {
  preset: RangePreset;
  from: string | null;
  to: string | null;
};

/**
 * First day of the school year in session on `now`. The senior class
 * graduates the spring after the year starts, so the year began on August 1
 * of the calendar year before their graduation year.
 */
export function schoolYearStart(now: string): string {
  return `${currentSeniorGradYear(now) - 1}-08-01`;
}

/** What the dialog hands over: a preset, plus the dates it asked for. */
export type RangeRequest = {
  preset: RangePreset;
  /** Single day. */
  day?: string;
  /** Custom. */
  from?: string;
  to?: string;
};

export type RangeResolution =
  | { ok: true; range: DateRange }
  | { ok: false; error: string };

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** True for a real calendar date in `YYYY-MM-DD` form; `2026-02-31` is not. */
export function isCalendarDay(value: string | undefined): value is string {
  if (!value || !DAY_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

// Calendar arithmetic runs on UTC midnights of the session-calendar date, and
// is read back with UTC getters, so no daylight-saving change can shift it.
function toUtc(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

function fromUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(day: string, days: number): string {
  const date = toUtc(day);
  date.setUTCDate(date.getUTCDate() + days);
  return fromUtc(date);
}

/**
 * Shifts by whole calendar months, clamping to the target month's last day:
 * March 31 minus one month is February 28 (or 29), never March 3.
 */
export function addMonths(day: string, months: number): string {
  const [year, month, date] = day.split('-').map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(date, lastDay));
  return fromUtc(target);
}

/**
 * Turns a dialog request into a range, against `now` read once.
 *
 * Each rolling preset ends today and includes it:
 * - Last 7 days: today and the six days before it.
 * - Past month: the day after this date last month, through today
 *   (Sep 24 → Aug 25 … Sep 24).
 * - Past year: the day after this date last year, through today.
 * - This school year: August 1 (`schoolYearStart`) through today.
 * - All time: unbounded at both ends, so a tap stamped by a clock that ran
 *   ahead is still in the file.
 */
export function resolveDateRange(
  request: RangeRequest,
  now: string = new Date().toISOString(),
): RangeResolution {
  const today = formatSessionDate(now);
  const range = (from: string | null, to: string | null): RangeResolution => ({
    ok: true,
    range: { preset: request.preset, from, to },
  });

  switch (request.preset) {
    case 'today':
      return range(today, today);
    case 'day':
      if (!isCalendarDay(request.day)) {
        return { ok: false, error: 'Choose the day to export.' };
      }
      return range(request.day, request.day);
    case 'last-7-days':
      return range(addDays(today, -6), today);
    case 'past-month':
      return range(addDays(addMonths(today, -1), 1), today);
    case 'past-year':
      return range(addDays(addMonths(today, -12), 1), today);
    case 'school-year':
      return range(schoolYearStart(now), today);
    case 'all-time':
      return range(null, null);
    case 'custom': {
      if (!isCalendarDay(request.from) || !isCalendarDay(request.to)) {
        return { ok: false, error: 'Choose both a start and an end date.' };
      }
      if (request.from > request.to) {
        return { ok: false, error: 'The start date is after the end date.' };
      }
      return range(request.from, request.to);
    }
  }
}

/** The school-year-to-date range the dashboard figures are computed over. */
export function schoolYearRange(now: string): DateRange {
  return {
    preset: 'school-year',
    from: schoolYearStart(now),
    to: formatSessionDate(now),
  };
}

/** Whether a session-calendar day falls inside the range, both ends included. */
export function rangeContainsDay(range: DateRange, day: string): boolean {
  return (range.from === null || day >= range.from) && (range.to === null || day <= range.to);
}

/**
 * The range as file-name text: `2026-09-01 to 2026-09-24`, a single
 * `2026-09-24`, or `All time`. ISO dates so the files sort by range.
 */
export function formatRangeForFilename(range: DateRange): string {
  if (range.from === null || range.to === null) return 'All time';
  if (range.from === range.to) return range.from;
  return `${range.from} to ${range.to}`;
}

/** The range for people: `Sep 1, 2026 – Sep 24, 2026`, or `All time`. */
export function formatRangeLabel(range: DateRange): string {
  if (range.from === null || range.to === null) return 'All time';
  if (range.from === range.to) return formatSessionDateLabel(range.from);
  return `${formatSessionDateLabel(range.from)} – ${formatSessionDateLabel(range.to)}`;
}
