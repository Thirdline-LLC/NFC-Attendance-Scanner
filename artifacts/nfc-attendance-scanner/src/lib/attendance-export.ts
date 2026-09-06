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

export function deriveGrade(
  gradYear: number,
  timestamp = new Date().toISOString(),
): string {
  const grade = 12 - (gradYear - currentSeniorGradYear(timestamp));

  if (grade >= 9 && grade <= 12) return String(grade);
  if (grade > 12) return 'Alumni';
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