import * as XLSX from 'xlsx';

import type { ActivityEntry, AttendanceBody, Person, TapRecord } from '@/data/attendance-store';
import {
  ACTIVITY_COLUMNS,
  EXPORT_COLUMNS,
  buildActivityRows,
  buildAttendanceRows,
  deriveGrade,
  type AttendanceWorkbook,
} from '@/lib/attendance-export';
import { computeRangeMetrics, type RangeMetrics } from '@/lib/attendance-metrics';
import {
  RANGE_PRESET_LABELS,
  formatRangeForFilename,
  type DateRange,
} from '@/lib/date-range';
import {
  SESSION_TIME_ZONE,
  formatSessionDate,
  formatSessionDateLabel,
  formatSessionTimestamp,
} from '@/lib/session-formatting';
import { deliverWorkbook, type DeliveredExport } from '@/lib/workbook-delivery';

/**
 * What one file-name segment may hold: letters and digits in any script,
 * spaces and a few harmless marks. Everything else — path separators, `:`,
 * `?`, quotes, control characters, emoji — becomes `-`. The desktop shell
 * accepts exactly this charset (`RANGE_EXPORT_FILENAME` in
 * `electron/validation.ts`), so the two cannot drift apart unnoticed: a test
 * feeds this module's real output through that allowlist.
 */
const UNSAFE_FILENAME_CHARS = /[^\p{L}\p{N} _.,'()&+#-]/gu;

/** Long enough for "English 11 - Period 3 - Room 114", short enough for any disk. */
const MAX_BODY_PATH_LENGTH = 100;

function sanitizeFilenamePart(part: string): string {
  return part
    .normalize('NFC')
    .replace(UNSAFE_FILENAME_CHARS, '-')
    .replace(/\s+/g, ' ')
    .replace(/-{2,}/g, '-')
    .replace(/^[\s.-]+|[\s.-]+$/g, '');
}

/**
 * `English 11 - Period 3 - 2026-09-01 to 2026-09-24.xlsx`: the body path,
 * then the range, so a folder of exports reads and sorts by class.
 *
 * Segments are joined with a plain ` - ` rather than an en dash: the name has
 * to survive a Windows disk, the Android share sheet and the desktop
 * allowlist, and ASCII keeps all three simple.
 *
 * Unlike the older `attendance-<date>-<stamp>` names there is no time stamp,
 * so the same range exported twice gets the same name. A browser renames the
 * second download, and the desktop Save dialog asks before replacing; on
 * Android the newer file replaces the older one in Documents, which is the
 * same range with newer data.
 */
export function buildRangeExportFilename(bodyPath: readonly string[], range: DateRange): string {
  const path = bodyPath
    .map(sanitizeFilenamePart)
    .filter(Boolean)
    .join(' - ')
    .slice(0, MAX_BODY_PATH_LENGTH)
    .replace(/[\s.-]+$/, '');
  return `${path || 'Attendance'} - ${formatRangeForFilename(range)}.xlsx`;
}

/** The earliest session day among `taps`, or `null` for none. */
export function oldestTapDay(taps: readonly TapRecord[]): string | null {
  let oldest: string | null = null;
  for (const tap of taps) {
    const day = formatSessionDate(tap.scannedAt);
    if (oldest === null || day < oldest) oldest = day;
  }
  return oldest;
}

/**
 * The Summary header's retention caveat (Design 09, Conflicts: "Retention vs
 * long ranges"), or `null` when the range starts on or after the oldest tap
 * this device still holds for the body. All time always starts before it.
 *
 * Worded so it is true whether the earlier days were purged by Data
 * retention or simply predate this body's first meeting: the device cannot
 * tell the two apart once the taps are gone.
 */
export function retentionCaveat(range: DateRange, oldest: string | null): string | null {
  if (oldest === null) {
    return 'This device holds no taps for this body, so this file has no attendance in it.';
  }
  if (range.from !== null && range.from >= oldest) return null;
  return `The oldest tap this device still holds for this body is from ${formatSessionDateLabel(
    oldest,
  )}. Nothing earlier is in this file: earlier meetings, if there were any, were deleted by data retention or were never recorded on this device.`;
}

/** One Summary row per person. Keys are the column headers, verbatim. */
export type SummaryPersonRow = {
  Name: string;
  Email: string;
  Grade: string;
  'Meetings attended': number;
  'Meetings held': number;
  'Attendance %': number | string;
  'First check-in': string;
  'Last check-in': string;
};

const SUMMARY_COLUMNS: (keyof SummaryPersonRow)[] = [
  'Name',
  'Email',
  'Grade',
  'Meetings attended',
  'Meetings held',
  'Attendance %',
  'First check-in',
  'Last check-in',
];

/** One By meeting row per session. Keys are the column headers, verbatim. */
export type MeetingRow = {
  Date: string;
  'Start time': string;
  Present: number;
  'Roster size': number;
};

const MEETING_COLUMNS: (keyof MeetingRow)[] = ['Date', 'Start time', 'Present', 'Roster size'];

/** What an empty percentage reads as in the file: no meetings, or no roster. */
export const NO_PERCENT = '—';

/** One decimal, as a number, so Excel can still sort and average the column. */
function roundPercent(value: number | null): number | string {
  return value === null ? NO_PERCENT : Math.round(value * 10) / 10;
}

function personName(person: Person): string {
  return [person.firstName, person.lastName]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' ');
}

export function buildSummaryPersonRows(metrics: RangeMetrics, now: string): SummaryPersonRow[] {
  return metrics.people.map((row) => ({
    Name: personName(row.person),
    Email: row.person.email,
    Grade: deriveGrade(row.person.gradYear, now),
    'Meetings attended': row.attended,
    'Meetings held': row.held,
    'Attendance %': roundPercent(row.percent),
    'First check-in': row.firstCheckIn ? formatSessionTimestamp(row.firstCheckIn) : '',
    'Last check-in': row.lastCheckIn ? formatSessionTimestamp(row.lastCheckIn) : '',
  }));
}

export function buildMeetingRows(metrics: RangeMetrics): MeetingRow[] {
  return metrics.meetings.map((meeting) => ({
    Date: meeting.date,
    'Start time': formatSessionTimestamp(meeting.startedAt).slice(11, 16),
    Present: meeting.present,
    'Roster size': meeting.rosterSize,
  }));
}

/** The range line of the Summary header: `This school year: 2026-08-01 to 2026-09-24`. */
function describeRange(range: DateRange): string {
  const preset = RANGE_PRESET_LABELS[range.preset];
  const span = formatRangeForFilename(range);
  if (range.from === null || range.to === null) return span;
  return preset === 'Custom' || preset === 'Single day' ? span : `${preset}: ${span}`;
}

/**
 * The Summary sheet: a header block (body path, range, when, the body's own
 * figures, the retention caveat when it applies), a blank row, then one row
 * per person. Built as an array of arrays because the header block is not a
 * table.
 */
function buildSummarySheet(input: {
  bodyPath: readonly string[];
  range: DateRange;
  now: string;
  metrics: RangeMetrics;
  caveat: string | null;
}): XLSX.WorkSheet {
  const { metrics } = input;
  const header: (string | number)[][] = [
    ['Attendance summary'],
    ['Body', input.bodyPath.join(' › ')],
    ['Range', describeRange(input.range)],
    ['Exported at', `${formatSessionTimestamp(input.now)} (${SESSION_TIME_ZONE})`],
    ['Meetings held', metrics.meetingsHeld],
    ['Average attendance %', roundPercent(metrics.averageAttendancePercent)],
    ['Unique present', `${metrics.uniquePresent} of ${metrics.enrolled} enrolled`],
  ];
  if (input.caveat) header.push(['Note', input.caveat]);
  header.push([]);

  const people = buildSummaryPersonRows(metrics, input.now);
  const table: (string | number)[][] = [
    SUMMARY_COLUMNS,
    ...people.map((row) => SUMMARY_COLUMNS.map((column) => row[column])),
  ];
  if (people.length === 0) table.push(['No students are enrolled on this body.']);
  else if (metrics.meetingsHeld === 0) table.push(['No meetings in this range.']);

  return XLSX.utils.aoa_to_sheet([...header, ...table]);
}

export type RangeExportInput = {
  /** The active body's own taps (whole history; filtered here). */
  taps: readonly TapRecord[];
  /** The active body's roster as it stands now. */
  persons: readonly Person[];
  body?: AttendanceBody;
  /** Root-first names, e.g. `['English 11', 'Period 3']`. */
  bodyPath: readonly string[];
  range: DateRange;
  /** Read once, so the header stamp and the grades agree. */
  now?: Date;
  /**
   * The activity log. Only an All time export carries it (Design 06: the
   * whole-history file is the record, and the log says where earlier copies
   * went); any other range ignores it — a slice is not the record.
   */
  activity?: readonly ActivityEntry[];
};

export type RangeWorkbook = AttendanceWorkbook & {
  /** Counts for the activity row: taps and sessions in the file. */
  tapCount: number;
  sessionCount: number;
};

/**
 * The single-body date-range workbook (Design 09 §4): Summary, Attendance,
 * By meeting, and — for All time only — Activity.
 */
export function buildRangeWorkbook(input: RangeExportInput): RangeWorkbook {
  const now = (input.now ?? new Date()).toISOString();
  const metrics = computeRangeMetrics(input.taps, input.persons, input.range, 'row');
  const caveat = retentionCaveat(input.range, oldestTapDay(input.taps));

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    buildSummarySheet({ bodyPath: input.bodyPath, range: input.range, now, metrics, caveat }),
    'Summary',
  );
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(buildAttendanceRows(metrics.taps, input.persons, input.body), {
      header: EXPORT_COLUMNS,
    }),
    'Attendance',
  );
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(buildMeetingRows(metrics), { header: MEETING_COLUMNS }),
    'By meeting',
  );
  // The row for this very export is written after delivery, so it is never
  // in the sheet it produces.
  if (input.range.preset === 'all-time' && input.activity) {
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(buildActivityRows(input.activity), {
        header: ACTIVITY_COLUMNS,
      }),
      'Activity',
    );
  }

  return {
    filename: buildRangeExportFilename(input.bodyPath, input.range),
    workbook,
    tapCount: metrics.taps.length,
    sessionCount: metrics.meetingsHeld,
  };
}

/** Builds the range workbook and hands it to the platform (`deliverWorkbook`). */
export async function exportRangeWorkbook(
  input: RangeExportInput,
): Promise<DeliveredExport & { tapCount: number; sessionCount: number }> {
  const { tapCount, sessionCount, ...built } = buildRangeWorkbook(input);
  const delivered = await deliverWorkbook(built);
  return { ...delivered, tapCount, sessionCount };
}
