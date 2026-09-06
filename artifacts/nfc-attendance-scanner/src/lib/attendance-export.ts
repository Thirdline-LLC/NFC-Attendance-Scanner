import * as XLSX from 'xlsx';
import type { Person, TapRecord } from '@/data/attendance-store';

const EXPORT_TIME_ZONE = 'America/New_York';
const EXPORT_COLUMNS = [
  'Timestamp',
  'Card UID',
  'Meeting Date',
  'Name',
  'Email',
  'Grade',
];

function formatEasternParts(timestamp: string): Record<string, string> {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: EXPORT_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date(timestamp));

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
  const easternDate = new Intl.DateTimeFormat('en-US', {
    timeZone: EXPORT_TIME_ZONE,
    year: 'numeric',
    month: 'numeric',
  }).formatToParts(new Date(timestamp));
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

export function exportAttendanceWorkbook(
  taps: TapRecord[],
  persons: Person[],
): void {
  const peopleById = new Map(
    persons.filter((person) => person.id !== undefined).map((person) => [person.id, person]),
  );
  const rows = taps.map((tap) => {
    const person = tap.personId === null ? undefined : peopleById.get(tap.personId);
    const name = person ? `${person.firstName} ${person.lastName}` : 'Unknown';

    return {
      Timestamp: formatExportTimestamp(tap.scannedAt),
      'Card UID': tap.uid,
      'Meeting Date': formatMeetingDate(tap.scannedAt),
      Name: name,
      Email: person?.email ?? '',
      Grade: person ? deriveGrade(person.gradYear, tap.scannedAt) : '',
    };
  });

  const worksheet = XLSX.utils.json_to_sheet(rows, { header: EXPORT_COLUMNS });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Attendance');
  const exportStamp = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
  const filename = `attendance-${formatMeetingDate(new Date().toISOString())}-${exportStamp}.xlsx`;

  XLSX.writeFile(workbook, filename, { bookType: 'xlsx', compression: true });
}