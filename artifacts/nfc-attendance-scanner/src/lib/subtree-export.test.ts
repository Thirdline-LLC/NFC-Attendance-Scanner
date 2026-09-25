import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';

import type { AttendanceBody, Person, TapRecord } from '@/data/attendance-store';
import { parseSaveRequest } from '../../electron/validation';
import {
  computePeriodBreakdown,
  computeRangeMetrics,
  computeSubtreeRangeMetrics,
} from './attendance-metrics';
import { resolveDateRange, type DateRange } from './date-range';
import {
  SUBTREE_TOTAL_LABEL,
  buildRangeExportFilename,
  buildRangeWorkbook,
  buildSubtreeRangeWorkbook,
  subtreeFilenameScope,
  subtreeScopeNoun,
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

function student(
  id: number,
  bodyId: number,
  first: string,
  last: string,
  email = `${first.toLowerCase()}.${last.toLowerCase()}@example.com`,
): Person {
  return {
    id,
    bodyId,
    cardUid: `04${String(id).padStart(12, '0')}`,
    firstName: first,
    lastName: last,
    gradYear: 2028,
    email,
    enrolledAt: at('2026-08-20', '13:00:00'),
  };
}

let nextTapId = 1;
function tap(uid: string, bodyId: number, sessionId: string, day: string, time = '16:00:00'): TapRecord {
  return {
    id: nextTapId++,
    uid,
    scannedAt: at(day, time),
    personId: null,
    sessionId,
    counted: true,
    bodyId,
  };
}
const tapBy = (who: Person, sessionId: string, day: string, time?: string) =>
  tap(who.cardUid as string, who.bodyId as number, sessionId, day, time);

/*
 * English 11 (10) › Period 1 (11), Period 3 (12) › Lab (15), Period 5 (13,
 * archived). Sam is enrolled in Period 1 and Period 3 — two roster rows, the
 * same email once trimmed and lowercased. Lab is a grandchild. A card
 * enrolled in Period 1 (Ellis's) is tapped in Lab, where nobody owns it.
 */
const created = at('2026-08-01');
const CLASS: AttendanceBody[] = [
  { id: 10, name: 'English 11', typeLabel: 'class', createdAt: created, parentId: null },
  { id: 11, name: 'Period 1', typeLabel: 'Period', createdAt: created, parentId: 10, sortOrder: 0 },
  { id: 12, name: 'Period 3', typeLabel: 'period', createdAt: created, parentId: 10, sortOrder: 1 },
  {
    id: 13,
    name: 'Period 5',
    typeLabel: 'period',
    createdAt: created,
    parentId: 10,
    sortOrder: 2,
    archivedAt: at('2026-09-15'),
  },
];
const LAB: AttendanceBody = { id: 15, name: 'Lab', typeLabel: 'section', createdAt: created, parentId: 12, sortOrder: 0 };
const DEEP = [...CLASS, LAB];

const ellis = student(1, 11, 'Ellis', 'Evans');
const sam1 = student(2, 11, 'Sam', 'Shared', 'sam.shared@example.com');
const avery = student(3, 12, 'Avery', 'Adams');
const sam3 = student(4, 12, 'Sam', 'Shared', '  SAM.Shared@example.com ');
const pat = student(5, 13, 'Pat', 'Park');
const lee = student(6, 15, 'Lee', 'Lin');

const FLAT_PERSONS = [ellis, sam1, avery, sam3, pat];
const FLAT_TAPS = [
  // Period 1: 2 of 2, then 1 of 2.
  tapBy(ellis, 'p1a', '2026-09-02', '12:00:00'),
  tapBy(sam1, 'p1a', '2026-09-02', '12:01:00'),
  tapBy(ellis, 'p1b', '2026-09-09', '12:00:00'),
  // Period 3: 1 of 2, then 2 of 2 (Sam again, in this period).
  tapBy(avery, 'p3a', '2026-09-02', '14:00:00'),
  tapBy(avery, 'p3b', '2026-09-09', '14:00:00'),
  tapBy(sam3, 'p3b', '2026-09-09', '14:01:00'),
  // Period 5, archived since, met once: 1 of 1.
  tapBy(pat, 'p5a', '2026-09-03', '18:00:00'),
];
const DEEP_PERSONS = [...FLAT_PERSONS, lee];
const DEEP_TAPS = [
  ...FLAT_TAPS,
  // Lab: Lee, 1 of 1 — and Ellis's card, which Lab does not know.
  tapBy(lee, 'la', '2026-09-04', '15:00:00'),
  tap(ellis.cardUid as string, 15, 'la', '2026-09-04', '15:02:00'),
];

function sheet(workbook: XLSX.WorkBook, name: string): unknown[][] {
  return XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], { header: 1 });
}
function table(workbook: XLSX.WorkBook, name: string): Record<string, unknown>[] {
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[name]);
}
/** The Summary sheet's person table: from its header row down. */
function summaryTable(workbook: XLSX.WorkBook): Record<string, unknown>[] {
  const rows = sheet(workbook, 'Summary');
  const start = rows.findIndex((row) => row[0] === 'Period');
  const [header, ...body] = rows.slice(start);
  return body.map((row) => Object.fromEntries((header as string[]).map((key, i) => [key, row[i]])));
}

describe('computeSubtreeRangeMetrics', () => {
  it('lists every descendant at any depth, preorder, archived ones marked; no row for an empty root', () => {
    const subtree = computeSubtreeRangeMetrics(10, DEEP, DEEP_TAPS, DEEP_PERSONS, SEPTEMBER);
    expect(subtree.periods.map((period) => [period.pathNames.join(' › '), period.archived])).toEqual([
      ['English 11 › Period 1', false],
      ['English 11 › Period 3', false],
      ['English 11 › Period 3 › Lab', false],
      ['English 11 › Period 5', true],
    ]);
  });

  it('counts a person in each period they are enrolled in, and once in the totals', () => {
    const subtree = computeSubtreeRangeMetrics(10, CLASS, FLAT_TAPS, FLAT_PERSONS, SEPTEMBER);
    expect(subtree.periods.map((period) => [period.metrics.uniquePresent, period.metrics.enrolled])).toEqual([
      [2, 2],
      [2, 2],
      [1, 1],
    ]);
    // Sam is in Period 1 and Period 3: 5 enrollments, 4 people.
    expect(subtree.enrolled).toBe(4);
    expect(subtree.uniquePresent).toBe(4);
  });

  it('pools every period’s meetings, each divided by its own period’s roster', () => {
    const subtree = computeSubtreeRangeMetrics(10, CLASS, FLAT_TAPS, FLAT_PERSONS, SEPTEMBER);
    expect(subtree.meetingsHeld).toBe(5);
    // (2/2 + 1/2) + (1/2 + 2/2) + 1/1 over 5 meetings — not 5 present ÷ the
    // whole class's roster, which one roll-up over all the rows would give.
    expect(subtree.averageAttendancePercent).toBeCloseTo(80, 6);
    const pooled = computeRangeMetrics(FLAT_TAPS, FLAT_PERSONS, SEPTEMBER, 'rollup');
    expect(pooled.averageAttendancePercent).not.toBeCloseTo(80, 1);
  });

  it('includes the root’s own row, first, when it has taps or a roster of its own', () => {
    const drifter = student(9, 10, 'Dana', 'Drift');
    const subtree = computeSubtreeRangeMetrics(
      10,
      CLASS,
      [...FLAT_TAPS, tapBy(drifter, 'root', '2026-09-05')],
      [...FLAT_PERSONS, drifter],
      SEPTEMBER,
    );
    expect(subtree.periods[0].pathNames).toEqual(['English 11']);
    expect(subtree.periods).toHaveLength(4);
    expect(subtree.enrolled).toBe(5);
  });

  it('works for any tree, e.g. a club with a branch and no class vocabulary', () => {
    const club: AttendanceBody[] = [
      { id: 1, name: 'Robotics', typeLabel: 'club', createdAt: created, parentId: null },
      { id: 2, name: 'Build team', typeLabel: 'team', createdAt: created, parentId: 1 },
      { id: 3, name: 'Drive team', typeLabel: 'squad', createdAt: created, parentId: 1 },
    ];
    const kit = student(20, 2, 'Kit', 'Kane');
    const subtree = computeSubtreeRangeMetrics(1, club, [tapBy(kit, 'b1', '2026-09-10')], [kit], SEPTEMBER);
    expect(subtree.periods.map((period) => period.pathNames.join(' › '))).toEqual([
      'Robotics › Build team',
      'Robotics › Drive team',
    ]);
    expect(subtreeScopeNoun(1, club)).toBe('children');
  });
});

describe('the class-wide rows agree with the dashboard for this school year', () => {
  it('matches computePeriodBreakdown and computeRangeMetrics row for row', () => {
    const now = NOW.toISOString();
    const schoolYear = range({ preset: 'school-year' });
    const breakdown = computePeriodBreakdown(10, CLASS, FLAT_TAPS, FLAT_PERSONS, now);
    const subtree = computeSubtreeRangeMetrics(10, CLASS, FLAT_TAPS, FLAT_PERSONS, schoolYear);
    expect(
      subtree.periods.map((period) => ({
        bodyId: period.bodyId,
        meetingsHeld: period.metrics.meetingsHeld,
        uniquePresent: period.metrics.uniquePresent,
        enrolled: period.metrics.enrolled,
        averageAttendancePercent: period.metrics.averageAttendancePercent,
        archived: period.archived,
      })),
    ).toEqual(
      breakdown.map((row) => ({
        bodyId: row.bodyId,
        meetingsHeld: row.meetingsHeld,
        uniquePresent: row.uniquePresent,
        enrolled: row.enrolled,
        averageAttendancePercent: row.averageAttendancePercent,
        archived: row.archived,
      })),
    );
    // And the exported Summary by period rows carry the same figures.
    const { workbook } = buildSubtreeRangeWorkbook({
      rootId: 10,
      bodies: CLASS,
      taps: FLAT_TAPS,
      persons: FLAT_PERSONS,
      bodyPath: ['English 11'],
      range: schoolYear,
      now: NOW,
    });
    const rows = table(workbook, 'Summary by period');
    breakdown.forEach((row, i) => {
      expect(rows[i]['Meetings held']).toBe(row.meetingsHeld);
      expect(rows[i]['Unique present']).toBe(row.uniquePresent);
      expect(rows[i].Enrolled).toBe(row.enrolled);
      expect(rows[i]['Average attendance %']).toBe(
        Math.round((row.averageAttendancePercent as number) * 10) / 10,
      );
    });
    // Each period row is that period's own single-body metrics, too.
    const p3 = computeRangeMetrics(
      FLAT_TAPS.filter((t) => t.bodyId === 12),
      FLAT_PERSONS.filter((p) => p.bodyId === 12),
      schoolYear,
    );
    expect(rows[1]['Meetings held']).toBe(p3.meetingsHeld);
    expect(rows[1]['Average attendance %']).toBe(75);
  });
});

describe('buildSubtreeRangeWorkbook', () => {
  const built = buildSubtreeRangeWorkbook({
    rootId: 10,
    bodies: DEEP,
    taps: DEEP_TAPS,
    persons: DEEP_PERSONS,
    bodyPath: ['English 11'],
    range: SEPTEMBER,
    now: NOW,
    activity: [{ at: at('2026-09-20'), kind: 'pin-set' }],
  });

  it('adds Summary by period; names the file for the scope; no Activity for a slice', () => {
    expect(built.workbook.SheetNames).toEqual(['Summary', 'Summary by period', 'Attendance', 'By meeting']);
    expect(built.filename).toBe('English 11 - All periods - 2026-09-01 to 2026-09-24.xlsx');
    expect(built.tapCount).toBe(9);
    expect(built.sessionCount).toBe(6);
    expect(built.bodyCount).toBe(4);
  });

  it('writes one Summary by period row per descendant, full path, then the de-duplicated total', () => {
    expect(table(built.workbook, 'Summary by period')).toEqual([
      { Period: 'English 11 › Period 1', 'Meetings held': 2, 'Unique present': 2, Enrolled: 2, 'Average attendance %': 75 },
      { Period: 'English 11 › Period 3', 'Meetings held': 2, 'Unique present': 2, Enrolled: 2, 'Average attendance %': 75 },
      { Period: 'English 11 › Period 3 › Lab', 'Meetings held': 1, 'Unique present': 1, Enrolled: 1, 'Average attendance %': 100 },
      { Period: 'English 11 › Period 5 (archived)', 'Meetings held': 1, 'Unique present': 1, Enrolled: 1, 'Average attendance %': 100 },
      // 6 enrollments, 5 people (Sam once); (1 + .5 + .5 + 1 + 1 + 1) / 6.
      { Period: SUBTREE_TOTAL_LABEL, 'Meetings held': 6, 'Unique present': 5, Enrolled: 5, 'Average attendance %': 83.3 },
    ]);
  });

  it('heads the Summary with the class-wide totals, then a row per person per period with Period first', () => {
    const rows = sheet(built.workbook, 'Summary');
    expect(rows[1]).toEqual(['Body', 'English 11 + all periods']);
    expect(rows[4]).toEqual(['Meetings held', 6]);
    expect(rows[5]).toEqual(['Average attendance %', 83.3]);
    expect(rows[6]).toEqual(['Unique present', '5 of 5 enrolled (each person counted once)']);
    const people = summaryTable(built.workbook);
    expect(Object.keys(people[0])[0]).toBe('Period');
    expect(people.map((row) => [row.Period, row.Name, row['Meetings attended'], row['Meetings held']])).toEqual([
      ['English 11 › Period 1', 'Ellis Evans', 2, 2],
      ['English 11 › Period 1', 'Sam Shared', 1, 2],
      ['English 11 › Period 3', 'Avery Adams', 2, 2],
      ['English 11 › Period 3', 'Sam Shared', 1, 2],
      ['English 11 › Period 3 › Lab', 'Lee Lin', 1, 1],
      ['English 11 › Period 5 (archived)', 'Pat Park', 1, 1],
    ]);
  });

  it('adds a Period column to Attendance, resolving each tap against its own body’s roster', () => {
    const rows = table(built.workbook, 'Attendance');
    expect(Object.keys(rows[0]).at(-1)).toBe('Period');
    expect(rows.map((row) => [row.Name, row.Period, row['Body Name']])).toEqual([
      ['Ellis Evans', 'English 11 › Period 1', 'Period 1'],
      ['Sam Shared', 'English 11 › Period 1', 'Period 1'],
      ['Avery Adams', 'English 11 › Period 3', 'Period 3'],
      ['Pat Park', 'English 11 › Period 5 (archived)', 'Period 5'],
      ['Lee Lin', 'English 11 › Period 3 › Lab', 'Lab'],
      // Ellis's card, tapped in Lab: Lab's roster does not know it.
      ['Unknown card', 'English 11 › Period 3 › Lab', 'Lab'],
      ['Ellis Evans', 'English 11 › Period 1', 'Period 1'],
      ['Avery Adams', 'English 11 › Period 3', 'Period 3'],
      ['Sam Shared', 'English 11 › Period 3', 'Period 3'],
    ]);
    expect(rows.every((row) => String(row['Card (last 4)']).startsWith('••••'))).toBe(true);
  });

  it('labels every By meeting row with its period, oldest first', () => {
    expect(table(built.workbook, 'By meeting').map((row) => [row.Period, row.Date, row.Present, row['Roster size']])).toEqual([
      ['English 11 › Period 1', '2026-09-02', 2, 2],
      ['English 11 › Period 3', '2026-09-02', 1, 2],
      ['English 11 › Period 5 (archived)', '2026-09-03', 1, 1],
      ['English 11 › Period 3 › Lab', '2026-09-04', 1, 1],
      ['English 11 › Period 1', '2026-09-09', 1, 2],
      ['English 11 › Period 3', '2026-09-09', 2, 2],
    ]);
  });

  it('keeps the Activity sheet for All time only, with the retention note for the whole class', () => {
    const allTime = buildSubtreeRangeWorkbook({
      rootId: 10,
      bodies: DEEP,
      taps: DEEP_TAPS,
      persons: DEEP_PERSONS,
      bodyPath: ['English 11'],
      range: range({ preset: 'all-time' }),
      now: NOW,
      activity: [{ at: at('2026-09-20'), kind: 'pin-set' }],
    });
    expect(allTime.workbook.SheetNames.at(-1)).toBe('Activity');
    expect(allTime.filename).toBe('English 11 - All periods - All time.xlsx');
    const note = sheet(allTime.workbook, 'Summary').find((row) => row[0] === 'Note');
    expect(String(note?.[1])).toContain('this body and its periods');
    expect(String(note?.[1])).toContain('Sep 2, 2026');
  });

  it('says so when nobody in the subtree is enrolled', () => {
    const empty = buildSubtreeRangeWorkbook({
      rootId: 10,
      bodies: CLASS,
      taps: [],
      persons: [],
      bodyPath: ['English 11'],
      range: SEPTEMBER,
      now: NOW,
    });
    expect(table(empty.workbook, 'Summary by period').at(-1)).toMatchObject({
      Period: SUBTREE_TOTAL_LABEL,
      'Meetings held': 0,
      'Average attendance %': '—',
    });
    expect(sheet(empty.workbook, 'Summary').at(-1)).toEqual([
      'No students are enrolled on this body or its periods.',
    ]);
  });
});

describe('single-body scope is unchanged by the class-wide one', () => {
  it('has no Period column and no Summary by period', () => {
    const { workbook, filename } = buildRangeWorkbook({
      taps: FLAT_TAPS.filter((t) => t.bodyId === 12),
      persons: FLAT_PERSONS.filter((p) => p.bodyId === 12),
      bodyPath: ['English 11', 'Period 3'],
      range: SEPTEMBER,
      now: NOW,
    });
    expect(workbook.SheetNames).toEqual(['Summary', 'Attendance', 'By meeting']);
    expect(filename).toBe('English 11 - Period 3 - 2026-09-01 to 2026-09-24.xlsx');
    expect(Object.keys(table(workbook, 'Attendance')[0])).not.toContain('Period');
    expect(Object.keys(table(workbook, 'By meeting')[0])).not.toContain('Period');
    expect(sheet(workbook, 'Summary')[1]).toEqual(['Body', 'English 11 › Period 3']);
  });
});

describe('class-wide file names', () => {
  it('keep the scope after a long path, and pass the desktop save allowlist', () => {
    const base64 = 'UEsDBBQAAAAIAA==';
    const long = buildRangeExportFilename(['x'.repeat(300)], SEPTEMBER, subtreeFilenameScope('periods'));
    expect(long).toMatch(/^x+ - All periods - 2026-09-01 to 2026-09-24\.xlsx$/);
    const names = [
      long,
      buildRangeExportFilename(['English 11'], SEPTEMBER, subtreeFilenameScope('periods')),
      buildRangeExportFilename(['Robotics: A/B'], range({ preset: 'all-time' }), subtreeFilenameScope('children')),
      buildRangeExportFilename(['a' + '𠀀'.repeat(120)], range({ preset: 'today' }), subtreeFilenameScope('classes')),
      // A type label of any length still leaves a name the desktop will save.
      buildRangeExportFilename(['English 11'], SEPTEMBER, subtreeFilenameScope('p'.repeat(150))),
      buildRangeExportFilename(['x'.repeat(300)], SEPTEMBER, subtreeFilenameScope('𠀀'.repeat(150))),
    ];
    for (const filename of names) {
      expect(parseSaveRequest({ filename, base64 }), filename).toEqual({ filename, base64 });
    }
  });
});
