import * as XLSX from 'xlsx';
import type { Person, TapRecord } from '@/data/attendance-store';
import { indexRoster, resolveTapPerson } from '@/lib/tap-identity';
import {
  deliverWorkbook,
  type DeliveredExport,
} from '@/lib/workbook-delivery';

const EXPORT_TIME_ZONE = 'America/New_York';

/** One worksheet row. The keys are the column headers, verbatim. */
export type AttendanceRow = {
  Timestamp: string;
  'Card UID': string;
  'Meeting Date': string;
  Name: string;
  Email: string;
  Grade: string;
};

const EXPORT_COLUMNS: (keyof AttendanceRow)[] = [
  'Timestamp',
  'Card UID',
  'Meeting Date',
  'Name',
  'Email',
  'Grade',
];

/**
 * What the Name column says for a card nobody has enrolled. A readable
 * placeholder rather than the UID, so a teacher skimming the sheet sees
 * "someone we have not enrolled" and the UID stays in its own column.
 */
export const UNKNOWN_CARD_NAME = 'Unknown card';

/**
 * Building an `Intl.DateTimeFormat` costs far more than using one, and these
 * two are used per tap: the export formats every row twice over and
 * `deriveGrade` reaches for the second one again. Constructed per call, a
 * 5,000-tap export spent ~1.3 s building formatters; held here it is ~60 ms.
 *
 * Lazily, not at module load: a runtime without `America/New_York` in its ICU
 * data should fail on the first export rather than on importing the module,
 * which would take the whole app down instead of one button.
 */
let easternTimestampFormat: Intl.DateTimeFormat | undefined;
let easternYearMonthFormat: Intl.DateTimeFormat | undefined;

function timestampFormat(): Intl.DateTimeFormat {
  easternTimestampFormat ??= new Intl.DateTimeFormat('en-US', {
    timeZone: EXPORT_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    // `hourCycle` is pinned rather than left to `hour12: false` alone, which
    // some ICU builds read as h24 and render midnight as hour 24.
    hourCycle: 'h23',
  });
  return easternTimestampFormat;
}

function yearMonthFormat(): Intl.DateTimeFormat {
  easternYearMonthFormat ??= new Intl.DateTimeFormat('en-US', {
    timeZone: EXPORT_TIME_ZONE,
    year: 'numeric',
    month: 'numeric',
  });
  return easternYearMonthFormat;
}

function formatEasternParts(timestamp: string): Record<string, string> {
  const parts = timestampFormat().formatToParts(new Date(timestamp));

  return Object.fromEntries(parts.map(({ type, value }) => [type, value]));
}

export function formatExportTimestamp(timestamp: string): string {
  const parts = formatEasternParts(timestamp);
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

export function formatMeetingDate(timestamp: string): string {
  const parts = formatEasternParts(timestamp);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function formatMeetingDateTime(timestamp: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: EXPORT_TIME_ZONE,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

/**
 * Commencement dates, keyed by graduating class, as Eastern-local calendar
 * dates (`YYYY-MM-DD`). A class reads as Alumni the day after the date listed
 * here, so the outgoing seniors stop counting as grade 12 at graduation rather
 * than waiting for the August school-year rollover. A listed date is
 * authoritative in both directions: a ceremony held after August 1 also keeps
 * that class in grade 12 until it happens.
 *
 * Add each class as its date is set, e.g. `2027: '2027-05-29'`. A class with no
 * entry falls back to the August rollover in `currentSeniorGradYear`, which is
 * an approximation: it keeps the outgoing seniors in grade 12 through the
 * summer.
 */
export const COMMENCEMENT_DATES: Record<number, string> = {};

/** Shape of a `COMMENCEMENT_DATES` value; also enforced by its unit test. */
const COMMENCEMENT_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The recorded commencement date for a class, or `null` when none is on file or
 * the entry is unusable, in which case the August fallback applies rather than a
 * bad date silently moving a class. An entry is unusable unless it is a real
 * calendar date falling in the class's own graduation year: `Date.parse` alone
 * is not enough, since it quietly rolls `2027-02-31` over into March.
 */
export function commencementDate(
  gradYear: number,
  commencementDates: Record<number, string> = COMMENCEMENT_DATES,
): string | null {
  const date = commencementDates[gradYear];

  if (!date || !COMMENCEMENT_DATE_PATTERN.test(date)) return null;
  if (date.slice(0, 4) !== String(gradYear)) return null;

  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  // Round-trip to reject an overflowing day such as 2027-02-31.
  if (parsed.toISOString().slice(0, 10) !== date) return null;

  return date;
}

/**
 * The graduation year of the senior class in session on `timestamp`. A school
 * year rolls over in August, so anything from August onward belongs to the
 * year that ends the following spring: August 2026 -> the class of 2027.
 */
export function currentSeniorGradYear(
  timestamp = new Date().toISOString(),
): number {
  const easternDate = yearMonthFormat().formatToParts(new Date(timestamp));
  const year = Number(easternDate.find((part) => part.type === 'year')?.value);
  // Intl months are 1-indexed, so August is 8.
  const month = Number(easternDate.find((part) => part.type === 'month')?.value);

  return month >= 8 ? year + 1 : year;
}

/**
 * True once a class has walked. Commencement day itself still counts as grade
 * 12, so a scan at a graduation-morning breakfast reports the student as a
 * senior; the class turns over at the start of the next Eastern day.
 */
export function hasGraduated(
  gradYear: number,
  timestamp = new Date().toISOString(),
  commencementDates: Record<number, string> = COMMENCEMENT_DATES,
): boolean {
  const date = commencementDate(gradYear, commencementDates);

  if (date === null) return false;

  // Both sides are Eastern `YYYY-MM-DD`, so a string compare is a date compare.
  return formatMeetingDate(timestamp) > date;
}

export function deriveGrade(
  gradYear: number,
  timestamp = new Date().toISOString(),
  commencementDates: Record<number, string> = COMMENCEMENT_DATES,
): string {
  const grade = 12 - (gradYear - currentSeniorGradYear(timestamp));

  // A recorded commencement date is authoritative in both directions: it
  // graduates a class ahead of the August rollover, and it also holds a class
  // whose ceremony runs late in grade 12 until they have actually walked.
  if (commencementDate(gradYear, commencementDates) !== null) {
    if (hasGraduated(gradYear, timestamp, commencementDates)) return 'Alumni';
    if (grade >= 12) return '12';
  }

  if (grade > 12) return 'Alumni';
  if (grade >= 9) return String(grade);
  return 'Below 9';
}

function formatPersonName(person: Person): string {
  // Joined from the trimmed, non-empty parts so a blank half of a name never
  // leaves a stray space behind.
  return [person.firstName, person.lastName]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' ');
}

/**
 * The worksheet's rows, one per tap, oldest first. Pure and file-free so the
 * export can be asserted on directly; `exportAttendanceWorkbook` only adds the
 * SheetJS plumbing.
 *
 * Each tap is matched to the roster as it stands now, not as it stood at scan
 * time: a card enrolled after its taps were recorded picks up the student's
 * name, email and grade retroactively (`resolveTapPerson`). Grade, however, is
 * derived at the tap's own timestamp, so last spring's tap by a sophomore
 * still reads as grade 10 in an export run this fall.
 */
export function buildAttendanceRows(
  taps: readonly TapRecord[],
  persons: readonly Person[],
): AttendanceRow[] {
  const roster = indexRoster(persons);
  // Callers may hand over taps in insertion order, which only matches time
  // order within a single session; history spanning sessions does not.
  const ordered = [...taps].sort(
    (a, b) => Date.parse(a.scannedAt) - Date.parse(b.scannedAt),
  );

  return ordered.map((tap) => {
    const person = resolveTapPerson(tap, roster);

    return {
      Timestamp: formatExportTimestamp(tap.scannedAt),
      'Card UID': tap.uid,
      'Meeting Date': formatMeetingDate(tap.scannedAt),
      Name: person ? formatPersonName(person) : UNKNOWN_CARD_NAME,
      Email: person?.email ?? '',
      Grade: person ? deriveGrade(person.gradYear, tap.scannedAt) : '',
    };
  });
}

/** A finished workbook and the name it should be saved under. */
export type AttendanceWorkbook = {
  filename: string;
  workbook: XLSX.WorkBook;
};

/**
 * The workbook itself, built but not delivered anywhere.
 *
 * Delivery is the half that is platform-specific: in a browser
 * `exportAttendanceWorkbook` hands it to `XLSX.writeFile`, which downloads it,
 * and a Capacitor build has to write the bytes itself (see
 * `docs/capacitor-native.md`). Keeping the two apart means the native path can
 * be added beside this without touching how the sheet is built — and it lets a
 * test assert the bytes without a DOM download.
 *
 * `now` is injectable so the filename is assertable; it is also read once, so
 * the meeting date and the stamp cannot straddle a second boundary.
 */
export function buildAttendanceWorkbook(
  taps: readonly TapRecord[],
  persons: readonly Person[],
  now: Date = new Date(),
): AttendanceWorkbook {
  const rows = buildAttendanceRows(taps, persons);
  const worksheet = XLSX.utils.json_to_sheet(rows, { header: EXPORT_COLUMNS });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Attendance');
  const timestamp = now.toISOString();
  const exportStamp = timestamp.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');

  return {
    // The date is Eastern (the meeting's own day); the stamp is UTC, and is
    // only there to keep two exports on one day from colliding.
    filename: `attendance-${formatMeetingDate(timestamp)}-${exportStamp}.xlsx`,
    workbook,
  };
}

/**
 * Builds the workbook and hands it over, by whichever route the platform has:
 * a browser download, or a file written to the device and offered to the share
 * sheet. `deliverWorkbook` owns that choice and documents what each route can
 * and cannot promise; this function exists so callers need not know.
 */
export async function exportAttendanceWorkbook(
  taps: readonly TapRecord[],
  persons: readonly Person[],
): Promise<DeliveredExport> {
  return deliverWorkbook(buildAttendanceWorkbook(taps, persons));
}
