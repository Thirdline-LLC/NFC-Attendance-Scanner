import { afterEach, describe, expect, it } from 'vitest';
import type { Person, TapRecord } from '@/data/attendance-store';
import {
  buildAttendanceRows,
  COMMENCEMENT_DATES,
  deriveGrade,
  formatExportTimestamp,
  formatMeetingDate,
} from '@/lib/attendance-export';
import {
  computeDashboardMetrics,
  computeSessionAttendance,
  schoolYearStart,
  selectYearToDateTaps,
} from '@/lib/attendance-metrics';
import { indexRoster } from '@/lib/tap-identity';

/**
 * The school year rolls over on August 1 and every date the app shows is
 * Eastern, which is UTC-4 for most of a school year and UTC-5 for the middle
 * of it. Everything below is written in UTC and asserted in Eastern, because
 * that is the conversion a wrong answer would come from: a meeting that shifts
 * a day, a senior who reads as a junior, or an evening's attendance filed
 * against the wrong year.
 */

const ROSA_CARD = '04A1B2C3D4E5F6';
const KAI_CARD = '04FFEEDDCCBBAA';

/** Class of 2027: a senior for the 2026-27 year, graduating that May. */
const rosa: Person = {
  id: 1,
  cardUid: ROSA_CARD,
  firstName: 'Rosa',
  lastName: 'Alvarez',
  gradYear: 2027,
  email: 'ralvarez27@stjohnschs.org',
  enrolledAt: '2026-08-20T13:00:00.000Z',
};
/** Class of 2029: two years behind her. */
const kai: Person = {
  id: 2,
  cardUid: KAI_CARD,
  firstName: 'Kai',
  lastName: 'Nakamura',
  gradYear: 2029,
  email: 'knakamura29@stjohnschs.org',
  enrolledAt: '2026-08-20T13:05:00.000Z',
};

function tap(
  sessionId: string,
  person: Person,
  scannedAt: string,
  counted = true,
): TapRecord {
  return {
    uid: person.cardUid,
    scannedAt,
    personId: person.id ?? null,
    sessionId,
    counted,
  };
}

describe('the July 31 / August 1 rollover', () => {
  // 2026-07-31 23:45 EDT and 2026-08-01 00:15 EDT: half an hour apart, on
  // opposite sides of the school year, and both stamped August 1 in UTC.
  const JULY_31_EVENING = '2026-08-01T03:45:00.000Z';
  const AUGUST_1_MORNING = '2026-08-01T04:15:00.000Z';

  it('splits two taps half an hour apart across two school years', () => {
    expect(formatMeetingDate(JULY_31_EVENING)).toBe('2026-07-31');
    expect(formatMeetingDate(AUGUST_1_MORNING)).toBe('2026-08-01');

    const taps = [
      tap('summer', rosa, JULY_31_EVENING),
      tap('fall', rosa, AUGUST_1_MORNING),
    ];
    const during = '2026-09-15T16:00:00.000Z';

    expect(schoolYearStart(during)).toBe('2026-08-01');
    expect(selectYearToDateTaps(taps, during)).toEqual([taps[1]]);
    // Looked at from the July side, the same two taps sit in the year before.
    expect(schoolYearStart(JULY_31_EVENING)).toBe('2025-08-01');
    expect(selectYearToDateTaps(taps, JULY_31_EVENING)).toEqual(taps);
  });

  it('moves the senior class up between those same two taps', () => {
    expect(deriveGrade(rosa.gradYear, JULY_31_EVENING)).toBe('11');
    expect(deriveGrade(rosa.gradYear, AUGUST_1_MORNING)).toBe('12');

    // The export derives each row's grade at that row's own timestamp, so one
    // workbook covering the rollover carries both.
    const rows = buildAttendanceRows(
      [tap('summer', rosa, JULY_31_EVENING), tap('fall', rosa, AUGUST_1_MORNING)],
      [rosa],
    );
    expect(rows.map((row) => [row['Meeting Date'], row.Grade])).toEqual([
      ['2026-07-31', '11'],
      ['2026-08-01', '12'],
    ]);
  });

  it('keeps only the August half of a session that straddles the rollover', () => {
    const straddling = [
      tap('rollover-night', rosa, JULY_31_EVENING),
      tap('rollover-night', kai, AUGUST_1_MORNING),
    ];
    const metrics = computeDashboardMetrics(
      straddling,
      [rosa, kai],
      '2026-09-15T16:00:00.000Z',
    );

    // Classified tap by tap, so the meeting reads as an August 1 session with
    // one student — Rosa's tap belongs to the year that just ended.
    expect(metrics.ytd.sessions).toHaveLength(1);
    expect(metrics.ytd.sessions[0]).toMatchObject({
      date: '2026-08-01',
      attendance: 1,
      tapCount: 1,
    });
    // The export, which is the system of record, still holds both.
    expect(buildAttendanceRows(straddling, [rosa, kai])).toHaveLength(2);
  });
});

describe('a session that runs past Eastern midnight', () => {
  // 2026-09-15 23:50 EDT to 2026-09-16 00:10 EDT.
  const BEFORE_MIDNIGHT = '2026-09-16T03:50:00.000Z';
  const AFTER_MIDNIGHT = '2026-09-16T04:10:00.000Z';

  it('dates the session by its first tap while the export dates each row', () => {
    const taps = [
      tap('late-night', rosa, BEFORE_MIDNIGHT),
      tap('late-night', kai, AFTER_MIDNIGHT),
    ];

    const [session] = computeSessionAttendance(taps, indexRoster([rosa, kai]));
    expect(session).toMatchObject({
      date: '2026-09-15',
      attendance: 2,
      tapCount: 2,
    });

    // Deliberately not the same answer: the dashboard reports one meeting, the
    // workbook reports the day each card was actually read. Both are true, and
    // one session spanning two dates is what a late-running meeting looks
    // like.
    expect(
      buildAttendanceRows(taps, [rosa, kai]).map((row) => row['Meeting Date']),
    ).toEqual(['2026-09-15', '2026-09-16']);
  });
});

describe('daylight saving', () => {
  it('does not shift the meeting date when the clocks go back', () => {
    // 2026-11-01: 02:00 EDT becomes 01:00 EST, so 01:30 happens twice.
    const firstOneThirty = '2026-11-01T05:30:00.000Z'; // 01:30 EDT
    const secondOneThirty = '2026-11-01T06:30:00.000Z'; // 01:30 EST

    expect(formatMeetingDate(firstOneThirty)).toBe('2026-11-01');
    expect(formatMeetingDate(secondOneThirty)).toBe('2026-11-01');
    // Eastern local time genuinely repeats that hour, so the two stamps read
    // alike. The rows stay in scan order regardless, because the export sorts
    // on the instant, not on the string it prints.
    expect(formatExportTimestamp(firstOneThirty)).toBe('2026-11-01 01:30:00');
    expect(formatExportTimestamp(secondOneThirty)).toBe('2026-11-01 01:30:00');

    const rows = buildAttendanceRows(
      [
        tap('fall-back', kai, secondOneThirty),
        tap('fall-back', rosa, firstOneThirty),
      ],
      [rosa, kai],
    );
    expect(rows.map((row) => row.Name)).toEqual(['Rosa Alvarez', 'Kai Nakamura']);
  });

  it('does not shift the meeting date across the spring-forward gap', () => {
    // 2027-03-14: 02:00 EST becomes 03:00 EDT, so 02:30 never happens.
    const beforeGap = '2027-03-14T06:59:00.000Z'; // 01:59 EST
    const afterGap = '2027-03-14T07:01:00.000Z'; // 03:01 EDT

    expect(formatMeetingDate(beforeGap)).toBe('2027-03-14');
    expect(formatMeetingDate(afterGap)).toBe('2027-03-14');
    expect(formatExportTimestamp(beforeGap)).toBe('2027-03-14 01:59:00');
    expect(formatExportTimestamp(afterGap)).toBe('2027-03-14 03:01:00');
  });

  it('applies the offset of the season, not one offset all year', () => {
    // 23:30 Eastern the evening before, in each half of the year: the winter
    // tap needs UTC-5 and the summer one UTC-4 to land on the same local day.
    expect(formatMeetingDate('2027-01-15T04:30:00.000Z')).toBe('2027-01-14');
    expect(formatMeetingDate('2027-07-15T03:30:00.000Z')).toBe('2027-07-14');
  });

  it('formats Eastern midnight as hour 00, not hour 24', () => {
    // `hour12: false` alone is read as an h24 cycle by some ICU builds, which
    // would write a midnight tap as `24:00:00` on the day before.
    expect(formatExportTimestamp('2027-01-15T05:00:00.000Z')).toBe(
      '2027-01-15 00:00:00',
    );
  });
});

describe('a class that graduates mid-year', () => {
  const COMMENCEMENT = '2027-05-28';

  afterEach(() => {
    delete COMMENCEMENT_DATES[2027];
  });

  /** As if the class's date had been added to the table in source. */
  function recordCommencement(): void {
    COMMENCEMENT_DATES[2027] = COMMENCEMENT;
  }

  it('turns the export over on the day after commencement, mid-school-year', () => {
    recordCommencement();

    const taps = [
      tap('fall', rosa, '2026-11-10T23:30:00.000Z'), // 18:30 EST
      tap('commencement-morning', rosa, '2027-05-28T13:00:00.000Z'), // 09:00 EDT
      tap('after', rosa, '2027-06-05T23:30:00.000Z'), // 19:30 EDT
    ];

    expect(buildAttendanceRows(taps, [rosa]).map((row) => row.Grade)).toEqual([
      '12',
      // Commencement day itself still counts as grade 12 — a graduation
      // breakfast is a senior event.
      '12',
      'Alumni',
    ]);
    // Kai is two years behind and stays on the August ladder over that summer.
    expect(deriveGrade(kai.gradYear, '2027-06-05T23:30:00.000Z')).toBe('10');
  });

  it('keeps a graduate’s attendance inside the school year it happened in', () => {
    recordCommencement();

    const taps = [
      tap('fall', rosa, '2026-11-10T23:30:00.000Z'),
      tap('after', rosa, '2027-06-05T23:30:00.000Z'),
    ];

    // Both taps are still this school year in June; both are last year once
    // August arrives.
    expect(selectYearToDateTaps(taps, '2027-06-10T16:00:00.000Z')).toEqual(taps);
    expect(selectYearToDateTaps(taps, '2027-08-02T16:00:00.000Z')).toEqual([]);
  });

  it('files a graduate under Alumni on the dashboard while the export keeps their grade', () => {
    recordCommencement();

    const taps = [tap('fall', rosa, '2026-11-10T23:30:00.000Z')];
    const metrics = computeDashboardMetrics(
      taps,
      [rosa, kai],
      '2027-06-10T16:00:00.000Z',
    );

    // The dashboard is as of now, so a student who has walked reads as
    // Alumni even for attendance they earned as a senior; the export is as of
    // the tap, so the same attendance reads as grade 12 there. Two questions,
    // two answers — and the grade-12 row going empty in June is graduation,
    // not a data problem.
    expect(metrics.gradeBreakdown).toEqual([
      { grade: '9', attended: 0, enrolled: 0 },
      { grade: '10', attended: 0, enrolled: 1 },
      { grade: '11', attended: 0, enrolled: 0 },
      { grade: '12', attended: 0, enrolled: 0 },
      { grade: 'Alumni', attended: 1, enrolled: 1 },
    ]);
    expect(buildAttendanceRows(taps, [rosa])[0].Grade).toBe('12');
  });
});
