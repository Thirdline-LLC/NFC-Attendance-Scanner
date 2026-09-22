import Dexie from 'dexie';
import * as XLSX from 'xlsx';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  addPerson,
  type BoundPerson,
  type Person,
} from '@/data/attendance-store';
import {
  buildRosterRows,
  buildRosterWorkbook,
  parseRosterWorkbook,
  ROSTER_COLUMNS,
  ROSTER_SHEET_NAME,
  RosterFormatError,
  type RosterSheetRow,
} from './roster-workbook';

const DATABASE_NAME = 'attendance-scanner-local';

// Synthetic throughout. The names are invented and the card UIDs are visibly
// fake, so nothing here is a real student and nothing here is a real card.
const jordan: BoundPerson = {
  id: 1,
  cardUid: '04A1B2C3D4E5F6',
  firstName: 'Jordan',
  lastName: 'Lee',
  gradYear: 2027,
  email: 'jlee27@stjohnschs.org',
  enrolledAt: '2026-09-01T12:00:00.000Z',
};

const priya: Person = {
  id: 2,
  firstName: 'Priya',
  lastName: 'Nair',
  gradYear: 2028,
  email: 'pnair28@stjohnschs.org',
  enrolledAt: '2026-09-01T12:01:00.000Z',
};

/** A sheet from rows keyed by header, which is what a teacher's file is. */
function workbookOf(
  rows: Partial<RosterSheetRow>[],
  sheetName = ROSTER_SHEET_NAME,
): XLSX.WorkBook {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(rows, { header: ROSTER_COLUMNS }),
    sheetName,
  );
  return workbook;
}

function rowFor(overrides: Partial<RosterSheetRow>): Partial<RosterSheetRow> {
  return {
    'First Name': 'Alex',
    'Last Name': 'Rivera',
    'Graduation Year': '2029',
    Email: 'arivera29@stjohnschs.org',
    Grade: '9',
    'Card (last 4)': '',
    ...overrides,
  };
}

describe('buildRosterRows', () => {
  it('writes a card as its masked tail and leaves an unbound student blank', () => {
    const [lee, nair] = buildRosterRows([priya, jordan]);

    expect(lee['Card (last 4)']).toBe('••••E5F6');
    expect(nair['Card (last 4)']).toBe('');
    // Sorted by last name, so Lee precedes Nair whatever order they arrive in.
    expect(lee['Last Name']).toBe('Lee');
    expect(nair['Last Name']).toBe('Nair');
  });

  it('never writes a full card UID into the sheet', () => {
    const serialised = JSON.stringify(buildRosterRows([jordan, priya]));

    expect(serialised).not.toContain(jordan.cardUid);
    expect(serialised).not.toMatch(/[0-9A-F]{14}/);
  });
});

describe('buildRosterWorkbook', () => {
  it('names the sheet Roster and stamps the filename with the day', () => {
    const { filename, workbook } = buildRosterWorkbook(
      [jordan],
      new Date('2026-09-15T21:00:00.000Z'),
    );

    expect(workbook.SheetNames).toEqual([ROSTER_SHEET_NAME]);
    expect(filename).toBe('roster-2026-09-15-20260915T210000Z.xlsx');
  });

  it('round-trips its own export back into importable entries', () => {
    const { workbook } = buildRosterWorkbook([jordan, priya]);

    const parsed = parseRosterWorkbook(workbook);

    expect(parsed.rejected).toEqual([]);
    expect(parsed.entries).toEqual([
      {
        firstName: 'Jordan',
        lastName: 'Lee',
        gradYear: 2027,
        email: 'jlee27@stjohnschs.org',
      },
      {
        firstName: 'Priya',
        lastName: 'Nair',
        gradYear: 2028,
        email: 'pnair28@stjohnschs.org',
      },
    ]);
    // The bound student's card came back as a masked tail, which the parser
    // counts and drops: a file can report a card but can never set one.
    expect(parsed.cardsIgnored).toBe(1);
  });
});

describe('parseRosterWorkbook', () => {
  beforeEach(async () => {
    await Dexie.delete(DATABASE_NAME);
  });

  it('reads pre-enrollment rows with the card column empty', () => {
    const parsed = parseRosterWorkbook(
      workbookOf([
        rowFor({}),
        rowFor({
          'First Name': 'Sam',
          'Last Name': 'Okafor',
          'Graduation Year': '2030',
          Email: 'sokafor30@stjohnschs.org',
        }),
      ]),
    );

    expect(parsed.entries).toHaveLength(2);
    expect(parsed.cardsIgnored).toBe(0);
    expect(parsed.rejected).toEqual([]);
    // Nothing in a parsed entry can carry a card: the type has no field for it.
    expect(Object.keys(parsed.entries[0]).sort()).toEqual([
      'email',
      'firstName',
      'gradYear',
      'lastName',
    ]);
  });

  it('accepts the headers a teacher is likely to retype', () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet([
        {
          first: 'Alex',
          SURNAME: 'Rivera',
          'Class of': '2029',
          'Email Address': 'arivera29@stjohnschs.org',
        },
      ]),
      'Sheet1',
    );

    expect(parseRosterWorkbook(workbook).entries).toEqual([
      {
        firstName: 'Alex',
        lastName: 'Rivera',
        gradYear: 2029,
        email: 'arivera29@stjohnschs.org',
      },
    ]);
  });

  it('derives the address when the email column is left blank', () => {
    const parsed = parseRosterWorkbook(workbookOf([rowFor({ Email: '' })]));

    expect(parsed.entries[0].email).toBe('arivera29@stjohnschs.org');
  });

  it('refuses a malformed row by line number, and keeps the rest', () => {
    const parsed = parseRosterWorkbook(
      workbookOf([
        rowFor({}),
        rowFor({ 'First Name': '', Email: 'bnoname29@stjohnschs.org' }),
        rowFor({
          'Graduation Year': 'next year',
          Email: 'cbadyear29@stjohnschs.org',
        }),
        rowFor({ Email: 'someone@example.com' }),
      ]),
    );

    expect(parsed.entries).toHaveLength(1);
    expect(parsed.rejected).toEqual([
      { row: 3, reason: 'Missing a first or last name.' },
      {
        row: 4,
        reason: 'Graduation year "next year" is not a four-digit year.',
      },
      { row: 5, reason: 'The email is not a stjohnschs.org address.' },
    ]);
  });

  it('refuses the second row claiming an address the file already used', () => {
    const parsed = parseRosterWorkbook(
      workbookOf([rowFor({}), rowFor({ 'First Name': 'Alexis' })]),
    );

    expect(parsed.entries).toHaveLength(1);
    expect(parsed.rejected).toEqual([
      {
        row: 3,
        reason: 'The email is already used by an earlier row in this file.',
      },
    ]);
  });

  it('names no student in any reason it gives', () => {
    const parsed = parseRosterWorkbook(
      workbookOf([rowFor({ Email: 'someone@example.com' })]),
    );

    const reasons = parsed.rejected.map((row) => row.reason).join(' ');
    expect(reasons).not.toContain('someone@example.com');
    expect(reasons).not.toContain('Alex');
    expect(reasons).not.toContain('Rivera');
  });

  it('skips the blank lines a spreadsheet leaves behind', () => {
    const parsed = parseRosterWorkbook(
      workbookOf([rowFor({}), { 'First Name': '', 'Last Name': '' }]),
    );

    expect(parsed.entries).toHaveLength(1);
    expect(parsed.rejected).toEqual([]);
  });

  it('refuses a file that is not a roster at all', () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet([{ Timestamp: 'x', 'Card (last 4)': '••••E5F6' }]),
      'Attendance',
    );

    expect(() => parseRosterWorkbook(workbook)).toThrow(RosterFormatError);
    // The attendance export is the file most likely to be picked by mistake,
    // and it must not be read as a roster of one nameless student.
    expect(() => parseRosterWorkbook(workbook)).toThrow(/First Name/);
  });
});

describe('the roster workbook and the store together', () => {
  beforeEach(async () => {
    await Dexie.delete(DATABASE_NAME);
  });

  it('exports a student the import created, with the card column empty', async () => {
    await addPerson({
      firstName: 'Alex',
      lastName: 'Rivera',
      gradYear: 2029,
      email: 'arivera29@stjohnschs.org',
      enrolledAt: '2026-09-01T12:00:00.000Z',
    });

    const [row] = buildRosterRows([
      {
        firstName: 'Alex',
        lastName: 'Rivera',
        gradYear: 2029,
        email: 'arivera29@stjohnschs.org',
        enrolledAt: '2026-09-01T12:00:00.000Z',
      },
    ]);

    expect(row['Card (last 4)']).toBe('');
    expect(parseRosterWorkbook(workbookOf([row])).entries).toHaveLength(1);
  });
});
