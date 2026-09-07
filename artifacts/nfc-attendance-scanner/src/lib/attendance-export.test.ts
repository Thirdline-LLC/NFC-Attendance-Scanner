import Dexie from 'dexie';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  listPersons,
  listTapRecords,
  type Person,
  type TapRecord,
} from '@/data/attendance-store';

import {
  buildAttendanceRows,
  COMMENCEMENT_DATES,
  commencementDate,
  currentSeniorGradYear,
  deriveGrade,
  formatMeetingDate,
  hasGraduated,
  UNKNOWN_CARD_NAME,
} from './attendance-export';

// Injected in place of the real config so these cases do not move when a real
// commencement date is added to COMMENCEMENT_DATES.
const COMMENCEMENTS = { 2027: '2027-05-29', 2028: '2028-06-03' };

// Noon UTC keeps every case comfortably inside the same Eastern calendar day,
// so the assertions do not depend on the daylight-saving offset.
const at = (isoDate: string) => `${isoDate}T16:00:00.000Z`;

const FALL_2026 = at('2026-09-15');
const SPRING_2027 = at('2027-03-10');
const FALL_2027 = at('2027-09-15');
const SPRING_2028 = at('2028-03-10');

describe('currentSeniorGradYear', () => {
  it('advances to the next calendar year once August arrives', () => {
    expect(currentSeniorGradYear(at('2026-08-01'))).toBe(2027);
    expect(currentSeniorGradYear(FALL_2026)).toBe(2027);
    expect(currentSeniorGradYear(at('2026-12-31'))).toBe(2027);
  });

  it('keeps the calendar year from January through July', () => {
    expect(currentSeniorGradYear(at('2027-01-05'))).toBe(2027);
    expect(currentSeniorGradYear(SPRING_2027)).toBe(2027);
    expect(currentSeniorGradYear(at('2027-07-31'))).toBe(2027);
  });

  it('treats the July/August boundary as the school-year rollover', () => {
    expect(currentSeniorGradYear(at('2026-07-31'))).toBe(2026);
    expect(currentSeniorGradYear(at('2026-08-01'))).toBe(2027);
  });
});

describe('deriveGrade', () => {
  it('puts the class of 2027 in grade 12 in fall 2026 (the reported bug)', () => {
    expect(deriveGrade(2027, FALL_2026)).toBe('12');
  });

  it('grades the 2026-2027 school year correctly in the fall', () => {
    expect(deriveGrade(2027, FALL_2026)).toBe('12');
    expect(deriveGrade(2028, FALL_2026)).toBe('11');
    expect(deriveGrade(2029, FALL_2026)).toBe('10');
    expect(deriveGrade(2030, FALL_2026)).toBe('9');
  });

  it('reports the same grades in the spring of that school year', () => {
    expect(deriveGrade(2027, SPRING_2027)).toBe('12');
    expect(deriveGrade(2028, SPRING_2027)).toBe('11');
    expect(deriveGrade(2029, SPRING_2027)).toBe('10');
    expect(deriveGrade(2030, SPRING_2027)).toBe('9');
  });

  it('advances every class by one grade in the next school year', () => {
    expect(deriveGrade(2028, FALL_2027)).toBe('12');
    expect(deriveGrade(2029, FALL_2027)).toBe('11');
    expect(deriveGrade(2030, FALL_2027)).toBe('10');

    expect(deriveGrade(2028, SPRING_2028)).toBe('12');
    expect(deriveGrade(2029, SPRING_2028)).toBe('11');
    expect(deriveGrade(2030, SPRING_2028)).toBe('10');
  });

  it('holds a grade steady across the calendar-year boundary', () => {
    expect(deriveGrade(2027, at('2026-12-31'))).toBe('12');
    expect(deriveGrade(2027, at('2027-01-01'))).toBe('12');
  });

  it('falls back to the August rollover for a class with no commencement date', () => {
    expect(deriveGrade(2027, at('2027-05-30'), {})).toBe('12');
    expect(deriveGrade(2027, at('2027-07-31'), {})).toBe('12');
    expect(deriveGrade(2027, at('2027-08-01'), {})).toBe('Alumni');
    expect(deriveGrade(2027, FALL_2027, {})).toBe('Alumni');
  });

  it('turns the senior class over at commencement once a date is on file', () => {
    expect(deriveGrade(2027, at('2027-05-28'), COMMENCEMENTS)).toBe('12');
    // Commencement day itself still counts as grade 12.
    expect(deriveGrade(2027, at('2027-05-29'), COMMENCEMENTS)).toBe('12');
    expect(deriveGrade(2027, at('2027-05-30'), COMMENCEMENTS)).toBe('Alumni');
    expect(deriveGrade(2027, at('2027-07-31'), COMMENCEMENTS)).toBe('Alumni');
    expect(deriveGrade(2027, FALL_2027, COMMENCEMENTS)).toBe('Alumni');
  });

  it('leaves the underclasses on the August ladder over that summer', () => {
    // The juniors do not become seniors early just because the seniors left.
    expect(deriveGrade(2028, at('2027-06-15'), COMMENCEMENTS)).toBe('11');
    expect(deriveGrade(2029, at('2027-06-15'), COMMENCEMENTS)).toBe('10');
    expect(deriveGrade(2028, at('2027-08-01'), COMMENCEMENTS)).toBe('12');
  });

  it('graduates each class on its own date', () => {
    expect(deriveGrade(2028, at('2028-06-02'), COMMENCEMENTS)).toBe('12');
    expect(deriveGrade(2028, at('2028-06-04'), COMMENCEMENTS)).toBe('Alumni');
  });

  it('ignores a malformed commencement entry rather than graduating early', () => {
    expect(deriveGrade(2027, at('2027-06-15'), { 2027: 'May 29 2027' })).toBe('12');
    // Month 00 passes a naive YYYY-MM-DD shape check and sorts below every real
    // date, which would otherwise graduate the class on day one of senior year.
    expect(deriveGrade(2027, FALL_2026, { 2027: '2027-00-29' })).toBe('12');
    expect(deriveGrade(2027, FALL_2026, { 2027: '2027-02-31' })).toBe('12');
  });

  it('holds a class in grade 12 when its ceremony runs past the August rollover', () => {
    const delayed = { 2027: '2027-08-15' };
    expect(deriveGrade(2027, at('2027-07-20'), delayed)).toBe('12');
    expect(deriveGrade(2027, at('2027-08-05'), delayed)).toBe('12');
    expect(deriveGrade(2027, at('2027-08-15'), delayed)).toBe('12');
    expect(deriveGrade(2027, at('2027-08-16'), delayed)).toBe('Alumni');
  });

  it('uses the Eastern calendar day to place the commencement boundary', () => {
    // 2027-05-29 23:30 EDT is 2027-05-30 03:30 UTC — still commencement day.
    expect(deriveGrade(2027, '2027-05-30T03:30:00.000Z', COMMENCEMENTS)).toBe('12');
    // 2027-05-30 00:30 EDT is 2027-05-30 04:30 UTC — the day after.
    expect(deriveGrade(2027, '2027-05-30T04:30:00.000Z', COMMENCEMENTS)).toBe('Alumni');
  });

  it('labels classes too far out as below grade 9', () => {
    expect(deriveGrade(2031, FALL_2026)).toBe('Below 9');
    expect(deriveGrade(2032, FALL_2026)).toBe('Below 9');
  });

  it('handles a scan late in the Eastern evening on the last day of July', () => {
    // 2026-07-31 23:30 EDT is 2026-08-01 03:30 UTC — still the old school year.
    expect(deriveGrade(2027, '2026-08-01T03:30:00.000Z')).toBe('11');
    // 2026-08-01 00:30 EDT is 2026-08-01 04:30 UTC — the new one.
    expect(deriveGrade(2027, '2026-08-01T04:30:00.000Z')).toBe('12');
  });
});

describe('formatMeetingDate', () => {
  it('formats in the export time zone', () => {
    expect(formatMeetingDate(FALL_2026)).toBe('2026-09-15');
  });
});

describe('commencementDate', () => {
  it('returns a recorded date and rejects a malformed one', () => {
    expect(commencementDate(2027, COMMENCEMENTS)).toBe('2027-05-29');
    expect(commencementDate(2030, COMMENCEMENTS)).toBeNull();
    expect(commencementDate(2027, { 2027: '5/29/2027' })).toBeNull();
  });

  it('rejects a date outside the class year or off the calendar', () => {
    expect(commencementDate(2027, { 2027: '2026-05-29' })).toBeNull();
    expect(commencementDate(2027, { 2027: '2027-00-29' })).toBeNull();
    expect(commencementDate(2027, { 2027: '2027-13-01' })).toBeNull();
    expect(commencementDate(2027, { 2027: '2027-02-31' })).toBeNull();
    expect(commencementDate(2027, { 2027: '2027-02-28' })).toBe('2027-02-28');
  });

  it('accepts every date actually configured in COMMENCEMENT_DATES', () => {
    // Vacuous while the map is empty; it becomes live coverage as real dates
    // are added, and the same checks run at runtime in commencementDate.
    for (const [gradYear, date] of Object.entries(COMMENCEMENT_DATES)) {
      expect(commencementDate(Number(gradYear))).toBe(date);
    }
  });
});

describe('hasGraduated', () => {
  it('is false for a class with no date on file', () => {
    expect(hasGraduated(2027, at('2027-06-15'), {})).toBe(false);
  });

  it('flips the day after commencement', () => {
    expect(hasGraduated(2027, at('2027-05-29'), COMMENCEMENTS)).toBe(false);
    expect(hasGraduated(2027, at('2027-05-30'), COMMENCEMENTS)).toBe(true);
  });
});

// What the reader types: exactly 14 hex characters (src/lib/scan-format.ts).
const UID_PATTERN = /[0-9A-F]{14}/i;
const STRANGER_UID = '0011223344AABB';
const SPRING_2026 = at('2026-03-10');

const jordan: Person = {
  id: 1,
  cardUid: '04A1B2C3D4E5F6',
  firstName: 'Jordan',
  lastName: 'Lee',
  gradYear: 2027,
  email: 'jlee27@stjohnschs.org',
  enrolledAt: '2026-09-01T10:00:00.000Z',
};

const priya: Person = {
  id: 2,
  cardUid: '04F6E5D4C3B2A1',
  firstName: 'Priya',
  lastName: 'Nair',
  gradYear: 2028,
  email: 'pnair28@stjohnschs.org',
  enrolledAt: '2026-09-02T10:00:00.000Z',
};

function tapAt(
  uid: string,
  scannedAt: string,
  overrides: Partial<TapRecord> = {},
): TapRecord {
  return {
    uid,
    scannedAt,
    personId: null,
    sessionId: 'session-a',
    counted: false,
    ...overrides,
  };
}

describe('buildAttendanceRows', () => {
  it("lays out one row per tap in the workbook's column shape", () => {
    const rows = buildAttendanceRows(
      [tapAt(jordan.cardUid, FALL_2026, { personId: 1, counted: true })],
      [jordan],
    );

    expect(rows).toEqual([
      {
        Timestamp: '2026-09-15 12:00:00',
        'Card UID': jordan.cardUid,
        'Meeting Date': '2026-09-15',
        Name: 'Jordan Lee',
        Email: 'jlee27@stjohnschs.org',
        Grade: '12',
      },
    ]);
  });

  it('names a card enrolled after its taps by matching the UID retroactively', () => {
    // personId is null because the card was unknown when it was tapped.
    const rows = buildAttendanceRows(
      [tapAt(priya.cardUid, FALL_2026)],
      [jordan, priya],
    );

    expect(rows[0]).toMatchObject({
      Name: 'Priya Nair',
      Email: 'pnair28@stjohnschs.org',
      Grade: '11',
    });
  });

  it('exports an unknown card with a readable placeholder and blank student columns', () => {
    const [row] = buildAttendanceRows([tapAt(STRANGER_UID, FALL_2026)], [jordan]);

    expect(row).toEqual({
      Timestamp: '2026-09-15 12:00:00',
      'Card UID': STRANGER_UID,
      'Meeting Date': '2026-09-15',
      Name: UNKNOWN_CARD_NAME,
      Email: '',
      Grade: '',
    });
    expect(row.Name).toBe('Unknown card');
  });

  it('keeps the UID out of the Name column for every kind of tap', () => {
    const rows = buildAttendanceRows(
      [
        tapAt(jordan.cardUid, FALL_2026, { personId: 1 }),
        tapAt(priya.cardUid, FALL_2026),
        tapAt(STRANGER_UID, FALL_2026),
        // A person id that no longer resolves, on a card nobody has enrolled.
        tapAt(STRANGER_UID, FALL_2026, { personId: 99 }),
      ],
      [jordan, priya],
    );

    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect(row.Name).not.toMatch(UID_PATTERN);
      expect(row.Name).not.toMatch(/undefined|null/);
      expect(row['Card UID']).toMatch(UID_PATTERN);
    }
    expect(rows[3].Name).toBe(UNKNOWN_CARD_NAME);
  });

  it('orders rows by scan time when the input is not', () => {
    const taps = [
      tapAt(priya.cardUid, at('2026-09-22'), { sessionId: 'session-b' }),
      tapAt(STRANGER_UID, at('2026-09-08')),
      tapAt(jordan.cardUid, at('2026-09-15'), { personId: 1 }),
    ];

    const rows = buildAttendanceRows(taps, [jordan, priya]);

    expect(rows.map((row) => row['Meeting Date'])).toEqual([
      '2026-09-08',
      '2026-09-15',
      '2026-09-22',
    ]);
    // The caller's list is left as it was handed over.
    expect(taps.map((tap) => tap.uid)).toEqual([
      priya.cardUid,
      STRANGER_UID,
      jordan.cardUid,
    ]);
  });

  it('derives the grade at the time of the tap, not at export time', () => {
    const rows = buildAttendanceRows(
      [
        tapAt(jordan.cardUid, SPRING_2026, { personId: 1 }),
        tapAt(jordan.cardUid, FALL_2026, { personId: 1 }),
      ],
      [jordan],
    );

    // One student, two school years: the class of 2027 is grade 11 in spring
    // 2026 and grade 12 that fall. A grade derived at export time could not
    // give two answers for the same person.
    expect(rows.map((row) => row.Grade)).toEqual(['11', '12']);
  });
});

describe('exporting migrated records', () => {
  const DATABASE_NAME = 'attendance-scanner-local';

  beforeEach(async () => {
    localStorage.clear();
    await Dexie.delete(DATABASE_NAME);
  });

  it('exports taps upgraded from a version-2 database with names, dates and period-correct grades', async () => {
    // The schema the store shipped before sessionId and counted existed.
    const legacyDatabase = new Dexie(DATABASE_NAME);
    legacyDatabase.version(1).stores({ scans: 'uid, scannedAt' });
    legacyDatabase.version(2).stores({
      scans: 'uid, scannedAt',
      persons: '++id, &cardUid, lastName, gradYear, enrolledAt',
      taps: '++id, uid, scannedAt, personId',
    });
    await legacyDatabase.open();
    const jordanId = (await legacyDatabase.table('persons').add({
      cardUid: jordan.cardUid,
      firstName: jordan.firstName,
      lastName: jordan.lastName,
      gradYear: jordan.gradYear,
      email: jordan.email,
      enrolledAt: jordan.enrolledAt,
    })) as number;
    await legacyDatabase.table('taps').bulkAdd([
      { uid: jordan.cardUid, scannedAt: SPRING_2026, personId: jordanId },
      { uid: STRANGER_UID, scannedAt: '2026-03-10T16:05:00.000Z', personId: null },
      // Tapped before the card was enrolled, so no person id was stored.
      { uid: jordan.cardUid, scannedAt: '2026-03-10T16:10:00.000Z', personId: null },
      { uid: jordan.cardUid, scannedAt: FALL_2026, personId: jordanId },
    ]);
    legacyDatabase.close();

    const taps = await listTapRecords();
    const persons = await listPersons();
    // Confirms the version-3 migration ran on these rows before export.
    expect(taps.map((tap) => [tap.sessionId, tap.counted])).toEqual([
      ['legacy', true],
      ['legacy', false],
      ['legacy', false],
      ['legacy', true],
    ]);

    const rows = buildAttendanceRows(taps, persons);

    expect(rows).toEqual([
      {
        Timestamp: '2026-03-10 12:00:00',
        'Card UID': jordan.cardUid,
        'Meeting Date': '2026-03-10',
        Name: 'Jordan Lee',
        Email: jordan.email,
        Grade: '11',
      },
      {
        Timestamp: '2026-03-10 12:05:00',
        'Card UID': STRANGER_UID,
        'Meeting Date': '2026-03-10',
        Name: UNKNOWN_CARD_NAME,
        Email: '',
        Grade: '',
      },
      {
        Timestamp: '2026-03-10 12:10:00',
        'Card UID': jordan.cardUid,
        'Meeting Date': '2026-03-10',
        Name: 'Jordan Lee',
        Email: jordan.email,
        Grade: '11',
      },
      {
        Timestamp: '2026-09-15 12:00:00',
        'Card UID': jordan.cardUid,
        'Meeting Date': '2026-09-15',
        Name: 'Jordan Lee',
        Email: jordan.email,
        Grade: '12',
      },
    ]);
    for (const row of rows) {
      expect(row.Name).not.toMatch(UID_PATTERN);
    }
  });
});
