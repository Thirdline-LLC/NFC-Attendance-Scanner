import * as XLSX from 'xlsx';

import type { AttendanceBody, Person, RosterEntry } from '@/data/attendance-store';
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
  /** Optional body scope columns — read on import, refused on mismatch. */
  'Body Name'?: string;
  'Body Type'?: string;
};

export const ROSTER_SHEET_NAME = 'Roster';

export const ROSTER_COLUMNS: (keyof RosterSheetRow)[] = [
  'First Name',
  'Last Name',
  'Graduation Year',
  'Email',
  'Grade',
  'Card (last 4)',
  'Body Name',
  'Body Type',
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
  first_name: 'First Name',
  'last name': 'Last Name',
  last: 'Last Name',
  surname: 'Last Name',
  last_name: 'Last Name',
  'graduation year': 'Graduation Year',
  'grad year': 'Graduation Year',
  'class of': 'Graduation Year',
  grad_year: 'Graduation Year',
  graduation_year: 'Graduation Year',
  email: 'Email',
  'email address': 'Email',
  email_address: 'Email',
  grade: 'Grade',
  'card (last 4)': 'Card (last 4)',
  'card last 4': 'Card (last 4)',
  card: 'Card (last 4)',
  body_name: 'Body Name',
  'body name': 'Body Name',
  body_type: 'Body Type',
  'body type': 'Body Type',
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

export function buildRosterRows(
  persons: readonly Person[],
  body?: AttendanceBody,
): RosterSheetRow[] {
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
    'Body Name': body?.name ?? '',
    'Body Type': body?.typeLabel ?? '',
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
  body?: AttendanceBody,
): RosterWorkbook {
  const worksheet = XLSX.utils.json_to_sheet(buildRosterRows(persons, body), {
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
  body?: AttendanceBody,
): Promise<DeliveredExport> {
  return deliverWorkbook(buildRosterWorkbook(persons, new Date(), body));
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
 *
 * When `activeBody` is supplied and a row's `body_name` or `body_type` column
 * is non-empty but does not match, the entire file is refused.
 */
export function parseRosterWorkbook(
  workbook: XLSX.WorkBook,
  activeBody?: AttendanceBody,
): ParsedRoster {
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

    // Body column validation: refuse the entire file on first mismatch.
    if (activeBody) {
      const bodyName = read('Body Name');
      const bodyType = read('Body Type');
      if (bodyName && bodyName.toLowerCase() !== activeBody.name.toLowerCase()) {
        throw new RosterFormatError(
          `This file is for "${bodyName}", but the active body is "${activeBody.name}". Switch to the right body before importing.`,
        );
      }
      if (bodyType && bodyType.toLowerCase() !== activeBody.typeLabel.toLowerCase()) {
        throw new RosterFormatError(
          `This file has body type "${bodyType}", but the active body type is "${activeBody.typeLabel}". Switch to the right body before importing.`,
        );
      }
    }

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
export async function parseRosterFile(
  file: File,
  activeBody?: AttendanceBody,
): Promise<ParsedRoster> {
  const name = file.name.toLowerCase();

  if (name.endsWith('.nfc-pack')) {
    return parseNfcPack(await file.text(), activeBody);
  }

  if (name.endsWith('.csv')) {
    return parseRosterCsv(await file.text(), activeBody);
  }

  let workbook: XLSX.WorkBook;

  try {
    workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  } catch {
    throw new RosterFormatError(
      'That file could not be opened as a spreadsheet. Pick the .xlsx the app exported.',
    );
  }

  return parseRosterWorkbook(workbook, activeBody);
}

// ---------------------------------------------------------------------------
// CSV import (snake_case headers, body_name / body_type optional columns)
// ---------------------------------------------------------------------------

/** Header spellings accepted for each CSV column, folded to lowercase. */
const CSV_HEADER_ALIASES: Record<string, keyof CsvRow> = {
  first_name: 'first_name',
  first: 'first_name',
  'first name': 'first_name',
  last_name: 'last_name',
  last: 'last_name',
  surname: 'last_name',
  'last name': 'last_name',
  grad_year: 'grad_year',
  graduation_year: 'grad_year',
  'grad year': 'grad_year',
  'graduation year': 'grad_year',
  'class of': 'grad_year',
  email: 'email',
  'email address': 'email',
  email_address: 'email',
  body_name: 'body_name',
  'body name': 'body_name',
  body_type: 'body_type',
  'body type': 'body_type',
};

type CsvRow = {
  first_name: string;
  last_name: string;
  grad_year: string;
  email: string;
  body_name: string;
  body_type: string;
};

/**
 * Splits a single CSV line into fields, honouring double-quoted fields and
 * the `""` escape for a literal quote inside one.
 */
function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

/**
 * Parses a CSV roster file into entries and rejected rows.
 *
 * Accepts both the app's snake_case headers (`first_name`, `last_name`,
 * `grad_year`) and the relaxed aliases the xlsx parser already accepts, so
 * a file exported from another tool still imports cleanly.
 *
 * When `body_name` or `body_type` columns are present and their values are
 * non-empty, they must match the active body or the entire file is refused.
 */
export function parseRosterCsvText(
  text: string,
  activeBody?: AttendanceBody,
): ParsedRoster {
  const lines = text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .filter((l) => l.trim().length > 0);

  if (lines.length === 0) {
    throw new RosterFormatError('That CSV file is empty.');
  }

  const headerLine = lines[0];
  const rawHeaders = splitCsvLine(headerLine);
  const columns = new Map<keyof CsvRow, number>();

  for (let i = 0; i < rawHeaders.length; i++) {
    const canonical = CSV_HEADER_ALIASES[rawHeaders[i].trim().toLowerCase().replace(/\s+/g, ' ')];
    if (canonical && !columns.has(canonical)) {
      columns.set(canonical, i);
    }
  }

  const missing: string[] = [];
  for (const required of ['first_name', 'last_name', 'grad_year'] as const) {
    if (!columns.has(required)) missing.push(required);
  }
  if (missing.length > 0) {
    throw new RosterFormatError(
      `That file does not look like a roster CSV: it is missing the ${missing.join(', ')} column${missing.length === 1 ? '' : 's'}. Download the template to get a file with the right headers.`,
    );
  }

  const read = (fields: string[], col: keyof CsvRow): string => {
    const idx = columns.get(col);
    return idx !== undefined ? (fields[idx] ?? '').trim() : '';
  };

  const dataLines = lines.slice(1);
  const entries: RosterEntry[] = [];
  const rejected: RejectedRosterRow[] = [];
  let cardsIgnored = 0;
  const seenEmails = new Set<string>();

  for (let i = 0; i < dataLines.length; i++) {
    const line = i + 2;
    const fields = splitCsvLine(dataLines[i]);

    const firstName = read(fields, 'first_name');
    const lastName = read(fields, 'last_name');
    const gradYearText = read(fields, 'grad_year');
    const emailText = read(fields, 'email');
    const bodyName = read(fields, 'body_name');
    const bodyType = read(fields, 'body_type');

    if (!firstName && !lastName && !gradYearText && !emailText) continue;

    // Body column validation: refuse the entire file on first mismatch.
    if (activeBody) {
      if (bodyName && bodyName.toLowerCase() !== activeBody.name.toLowerCase()) {
        throw new RosterFormatError(
          `This file is for "${bodyName}", but the active body is "${activeBody.name}". Switch to the right body before importing.`,
        );
      }
      if (bodyType && bodyType.toLowerCase() !== activeBody.typeLabel.toLowerCase()) {
        throw new RosterFormatError(
          `This file has body type "${bodyType}", but the active body type is "${activeBody.typeLabel}". Switch to the right body before importing.`,
        );
      }
    }

    if (!firstName || !lastName) {
      rejected.push({ row: line, reason: 'Missing a first or last name.' });
      continue;
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
      continue;
    }

    let email = emailText.toLowerCase();
    if (!email) {
      try {
        email = deriveStudentEmail(firstName, lastName, gradYear);
      } catch {
        rejected.push({
          row: line,
          reason: 'No email, and one could not be derived from the name.',
        });
        continue;
      }
    }

    if (!isSchoolDomainEmail(email)) {
      rejected.push({
        row: line,
        reason: `The email is not a ${SCHOOL_EMAIL_DOMAIN} address.`,
      });
      continue;
    }

    if (seenEmails.has(email)) {
      rejected.push({
        row: line,
        reason: 'The email is already used by an earlier row in this file.',
      });
      continue;
    }

    seenEmails.add(email);
    entries.push({ firstName, lastName, gradYear, email });
  }

  return { entries, rejected, cardsIgnored };
}

/**
 * Parses a CSV text string from an uploaded `.csv` file.
 * Thin wrapper that hands the raw text to `parseRosterCsvText`.
 */
async function parseRosterCsv(
  text: string,
  activeBody?: AttendanceBody,
): Promise<ParsedRoster> {
  return parseRosterCsvText(text, activeBody);
}

// ---------------------------------------------------------------------------
// .nfc-pack (JSON bundle, optional ed25519 signature)
// ---------------------------------------------------------------------------

/** The v1 `.nfc-pack` schema — only fields the import needs. */
type NfcPackMember = {
  first_name: string;
  last_name: string;
  grad_year: number;
  email?: string;
};

type NfcPackBody = {
  name: string;
  typeLabel: string;
};

type NfcPackV1 = {
  v: 1;
  body: NfcPackBody;
  members: NfcPackMember[];
  signature?: {
    alg: string;
    keyId: string;
    sig: string;
  };
};

/**
 * Parses a `.nfc-pack` JSON string into roster entries.
 *
 * Signature is optional for day-to-day use (the PIN gate is the security
 * boundary). The seam for verifying signed packs is present — the `signature`
 * field is extracted and passed to `verifyNfcPackSignature` — but verification
 * is a no-op until a key store is wired in.
 *
 * Body mismatch refuses the entire file, consistent with the design's
 * "prefer entire file for packs" rule.
 */
export function parseNfcPackJson(
  json: unknown,
  activeBody?: AttendanceBody,
): ParsedRoster {
  if (
    typeof json !== 'object' ||
    json === null ||
    (json as Record<string, unknown>)['v'] !== 1
  ) {
    throw new RosterFormatError(
      'That .nfc-pack file is not a valid v1 pack. Check the file and try again.',
    );
  }

  const pack = json as NfcPackV1;

  if (
    !pack.body ||
    typeof pack.body.name !== 'string' ||
    typeof pack.body.typeLabel !== 'string'
  ) {
    throw new RosterFormatError(
      'That .nfc-pack file is missing its "body" field.',
    );
  }

  if (!Array.isArray(pack.members)) {
    throw new RosterFormatError(
      'That .nfc-pack file is missing its "members" array.',
    );
  }

  // Body validation: refuse the entire file on mismatch.
  if (activeBody) {
    if (pack.body.name.toLowerCase() !== activeBody.name.toLowerCase()) {
      throw new RosterFormatError(
        `This pack is for "${pack.body.name}", but the active body is "${activeBody.name}". Switch to the right body before importing.`,
      );
    }
    if (pack.body.typeLabel.toLowerCase() !== activeBody.typeLabel.toLowerCase()) {
      throw new RosterFormatError(
        `This pack has body type "${pack.body.typeLabel}", but the active body type is "${activeBody.typeLabel}". Switch to the right body before importing.`,
      );
    }
  }

  // Signature seam: verify when a key store is available; accept unsigned packs
  // for the PIN-gated day-to-day path.
  if (pack.signature) {
    verifyNfcPackSignature(pack.signature, pack);
  }

  const entries: RosterEntry[] = [];
  const rejected: RejectedRosterRow[] = [];
  const cardsIgnored = 0;
  const seenEmails = new Set<string>();

  for (let i = 0; i < pack.members.length; i++) {
    const member = pack.members[i];
    const line = i + 1;

    if (
      typeof member.first_name !== 'string' ||
      typeof member.last_name !== 'string'
    ) {
      rejected.push({ row: line, reason: 'Missing a first or last name.' });
      continue;
    }

    const firstName = member.first_name.trim();
    const lastName = member.last_name.trim();

    if (!firstName || !lastName) {
      rejected.push({ row: line, reason: 'Missing a first or last name.' });
      continue;
    }

    if (typeof member.grad_year !== 'number' || !Number.isInteger(member.grad_year)) {
      rejected.push({
        row: line,
        reason: `Graduation year is not a valid integer.`,
      });
      continue;
    }

    const gradYear = member.grad_year;
    if (gradYear < MIN_GRAD_YEAR || gradYear > MAX_GRAD_YEAR) {
      rejected.push({
        row: line,
        reason: `Graduation year ${gradYear} is out of range.`,
      });
      continue;
    }

    let email = (member.email ?? '').toLowerCase().trim();
    if (!email) {
      try {
        email = deriveStudentEmail(firstName, lastName, gradYear);
      } catch {
        rejected.push({
          row: line,
          reason: 'No email, and one could not be derived from the name.',
        });
        continue;
      }
    }

    if (!isSchoolDomainEmail(email)) {
      rejected.push({
        row: line,
        reason: `The email is not a ${SCHOOL_EMAIL_DOMAIN} address.`,
      });
      continue;
    }

    if (seenEmails.has(email)) {
      rejected.push({
        row: line,
        reason: 'The email is already used by an earlier entry in this pack.',
      });
      continue;
    }

    seenEmails.add(email);
    entries.push({ firstName, lastName, gradYear, email });
  }

  return { entries, rejected, cardsIgnored };
}

/**
 * Signature verification seam for signed `.nfc-pack` files.
 *
 * Currently a no-op: unsigned packs are accepted at the PIN gate, and signed
 * pack distribution as Release assets is out of scope for Wave 1. The seam is
 * here so a later commit can wire in a key store without touching the parse
 * path.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function verifyNfcPackSignature(
  _signature: NfcPackV1['signature'],
  _pack: NfcPackV1,
): void {
  // No-op: accept unsigned and signed packs equally until a key store is wired in.
}

async function parseNfcPack(
  text: string,
  activeBody?: AttendanceBody,
): Promise<ParsedRoster> {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new RosterFormatError(
      'That .nfc-pack file is not valid JSON. Check the file and try again.',
    );
  }

  return parseNfcPackJson(json, activeBody);
}
