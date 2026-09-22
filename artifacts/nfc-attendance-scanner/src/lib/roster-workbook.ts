import * as XLSX from 'xlsx';

import type { Person, RosterEntry } from '@/data/attendance-store';
import { deriveGrade } from '@/lib/attendance-export';
import { maskCardUid } from '@/lib/scan-format';
import { formatSessionDate } from '@/lib/session-formatting';
import {
  deriveStudentEmail,
  isSchoolDomainEmail,
  SCHOOL_EMAIL_DOMAIN,
} from '@/lib/student-email';
import {
  deliverWorkbook,
  type DeliveredExport,
} from '@/lib/workbook-delivery';

/**
 * The roster sheet: who is on this device, as a workbook the app both writes
 * and reads back.
 *
 * It is the pre-enrollment format. A teacher exports it to get the headers
 * right, fills in a class with the card column left empty, and imports it —
 * every row becomes a student with no card, ready to be bound at the kiosk by
 * tapping.
 *
 * The card column carries the same `••••` + last four the screen and the
 * attendance export show, never the full UID: a UID is hardware identity and
 * the workbook is the one artefact that routinely leaves the device. That
 * makes the round trip deliberately lossy in exactly one direction — a file
 * cannot bind a card, only report that one is already bound — which is also
 * the property that keeps an import from rewriting hardware it cannot name.
 */
export type RosterSheetRow = {
  'First Name': string;
  'Last Name': string;
  'Graduation Year': string;
  Email: string;
  /** Derived from the graduation year at export time; ignored on import. */
  Grade: string;
  /** `••••` + last four, or empty for a student with no card yet. */
  'Card (last 4)': string;
};

export const ROSTER_SHEET_NAME = 'Roster';

export const ROSTER_COLUMNS: (keyof RosterSheetRow)[] = [
  'First Name',
  'Last Name',
  'Graduation Year',
  'Email',
  'Grade',
  'Card (last 4)',
];

/**
 * Header spellings an import accepts for each column, folded to lowercase
 * with runs of whitespace collapsed. Teachers retype headers, and a file
 * refused over "Grad Year" would send them hunting for a difference the app
 * could simply have absorbed.
 */
const HEADER_ALIASES: Record<string, keyof RosterSheetRow> = {
  'first name': 'First Name',
  first: 'First Name',
  'last name': 'Last Name',
  last: 'Last Name',
  surname: 'Last Name',
  'graduation year': 'Graduation Year',
  'grad year': 'Graduation Year',
  'class of': 'Graduation Year',
  email: 'Email',
  'email address': 'Email',
  grade: 'Grade',
  'card (last 4)': 'Card (last 4)',
  'card last 4': 'Card (last 4)',
  card: 'Card (last 4)',
};

/** The columns a row cannot be understood without. */
const REQUIRED_COLUMNS: (keyof RosterSheetRow)[] = [
  'First Name',
  'Last Name',
  'Graduation Year',
];

/** Outside this a four-digit year is a typo or a misread column, not a class. */
const MIN_GRAD_YEAR = 1900;
const MAX_GRAD_YEAR = 2200;

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function cell(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

export function buildRosterRows(persons: readonly Person[]): RosterSheetRow[] {
  const ordered = [...persons].sort(
    (a, b) =>
      a.lastName.localeCompare(b.lastName, 'en', { sensitivity: 'base' }) ||
      a.firstName.localeCompare(b.firstName, 'en', { sensitivity: 'base' }),
  );

  return ordered.map((person) => ({
    'First Name': person.firstName,
    'Last Name': person.lastName,
    'Graduation Year': String(person.gradYear),
    Email: person.email,
    Grade: deriveGrade(person.gradYear),
    'Card (last 4)': person.cardUid ? maskCardUid(person.cardUid) : '',
  }));
}

/** A finished workbook and the name it should be saved under. */
export type RosterWorkbook = { filename: string; workbook: XLSX.WorkBook };

/**
 * The roster as a workbook, built but not delivered anywhere — the same split
 * `buildAttendanceWorkbook` makes, and for the same reason: delivery is
 * platform-specific and this half can be asserted on directly.
 */
export function buildRosterWorkbook(
  persons: readonly Person[],
  now: Date = new Date(),
): RosterWorkbook {
  const worksheet = XLSX.utils.json_to_sheet(buildRosterRows(persons), {
    header: ROSTER_COLUMNS,
  });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, ROSTER_SHEET_NAME);
  const timestamp = now.toISOString();
  const exportStamp = timestamp.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');

  return {
    filename: `roster-${formatSessionDate(timestamp)}-${exportStamp}.xlsx`,
    workbook,
  };
}

/**
 * Builds the roster workbook and hands it over by whichever route the
 * platform has. `deliverWorkbook` owns that choice; this exists so the roster
 * page need not know there is one.
 */
export async function exportRosterWorkbook(
  persons: readonly Person[],
): Promise<DeliveredExport> {
  return deliverWorkbook(buildRosterWorkbook(persons));
}

/** A row the import would not take, and the reason, in words a teacher can act on. */
export type RejectedRosterRow = {
  /** The worksheet line number, so the reason points at a row they can see. */
  row: number;
  reason: string;
};

export type ParsedRoster = {
  entries: RosterEntry[];
  rejected: RejectedRosterRow[];
  /**
   * Rows whose card column was filled in. Reported so the summary can say the
   * file's card column was read and ignored, rather than leaving a teacher to
   * wonder whether it bound anything.
   */
  cardsIgnored: number;
};

/** Thrown when a file is not a roster workbook at all. */
export class RosterFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RosterFormatError';
  }
}

/**
 * The sheet to read: the one named `Roster` if the workbook has it, otherwise
 * the first sheet, so a file saved out of another tool with one unnamed sheet
 * still works.
 */
function selectSheet(workbook: XLSX.WorkBook): XLSX.WorkSheet {
  const named = workbook.SheetNames.find(
    (name) => normalizeHeader(name) === normalizeHeader(ROSTER_SHEET_NAME),
  );
  const sheetName = named ?? workbook.SheetNames[0];
  const sheet = sheetName ? workbook.Sheets[sheetName] : undefined;

  if (!sheet) {
    throw new RosterFormatError('That file has no sheets in it.');
  }

  return sheet;
}

/**
 * Reads a roster workbook into entries the store can apply, plus a reason for
 * every row it would not take.
 *
 * Nothing here throws for one bad row. A class list typed by hand will have a
 * blank graduation year in it somewhere, and refusing the whole file over one
 * cell would mean the teacher imports nothing until the sheet is perfect. A
 * file with no recognisable headers at all is a different thing — that is the
 * wrong file, not a bad row — and does throw.
 */
export function parseRosterWorkbook(workbook: XLSX.WorkBook): ParsedRoster {
  const sheet = selectSheet(workbook);
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: '',
  });
  const headers = Object.keys(rows[0] ?? {});
  // Header text -> canonical column, for the headers this file actually has.
  const columns = new Map<keyof RosterSheetRow, string>();
  for (const header of headers) {
    const canonical = HEADER_ALIASES[normalizeHeader(header)];
    if (canonical && !columns.has(canonical)) columns.set(canonical, header);
  }

  const missing = REQUIRED_COLUMNS.filter((column) => !columns.has(column));
  if (missing.length > 0) {
    throw new RosterFormatError(
      `That file does not look like a roster export: it is missing the ${missing.join(', ')} column${missing.length === 1 ? '' : 's'}. Export the roster first to get a file with the right headers.`,
    );
  }

  const entries: RosterEntry[] = [];
  const rejected: RejectedRosterRow[] = [];
  let cardsIgnored = 0;
  // Addresses already taken by this file, so two rows cannot both claim one —
  // the roster allows an address to identify exactly one student.
  const seenEmails = new Set<string>();

  rows.forEach((row, index) => {
    // Header on line 1, so the first data row is line 2.
    const line = index + 2;
    const read = (column: keyof RosterSheetRow) => {
      const header = columns.get(column);
      return header ? cell(row, header) : '';
    };

    const firstName = read('First Name');
    const lastName = read('Last Name');
    const gradYearText = read('Graduation Year');
    const emailText = read('Email');

    // A wholly blank line is spreadsheet padding, not a student, and reporting
    // it as refused would make every file look half broken.
    if (!firstName && !lastName && !gradYearText && !emailText) return;

    if (read('Card (last 4)')) cardsIgnored += 1;

    if (!firstName || !lastName) {
      rejected.push({ row: line, reason: 'Missing a first or last name.' });
      return;
    }

    const gradYear = Number(gradYearText);
    if (
      !/^\d{4}$/.test(gradYearText) ||
      gradYear < MIN_GRAD_YEAR ||
      gradYear > MAX_GRAD_YEAR
    ) {
      rejected.push({
        row: line,
        reason: `Graduation year "${gradYearText}" is not a four-digit year.`,
      });
      return;
    }

    let email = emailText.toLowerCase();
    if (!email) {
      // The same formula the enrollment form proposes, so a sheet that leaves
      // the column out lands on the addresses the app would have suggested.
      try {
        email = deriveStudentEmail(firstName, lastName, gradYear);
      } catch {
        rejected.push({
          row: line,
          reason: 'No email, and one could not be derived from the name.',
        });
        return;
      }
    }

    // The reasons name the row, never the student. A teacher reads this
    // summary with the sheet open beside them, so a line number points at the
    // problem exactly — and an import covers a whole school, which would make
    // a list of addresses on a corridor screen the app's largest disclosure.
    if (!isSchoolDomainEmail(email)) {
      rejected.push({
        row: line,
        reason: `The email is not a ${SCHOOL_EMAIL_DOMAIN} address.`,
      });
      return;
    }

    if (seenEmails.has(email)) {
      rejected.push({
        row: line,
        reason: 'The email is already used by an earlier row in this file.',
      });
      return;
    }

    seenEmails.add(email);
    entries.push({ firstName, lastName, gradYear, email });
  });

  return { entries, rejected, cardsIgnored };
}

/** Reads an uploaded `.xlsx` file into entries and reasons. */
export async function parseRosterFile(file: File): Promise<ParsedRoster> {
  let workbook: XLSX.WorkBook;

  try {
    workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  } catch {
    throw new RosterFormatError(
      'That file could not be opened as a spreadsheet. Pick the .xlsx the app exported.',
    );
  }

  return parseRosterWorkbook(workbook);
}
