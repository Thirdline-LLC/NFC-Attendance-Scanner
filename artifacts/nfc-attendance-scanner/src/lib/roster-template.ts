import * as XLSX from 'xlsx';

import type { AttendanceBody } from '@/data/attendance-store';
import { ROSTER_SHEET_NAME } from '@/lib/roster-workbook';
import { deliverWorkbook, type DeliveredExport } from '@/lib/workbook-delivery';

/**
 * A blank roster ready to fill in and re-import, in either format the
 * importer accepts. Two files, not one: a teacher opening the app on a
 * phone or a Chromebook without Excel needs the CSV, and the xlsx carries an
 * `Instructions` sheet the CSV has no room for.
 *
 * Both ship one clearly-fake example row and, when a body is active, the
 * `Body Name` / `Body Type` columns pre-filled from it — so a file exported
 * straight from this screen can never be refused for a body mismatch, only
 * for the example row being left in.
 */

export const INSTRUCTIONS_SHEET_NAME = 'Instructions';

/**
 * The xlsx template's columns: a subset of `ROSTER_COLUMNS`. `Grade` is
 * derived from the graduation year at export time and `Card (last 4)` is
 * never set by an import — cards only ever bind by tapping — so shipping
 * either in a template a teacher fills by hand would invite values the
 * importer silently discards.
 */
const TEMPLATE_COLUMNS = [
  'First Name',
  'Last Name',
  'Graduation Year',
  'Email',
  'Body Name',
  'Body Type',
] as const;

/** The CSV template's columns — the snake_case headers the CSV importer reads. */
const CSV_TEMPLATE_COLUMNS = [
  'first_name',
  'last_name',
  'grad_year',
  'email',
  'body_name',
  'body_type',
] as const;

type TemplateRow = Record<(typeof TEMPLATE_COLUMNS)[number], string>;

/**
 * One row of clearly-example data. The email is an `example.com` address on
 * purpose: it is not a school address, so an import left with this row still
 * in it is refused on that row rather than silently creating a fake student.
 */
function exampleRow(body?: AttendanceBody | null): TemplateRow {
  return {
    'First Name': 'Avery',
    'Last Name': 'Chen',
    'Graduation Year': '2028',
    Email: 'avery.chen@example.com',
    'Body Name': body?.name ?? '',
    'Body Type': body?.typeLabel ?? '',
  };
}

/**
 * The active body's name, folded into a filename-safe slug, or a generic
 * fallback when there is no active body (or its name is punctuation only).
 */
function bodySlug(body?: AttendanceBody | null): string {
  const slug = (body?.name ?? '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'roster';
}

function templateFilename(body: AttendanceBody | null | undefined, extension: string): string {
  return `tapin-roster-template-${bodySlug(body)}.${extension}`;
}

const INSTRUCTIONS_LINES = [
  'How to fill in this roster',
  '',
  'Required columns: First Name, Last Name, Graduation Year.',
  'Optional columns:',
  '  Email — used to match a student on re-import. Leave it blank and the',
  '    app derives one from the name and graduation year.',
  '  Body Name / Body Type — must match the body you are importing into, or',
  '    the whole file is refused. Leave both blank to skip the check.',
  '',
  'Accepted header spellings (not case sensitive):',
  '  First Name: First Name, First, first_name',
  '  Last Name: Last Name, Last, Surname, last_name',
  '  Graduation Year: Graduation Year, Grad Year, Class of, grad_year',
  '  Email: Email, Email Address, email_address',
  '  Body Name: Body Name, body_name',
  '  Body Type: Body Type, body_type',
  '',
  'Delete the example row (Avery Chen) before importing — its email is not',
  'a real address, so it will be refused on its own if you leave it in.',
  '',
  'There is no card column. Cards are never set by import; each one binds',
  'the first time it is tapped at the scanner.',
  '',
  'Re-importing is always safe: it adds new students and updates matches by',
  'email, but it never deletes a student who is missing from the file.',
];

/** A finished template workbook and the name it should be saved under. */
export type RosterTemplateWorkbook = { filename: string; workbook: XLSX.WorkBook };

/**
 * The xlsx template: a `Roster` sheet with one example row, and an
 * `Instructions` sheet beside it. The importer selects its input by sheet
 * name (`ROSTER_SHEET_NAME`), so the extra sheet is present to be read by a
 * person and is never looked at by `parseRosterWorkbook`.
 */
export function buildRosterTemplateWorkbook(
  body?: AttendanceBody | null,
): RosterTemplateWorkbook {
  const rosterSheet = XLSX.utils.json_to_sheet([exampleRow(body)], {
    header: [...TEMPLATE_COLUMNS],
  });
  const instructionsSheet = XLSX.utils.aoa_to_sheet(
    INSTRUCTIONS_LINES.map((line) => [line]),
  );

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, rosterSheet, ROSTER_SHEET_NAME);
  XLSX.utils.book_append_sheet(workbook, instructionsSheet, INSTRUCTIONS_SHEET_NAME);

  return { filename: templateFilename(body, 'xlsx'), workbook };
}

/**
 * The CSV template as a one-sheet workbook: snake_case headers matching
 * `templates/roster-template.csv` and the CSV importer, with the same
 * example row and body pre-fill as the xlsx template. A workbook, not text
 * directly, so both `buildRosterTemplateCsv` (asserted on as text) and
 * `deliverRosterTemplateCsv` (delivered as bytes) render from the one sheet
 * rather than one reparsing the other's output.
 */
function csvTemplateWorkbook(body?: AttendanceBody | null): XLSX.WorkBook {
  const row = exampleRow(body);
  const csvRow = {
    first_name: row['First Name'],
    last_name: row['Last Name'],
    grad_year: row['Graduation Year'],
    email: row.Email,
    body_name: row['Body Name'],
    body_type: row['Body Type'],
  };
  const sheet = XLSX.utils.json_to_sheet([csvRow], {
    header: [...CSV_TEMPLATE_COLUMNS],
  });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'roster');
  return workbook;
}

/** A finished CSV template's text and the name it should be saved under. */
export type RosterTemplateCsv = { filename: string; text: string };

/** The CSV template rendered to text, for a caller that wants the bytes directly. */
export function buildRosterTemplateCsv(body?: AttendanceBody | null): RosterTemplateCsv {
  const workbook = csvTemplateWorkbook(body);
  return {
    filename: templateFilename(body, 'csv'),
    text: XLSX.utils.sheet_to_csv(workbook.Sheets[workbook.SheetNames[0]]),
  };
}

/** Builds the xlsx template and hands it to whichever delivery route the platform has. */
export async function deliverRosterTemplateWorkbook(
  body?: AttendanceBody | null,
): Promise<DeliveredExport> {
  return deliverWorkbook(buildRosterTemplateWorkbook(body));
}

/**
 * Builds the CSV template and hands it to whichever delivery route the
 * platform has. Delivered as a one-sheet `'csv'`-format workbook so it goes
 * through the same three routes `deliverWorkbook` already tests, rather than
 * a separate text-delivery path.
 */
export async function deliverRosterTemplateCsv(
  body?: AttendanceBody | null,
): Promise<DeliveredExport> {
  return deliverWorkbook({
    filename: templateFilename(body, 'csv'),
    workbook: csvTemplateWorkbook(body),
    format: 'csv',
  });
}
