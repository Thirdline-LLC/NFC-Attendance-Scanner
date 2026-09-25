import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';

import type { ActivityEntry, Person, TapRecord } from '@/data/attendance-store';
import { parseSaveRequest, RANGE_EXPORT_FILENAME } from '../../electron/validation';
import { computePeriodBreakdown, computeRangeMetrics } from './attendance-metrics';
import { resolveDateRange, type DateRange } from './date-range';
import {
  NO_PERCENT,
  buildRangeExportFilename,
  buildRangeWorkbook,
  oldestTapDay,
  retentionCaveat,
} from './range-export';

// Noon in New York on Thursday, September 24, 2026.
const NOW = new Date('2026-09-24T16:00:00.000Z');
const at = (day: string, time = '16:00:00') => `${day}T${time}.000Z`;

const SEPTEMBER: DateRange = { preset: 'custom', from: '2026-09-01', to: '2026-09-24' };

function range(request: Parameters<typeof resolveDateRange>[0]): DateRange {
  const result = resolveDateRange(request, NOW.toISOString());
  if (!result.ok) throw new Error(result.error);
  return result.range;
}

function student(id: number, bodyId: number, first: string, last: string, enrolledOn: string): Person {
  return {
    id,
    bodyId,
    cardUid: `04${String(id).padStart(12, '0')}`,
    firstName: first,
    lastName: last,
    gradYear: 2028,
    email: `${first.toLowerCase()}.${last.toLowerCase()}@example.com`,
    enrolledAt: at(enrolledOn, '13:00:00'),
  };
}

let nextTapId = 1;
function tapBy(who: Person, sessionId: string, day: string, time = '16:00:00', credited = true): TapRecord {
  return {
    id: nextTapId++,
    uid: who.cardUid as string,
    scannedAt: at(day, time),
    // A retroactive tap: the card was read before the student was enrolled.
    personId: credited ? (who.id as number) : null,
    sessionId,
    counted: credited,
    bodyId: who.bodyId,
  };
}

/*
 * Period 3 (body 12), four students:
 * - Avery and Blake, enrolled in August.
 * - Casey, added mid-range on Sep 10.
 * - Devon, enrolled Sep 20 — but Devon's card was tapped on Sep 15, before
 *   the enrollment, and is credited retroactively.
 * Four meetings: Sep 1, Sep 8, Sep 15, Sep 22 (plus one last year).
 */
const avery = student(1, 12, 'Avery', 'Adams', '2026-08-20');
const blake = student(2, 12, 'Blake', 'Brown', '2026-08-20');
const casey = student(3, 12, 'Casey', 'Clark', '2026-09-10');
const devon = student(4, 12, 'Devon', 'Diaz', '2026-09-20');
const PERIOD_3 = [devon, casey, blake, avery];
const PERIOD_3_TAPS = [
  tapBy(avery, 'old', '2026-03-02'),
  tapBy(avery, 's1', '2026-09-01', '12:05:00'),
  tapBy(blake, 's1', '2026-09-01', '12:07:00'),
  tapBy(avery, 's2', '2026-09-08'),
  tapBy(avery, 's2', '2026-09-08', '16:01:00'), // repeat tap, one person
  tapBy(avery, 's3', '2026-09-15'),
  tapBy(casey, 's3', '2026-09-15'),
  tapBy(devon, 's3', '2026-09-15', '16:03:00', false),
  tapBy(blake, 's4', '2026-09-22'),
  tapBy(casey, 's4', '2026-09-22'),
  tapBy(devon, 's4', '2026-09-22'),
];

describe('computeRangeMetrics', () => {
  const metrics = computeRangeMetrics(PERIOD_3_TAPS, PERIOD_3, SEPTEMBER);

  it('counts meetings held in the range, each with the roster as of that day', () => {
    expect(metrics.meetings.map(({ date, present, rosterSize }) => ({ date, present, rosterSize }))).toEqual([
      { date: '2026-09-01', present: 2, rosterSize: 2 },
      { date: '2026-09-08', present: 1, rosterSize: 2 },
      // Casey joined Sep 10. Devon tapped but joined Sep 20, so is in neither
      // the present count nor the roster.
      { date: '2026-09-15', present: 2, rosterSize: 3 },
      { date: '2026-09-22', present: 3, rosterSize: 4 },
    ]);
    expect(metrics.meetingsHeld).toBe(4);
  });

  it('averages present ÷ roster-as-of-meeting, not the headcount over today’s roster', () => {
    // (2/2 + 1/2 + 2/3 + 3/4) / 4 = 72.92%. The old formula — mean present
    // (2.25) over today's roster (4) — would say 56.25%.
    expect(metrics.averageAttendancePercent).toBeCloseTo(72.9167, 3);
  });

  it('clips each person’s meetings held to the day they joined', () => {
    const byName = Object.fromEntries(
      metrics.people.map((row) => [row.person.firstName, [row.attended, row.held, row.percent]]),
    );
    expect(byName).toEqual({
      Avery: [3, 4, 75],
      Blake: [2, 4, 50],
      Casey: [2, 2, 100],
      Devon: [1, 1, 100],
    });
    // Sorted by last name for the sheet.
    expect(metrics.people.map((row) => row.person.lastName)).toEqual(['Adams', 'Brown', 'Clark', 'Diaz']);
  });

  it('keeps retroactive check-ins as facts: first check-in and unique present', () => {
    const devonRow = metrics.people.find((row) => row.person.id === devon.id);
    expect(devonRow?.firstCheckIn).toBe(at('2026-09-15', '16:03:00'));
    expect(devonRow?.lastCheckIn).toBe(at('2026-09-22'));
    expect(metrics.uniquePresent).toBe(4);
  });

  it('has no average when there are no meetings, or no roster at any of them', () => {
    const none = computeRangeMetrics(PERIOD_3_TAPS, PERIOD_3, { preset: 'day', from: '2026-09-02', to: '2026-09-02' });
    expect(none.meetingsHeld).toBe(0);
    expect(none.averageAttendancePercent).toBeNull();
    expect(none.people.every((row) => row.percent === null && row.held === 0)).toBe(true);

    const noRoster = computeRangeMetrics(PERIOD_3_TAPS, [], SEPTEMBER);
    expect(noRoster.meetingsHeld).toBe(4);
    expect(noRoster.averageAttendancePercent).toBeNull();
  });

  it('leaves out a meeting held before anyone was on the roster', () => {
    const early = computeRangeMetrics(
      [tapBy(casey, 'e1', '2026-09-02', '16:00:00', false), ...PERIOD_3_TAPS.filter((t) => t.sessionId === 's4')],
      [casey],
      SEPTEMBER,
    );
    expect(early.meetings.map((m) => m.rosterSize)).toEqual([0, 1]);
    expect(early.averageAttendancePercent).toBe(100);
  });
});

describe('dashboard "By period" agrees with the export for this school year', () => {
  // English 11 (10) › Period 1 (11) and Period 3 (12).
  const created = at('2026-08-01');
  const bodies = [
    { id: 10, name: 'English 11', typeLabel: 'class', createdAt: created, parentId: null },
    { id: 11, name: 'Period 1', typeLabel: 'period', createdAt: created, parentId: 10, sortOrder: 0 },
    { id: 12, name: 'Period 3', typeLabel: 'period', createdAt: created, parentId: 10, sortOrder: 1 },
  ];
  const ellis = student(5, 11, 'Ellis', 'Evans', '2026-08-20');
  const frankie = student(6, 11, 'Frankie', 'Fox', '2026-09-03');
  const PERIOD_1 = [ellis, frankie];
  const PERIOD_1_TAPS = [tapBy(ellis, 'p1a', '2026-09-02'), tapBy(ellis, 'p1b', '2026-09-09'), tapBy(frankie, 'p1b', '2026-09-09')];

  const rows = computePeriodBreakdown(
    10,
    bodies,
    [...PERIOD_1_TAPS, ...PERIOD_3_TAPS],
    [...PERIOD_1, ...PERIOD_3],
    NOW.toISOString(),
  );

  function summaryHeader(persons: Person[], taps: TapRecord[], name: string): Record<string, unknown> {
    const { workbook } = buildRangeWorkbook({
      taps,
      persons,
      bodyPath: ['English 11', name],
      range: range({ preset: 'school-year' }),
      now: NOW,
    });
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets.Summary, { header: 1 });
    return Object.fromEntries(aoa.slice(1, 8).map((row) => [row[0], row[1]]));
  }

  it('matches meetings held, unique present and average % row for row', () => {
    const exported = [
      summaryHeader(PERIOD_1, PERIOD_1_TAPS, 'Period 1'),
      summaryHeader(PERIOD_3, PERIOD_3_TAPS, 'Period 3'),
    ];
    rows.forEach((row, i) => {
      expect(exported[i]['Meetings held']).toBe(row.meetingsHeld);
      expect(exported[i]['Unique present']).toBe(`${row.uniquePresent} of ${row.enrolled} enrolled`);
      expect(exported[i]['Average attendance %']).toBe(
        Math.round((row.averageAttendancePercent as number) * 10) / 10,
      );
    });
    // And the numbers are the new definition, not the old one: Period 3 is
    // 72.9%, Period 1 is (1/1 + 2/2) / 2 = 100% although Frankie missed Sep 2.
    expect(rows.map((row) => row.averageAttendancePercent)).toEqual([100, expect.closeTo(72.9167, 3)]);
    expect(rows.map((row) => row.meetingsHeld)).toEqual([2, 4]);
  });
});

describe('buildRangeWorkbook', () => {
  function sheet(workbook: XLSX.WorkBook, name: string): unknown[][] {
    return XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], { header: 1 });
  }

  const built = buildRangeWorkbook({
    taps: PERIOD_3_TAPS,
    persons: PERIOD_3,
    body: { id: 12, name: 'Period 3', typeLabel: 'period', createdAt: at('2026-08-01') },
    bodyPath: ['English 11', 'Period 3'],
    range: SEPTEMBER,
    now: NOW,
    activity: [{ at: at('2026-09-20'), kind: 'pin-set' }],
  });

  it('writes Summary, Attendance and By meeting — and no Activity for a slice', () => {
    expect(built.workbook.SheetNames).toEqual(['Summary', 'Attendance', 'By meeting']);
    expect(built.filename).toBe('English 11 - Period 3 - 2026-09-01 to 2026-09-24.xlsx');
    expect(built.tapCount).toBe(10);
    expect(built.sessionCount).toBe(4);
  });

  it('heads the Summary with body path, range and exported-at, then one row per person', () => {
    const rows = sheet(built.workbook, 'Summary');
    expect(rows[0]).toEqual(['Attendance summary']);
    expect(rows[1]).toEqual(['Body', 'English 11 › Period 3']);
    expect(rows[2]).toEqual(['Range', '2026-09-01 to 2026-09-24']);
    expect(rows[3]).toEqual(['Exported at', '2026-09-24 12:00:00 (America/New_York)']);
    expect(rows[4]).toEqual(['Meetings held', 4]);
    expect(rows[5]).toEqual(['Average attendance %', 72.9]);
    expect(rows[6]).toEqual(['Unique present', '4 of 4 enrolled']);
    // The range starts after the oldest tap (March), so there is no caveat.
    expect(rows.find((row) => row[0] === 'Note')).toBeUndefined();

    const headerAt = rows.findIndex((row) => row[0] === 'Name');
    expect(rows[headerAt]).toEqual([
      'Name',
      'Email',
      'Grade',
      'Meetings attended',
      'Meetings held',
      'Attendance %',
      'First check-in',
      'Last check-in',
    ]);
    expect(rows.slice(headerAt + 1)).toEqual([
      ['Avery Adams', 'avery.adams@example.com', '11', 3, 4, 75, '2026-09-01 08:05:00', '2026-09-15 12:00:00'],
      ['Blake Brown', 'blake.brown@example.com', '11', 2, 4, 50, '2026-09-01 08:07:00', '2026-09-22 12:00:00'],
      ['Casey Clark', 'casey.clark@example.com', '11', 2, 2, 100, '2026-09-15 12:00:00', '2026-09-22 12:00:00'],
      ['Devon Diaz', 'devon.diaz@example.com', '11', 1, 1, 100, '2026-09-15 12:03:00', '2026-09-22 12:00:00'],
    ]);
  });

  it('filters Attendance to the range, card still masked', () => {
    const rows = sheet(built.workbook, 'Attendance');
    expect(rows[0]).toEqual(['Timestamp', 'Card (last 4)', 'Meeting Date', 'Name', 'Email', 'Grade', 'Body Name', 'Body Type']);
    expect(rows).toHaveLength(11);
    expect(rows.slice(1).every((row) => String(row[2]) >= '2026-09-01')).toBe(true);
    expect(rows[1][1]).toBe('••••0001');
    expect(rows[1].slice(6)).toEqual(['Period 3', 'period']);
    expect(JSON.stringify(rows)).not.toContain(avery.cardUid);
  });

  it('writes one By meeting row per session with its roster size that day', () => {
    expect(sheet(built.workbook, 'By meeting')).toEqual([
      ['Date', 'Start time', 'Present', 'Roster size'],
      ['2026-09-01', '08:05', 2, 2],
      ['2026-09-08', '12:00', 1, 2],
      ['2026-09-15', '12:00', 2, 3],
      ['2026-09-22', '12:00', 3, 4],
    ]);
  });

  it('adds the Activity sheet and the retention note for All time', () => {
    const activity: ActivityEntry[] = [{ at: at('2026-09-20'), kind: 'pin-set' }];
    const all = buildRangeWorkbook({
      taps: PERIOD_3_TAPS,
      persons: PERIOD_3,
      bodyPath: ['English 11', 'Period 3'],
      range: range({ preset: 'all-time' }),
      now: NOW,
      activity,
    });
    expect(all.workbook.SheetNames).toEqual(['Summary', 'Attendance', 'By meeting', 'Activity']);
    expect(all.filename).toBe('English 11 - Period 3 - All time.xlsx');
    expect(all.tapCount).toBe(11);
    const summary = sheet(all.workbook, 'Summary');
    expect(summary[2]).toEqual(['Range', 'All time']);
    expect(String(summary.find((row) => row[0] === 'Note')?.[1])).toContain('Mar 2, 2026');
    expect(sheet(all.workbook, 'Activity')[1][1]).toBe('Teacher PIN set');
  });

  it('notes retention when the range starts before the oldest tap held', () => {
    const recent = PERIOD_3_TAPS.filter((t) => t.sessionId !== 'old');
    const year = buildRangeWorkbook({
      taps: recent,
      persons: PERIOD_3,
      bodyPath: ['English 11', 'Period 3'],
      range: range({ preset: 'past-year' }),
      now: NOW,
    });
    const note = sheet(year.workbook, 'Summary').find((row) => row[0] === 'Note');
    expect(note?.[1]).toContain('The oldest tap this device still holds for this body is from Sep 1, 2026.');
    expect(sheet(year.workbook, 'Summary')[2]).toEqual(['Range', 'Past year: 2025-09-25 to 2026-09-24']);
  });

  it('says so when there are no meetings in range, or nobody enrolled', () => {
    const empty = buildRangeWorkbook({
      taps: PERIOD_3_TAPS,
      persons: PERIOD_3,
      bodyPath: ['Period 3'],
      range: range({ preset: 'day', day: '2026-09-02' }),
      now: NOW,
    });
    const rows = sheet(empty.workbook, 'Summary');
    expect(rows[5]).toEqual(['Average attendance %', NO_PERCENT]);
    expect(rows[rows.length - 1]).toEqual(['No meetings in this range.']);
    expect(rows.find((row) => row[0] === 'Avery Adams')?.[5]).toBe(NO_PERCENT);
    expect(sheet(empty.workbook, 'By meeting')).toEqual([['Date', 'Start time', 'Present', 'Roster size']]);

    const nobody = buildRangeWorkbook({ taps: [], persons: [], bodyPath: ['Chess'], range: SEPTEMBER, now: NOW });
    const nobodyRows = sheet(nobody.workbook, 'Summary');
    expect(nobodyRows[nobodyRows.length - 1]).toEqual(['No students are enrolled on this body.']);
    expect(String(nobodyRows.find((row) => row[0] === 'Note')?.[1])).toContain('holds no taps for this body');
  });
});

describe('retention helpers', () => {
  it('finds the oldest tap day and words the caveat only when the range starts before it', () => {
    expect(oldestTapDay([])).toBeNull();
    expect(oldestTapDay(PERIOD_3_TAPS)).toBe('2026-03-02');
    expect(retentionCaveat(SEPTEMBER, '2026-03-02')).toBeNull();
    expect(retentionCaveat({ preset: 'custom', from: '2026-03-02', to: '2026-03-02' }, '2026-03-02')).toBeNull();
    expect(retentionCaveat({ preset: 'custom', from: '2026-03-01', to: '2026-03-02' }, '2026-03-02')).toContain(
      'Mar 2, 2026',
    );
  });
});

describe('range export file names', () => {
  it('keeps names readable and filesystem-safe', () => {
    expect(buildRangeExportFilename(['English 11', 'Period 3'], range({ preset: 'today' }))).toBe(
      'English 11 - Period 3 - 2026-09-24.xlsx',
    );
    expect(
      buildRangeExportFilename(['Robotics: A/B', 'Period 2 – Room 114?', '  .hidden'], SEPTEMBER),
    ).toBe('Robotics- A-B - Period 2 - Room 114 - hidden - 2026-09-01 to 2026-09-24.xlsx');
    expect(buildRangeExportFilename(['🚀'], SEPTEMBER)).toBe('Attendance - 2026-09-01 to 2026-09-24.xlsx');
    expect(buildRangeExportFilename(['Español 2'], SEPTEMBER)).toBe('Español 2 - 2026-09-01 to 2026-09-24.xlsx');
    const long = buildRangeExportFilename(['x'.repeat(300)], SEPTEMBER);
    expect(long.length).toBeLessThan(140);
  });

  it('passes the desktop save allowlist for every shape it emits', () => {
    const base64 = 'UEsDBBQAAAAIAA==';
    const names = [
      buildRangeExportFilename(['English 11', 'Period 3'], SEPTEMBER),
      buildRangeExportFilename(['English 11', 'Period 3'], range({ preset: 'today' })),
      buildRangeExportFilename(['English 11', 'Period 3'], range({ preset: 'all-time' })),
      buildRangeExportFilename(['Robotics: A/B', '..\\..\\etc', 'C:\\Windows'], SEPTEMBER),
      buildRangeExportFilename(['Español 2', 'Section "B" <new>'], SEPTEMBER),
      buildRangeExportFilename(['🚀'], SEPTEMBER),
      buildRangeExportFilename(['x'.repeat(300)], SEPTEMBER),
    ];
    for (const filename of names) {
      expect(parseSaveRequest({ filename, base64 }), filename).toEqual({ filename, base64 });
    }
  });

  it('still refuses a path, a leading dot or another extension', () => {
    for (const bad of [
      '../English 11 - 2026-09-24.xlsx',
      '.English 11 - 2026-09-24.xlsx',
      'English/11 - 2026-09-24.xlsx',
      'English 11 - 2026-09-24.xlsm',
      'English 11 - 2026-09-24.xlsx\u0000',
      'English 11.xlsx',
    ]) {
      expect(RANGE_EXPORT_FILENAME.test(bad), bad).toBe(false);
    }
  });
});
