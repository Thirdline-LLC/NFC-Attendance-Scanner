/**
 * Session timestamps are recorded as instants but displayed and grouped by
 * the school's local calendar. Keep that contract here so the scanner,
 * dashboard, and workbook cannot quietly choose different boundaries.
 */
export const SESSION_TIME_ZONE = 'America/New_York';

let sessionPartsFormat: Intl.DateTimeFormat | undefined;
let sessionYearMonthFormat: Intl.DateTimeFormat | undefined;
let sessionDateLabelFormat: Intl.DateTimeFormat | undefined;
let sessionDateTimeLabelFormat: Intl.DateTimeFormat | undefined;
let sessionLastSeenLabelFormat: Intl.DateTimeFormat | undefined;

function partsFormat(): Intl.DateTimeFormat {
  sessionPartsFormat ??= new Intl.DateTimeFormat('en-US', {
    timeZone: SESSION_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    // Pin midnight to 00. Some ICU builds read `hour12: false` as h24 and
    // would otherwise render it as hour 24.
    hourCycle: 'h23',
  });
  return sessionPartsFormat;
}

function yearMonthFormat(): Intl.DateTimeFormat {
  sessionYearMonthFormat ??= new Intl.DateTimeFormat('en-US', {
    timeZone: SESSION_TIME_ZONE,
    year: 'numeric',
    month: 'numeric',
  });
  return sessionYearMonthFormat;
}

function dateLabelFormat(): Intl.DateTimeFormat {
  sessionDateLabelFormat ??= new Intl.DateTimeFormat('en-US', {
    // `date` is already a local calendar date. UTC noon prevents the host
    // browser's own zone from moving it to the previous or next day.
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  return sessionDateLabelFormat;
}

function dateTimeLabelFormat(): Intl.DateTimeFormat {
  sessionDateTimeLabelFormat ??= new Intl.DateTimeFormat('en-US', {
    timeZone: SESSION_TIME_ZONE,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  return sessionDateTimeLabelFormat;
}

function lastSeenLabelFormat(): Intl.DateTimeFormat {
  sessionLastSeenLabelFormat ??= new Intl.DateTimeFormat('en-US', {
    timeZone: SESSION_TIME_ZONE,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  return sessionLastSeenLabelFormat;
}

function sessionParts(timestamp: string): Record<string, string> {
  return Object.fromEntries(
    partsFormat()
      .formatToParts(new Date(timestamp))
      .map(({ type, value }) => [type, value]),
  );
}

/** The local calendar date used for session grouping and workbook rows. */
export function formatSessionDate(timestamp: string): string {
  const parts = sessionParts(timestamp);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** A canonical local session date rendered for people, e.g. `Sep 10, 2026`. */
export function formatSessionDateLabel(date: string): string {
  return dateLabelFormat().format(new Date(`${date}T12:00:00.000Z`));
}

/** A local session instant rendered with its date and time. */
export function formatSessionDateTime(timestamp: string): string {
  return dateTimeLabelFormat().format(new Date(timestamp));
}

/** An unidentified card's last-seen instant rendered in the same local zone. */
export function formatSessionLastSeen(timestamp: string): string {
  return lastSeenLabelFormat().format(new Date(timestamp));
}

/** The local year and month used by school-year and grade calculations. */
export function formatSessionYearMonth(timestamp: string): {
  year: string;
  month: string;
} {
  const parts = yearMonthFormat().formatToParts(new Date(timestamp));
  return {
    year: parts.find((part) => part.type === 'year')?.value ?? '',
    month: parts.find((part) => part.type === 'month')?.value ?? '',
  };
}

/** The local timestamp shape used in workbook exports. */
export function formatSessionTimestamp(timestamp: string): string {
  const parts = sessionParts(timestamp);
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}