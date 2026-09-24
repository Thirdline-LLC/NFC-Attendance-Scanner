import { describe, expect, it } from 'vitest';
import type { Person, TapRecord } from '@/data/attendance-store';
import { indexRoster } from '@/lib/tap-identity';
import {
  DEFAULT_ATTENDANCE_TARGET,
  computeDashboardMetrics,
  computeRollupDashboardMetrics,
  computeSessionAttendance,
  computeYtdSummary,
  distinctStudents,
  gradeBreakdown,
  schoolYearStart,
  selectYearToDateTaps,
  unidentifiedTaps,
} from './attendance-metrics';

// Noon-ish UTC keeps every case comfortably inside the same Eastern calendar
// day, so the assertions do not depend on the daylight-saving offset.
const at = (isoDate: string, time = '16:00:00') => `${isoDate}T${time}.000Z`;

// Mid-September 2026: the 2026-27 school year, which began on 2026-08-01.
const NOW = at('2026-09-15');

function person(
  id: number,
  cardUid: string,
  gradYear: number,
  firstName: string,
): Person {
  return {
    id,
    cardUid,
    firstName,
    lastName: 'Student',
    gradYear,
    email: `${firstName.toLowerCase()}${String(gradYear).slice(-2)}@stjohnschs.org`,
    enrolledAt: at('2026-09-01'),
  };
}

const jordan = person(1, '04A1B2C3D4E5F6', 2027, 'Jordan'); // grade 12
const priya = person(2, '04F6E5D4C3B2A1', 2028, 'Priya'); // grade 11
// Sam's card was tapped before Sam was enrolled (personId null on the tap).
const sam = person(3, '04AAAAAAAAAAAA', 2030, 'Sam'); // grade 9
const morgan = person(4, '04BBBBBBBBBBBB', 2029, 'Morgan'); // grade 10, never taps
const alum = person(5, '04CCCCCCCCCCCC', 2026, 'Alex'); // graduated

const UNKNOWN_A = '00000000000000';
const UNKNOWN_B = '0000000000000B';

let nextTapId = 1;
function tap(
  sessionId: string,
  uid: string,
  scannedAt: string,
  personId: number | null,
): TapRecord {
  return {
    id: nextTapId++,
    sessionId,
    uid,
    scannedAt,
    personId,
    // The stored flag is deliberately untrustworthy for these metrics: it is
    // whatever the scanner decided at the time, so it is set to the naive
    // value here to prove the metrics do not lean on it.
    counted: personId !== null,
  };
}

const roster = [jordan, priya, sam, morgan, alum];
const index = indexRoster(roster);

const TAPS: TapRecord[] = [
  // Last school year: excluded from YTD, but its unknown cards still matter.
  tap('spring-26', jordan.cardUid, at('2026-03-10'), jordan.id!),
  tap('spring-26', priya.cardUid, at('2026-03-10', '16:05:00'), priya.id!),
  tap('spring-26', alum.cardUid, at('2026-03-10', '16:10:00'), alum.id!),
  // The last day of the old school year.
  tap('jul-31', jordan.cardUid, at('2026-07-31'), jordan.id!),
  // The first day of the new one.
  tap('aug-1', jordan.cardUid, at('2026-08-01'), jordan.id!),
  tap('aug-1', priya.cardUid, at('2026-08-01', '16:05:00'), priya.id!),
  // A busy September session: a repeat tap, a retroactive enrollment, and an
  // unknown card tapped twice.
  tap('sep-10', jordan.cardUid, at('2026-09-10', '14:00:00'), jordan.id!),
  tap('sep-10', jordan.cardUid, at('2026-09-10', '14:05:00'), jordan.id!),
  tap('sep-10', priya.cardUid, at('2026-09-10', '14:07:00'), priya.id!),
  tap('sep-10', sam.cardUid, at('2026-09-10', '14:09:00'), null),
  tap('sep-10', UNKNOWN_A, at('2026-09-10', '14:11:00'), null),
  tap('sep-10', UNKNOWN_A, at('2026-09-10', '14:12:00'), null),
  // A session where nobody who tapped was enrolled.
  tap('sep-14', UNKNOWN_B, at('2026-09-14'), null),
];

describe('schoolYearStart', () => {
  it('is August 1 of the calendar year the school year began in', () => {
    expect(schoolYearStart(at('2026-09-15'))).toBe('2026-08-01');
    expect(schoolYearStart(at('2026-12-31'))).toBe('2026-08-01');
    expect(schoolYearStart(at('2027-03-10'))).toBe('2026-08-01');
    expect(schoolYearStart(at('2027-07-31'))).toBe('2026-08-01');
    expect(schoolYearStart(at('2027-08-01'))).toBe('2027-08-01');
  });

  it('rolls over on the Eastern calendar day, not the UTC one', () => {
    // 2026-07-31 23:30 EDT is 2026-08-01 03:30 UTC — still the old year.
    expect(schoolYearStart('2026-08-01T03:30:00.000Z')).toBe('2025-08-01');
    // 2026-08-01 00:30 EDT is 2026-08-01 04:30 UTC — the new one.
    expect(schoolYearStart('2026-08-01T04:30:00.000Z')).toBe('2026-08-01');
  });
});

describe('selectYearToDateTaps', () => {
  it('keeps taps from August 1 onward and drops July 31', () => {
    const sessions = selectYearToDateTaps(TAPS, NOW).map((t) => t.sessionId);

    expect(sessions).not.toContain('spring-26');
    expect(sessions).not.toContain('jul-31');
    expect(sessions).toContain('aug-1');
    expect(sessions).toContain('sep-10');
    expect(sessions).toContain('sep-14');
  });

  it('places the boundary at Eastern midnight', () => {
    const lateJuly = tap('night', jordan.cardUid, '2026-08-01T03:30:00.000Z', 1);
    const earlyAugust = tap('night', jordan.cardUid, '2026-08-01T04:30:00.000Z', 1);

    expect(selectYearToDateTaps([lateJuly, earlyAugust], NOW)).toEqual([
      earlyAugust,
    ]);
  });
});

describe('distinctStudents', () => {
  it('counts a student once no matter how often they tap', () => {
    const students = distinctStudents(
      TAPS.filter((t) => t.sessionId === 'sep-10'),
      index,
    );

    expect(students.map((p) => p.firstName)).toEqual(['Jordan', 'Priya', 'Sam']);
  });

  it('credits a tap whose card was enrolled after the fact', () => {
    const retro = tap('s', sam.cardUid, at('2026-09-10'), null);

    expect(distinctStudents([retro], index)).toEqual([sam]);
    // Without the enrollment, the same tap resolves to nobody.
    expect(distinctStudents([retro], indexRoster([jordan]))).toEqual([]);
  });

  it('falls back to the card when the stored person id no longer resolves', () => {
    const stale = tap('s', jordan.cardUid, at('2026-09-10'), 99);
    const gone = tap('s', UNKNOWN_A, at('2026-09-10'), 99);

    expect(distinctStudents([stale], index)).toEqual([jordan]);
    expect(distinctStudents([gone], index)).toEqual([]);
  });
});

describe('computeSessionAttendance', () => {
  it('lists every session oldest first with its Eastern date', () => {
    const sessions = computeSessionAttendance(TAPS, index);

    expect(sessions.map((s) => [s.sessionId, s.date])).toEqual([
      ['spring-26', '2026-03-10'],
      ['jul-31', '2026-07-31'],
      ['aug-1', '2026-08-01'],
      ['sep-10', '2026-09-10'],
      ['sep-14', '2026-09-14'],
    ]);
  });

  it('counts distinct students, ignoring repeat taps and unknown cards', () => {
    const sepTen = computeSessionAttendance(TAPS, index).find(
      (s) => s.sessionId === 'sep-10',
    );

    // Jordan (tapped twice), Priya, and Sam (enrolled retroactively).
    expect(sepTen?.attendance).toBe(3);
    expect(sepTen?.tapCount).toBe(6);
  });

  it('keeps a session made only of unknown taps, at attendance 0', () => {
    const sepFourteen = computeSessionAttendance(TAPS, index).find(
      (s) => s.sessionId === 'sep-14',
    );

    expect(sepFourteen).toMatchObject({ attendance: 0, tapCount: 1 });
  });

  it('does not lean on the stored counted flag', () => {
    // Every tap says counted: true, yet the roster knows none of them.
    const flagged = [
      { ...tap('s', UNKNOWN_A, at('2026-09-10'), 42), counted: true },
      { ...tap('s', UNKNOWN_B, at('2026-09-10'), 43), counted: true },
    ];

    expect(computeSessionAttendance(flagged, index)[0].attendance).toBe(0);
  });

  it('dates a session by its earliest tap, whatever the input order', () => {
    const later = tap('s', priya.cardUid, at('2026-09-11', '01:00:00'), 2);
    const earlier = tap('s', jordan.cardUid, at('2026-09-10', '23:00:00'), 1);

    const [session] = computeSessionAttendance([later, earlier], index);

    expect(session.startedAt).toBe(earlier.scannedAt);
    expect(session.date).toBe('2026-09-10');
  });

  it('returns nothing for no taps', () => {
    expect(computeSessionAttendance([], index)).toEqual([]);
  });
});

describe('computeYtdSummary', () => {
  const summary = computeYtdSummary(TAPS, index, NOW);

  it('averages unique attendance over this school year only', () => {
    // aug-1: 2, sep-10: 3, sep-14: 0.
    expect(summary.sessionsCount).toBe(3);
    expect(summary.hasSessions).toBe(true);
    expect(summary.averageAttendance).toBeCloseTo(5 / 3, 10);
  });

  it('reports progress against the default target without rounding', () => {
    expect(DEFAULT_ATTENDANCE_TARGET).toBe(50);
    expect(summary.target).toBe(DEFAULT_ATTENDANCE_TARGET);
    expect(summary.percentOfTarget).toBeCloseTo((5 / 3 / 50) * 100, 10);
  });

  it('measures against the target it is given, not the default', () => {
    // One kiosk per club: twelve at a robotics meeting is a full house, and
    // the same twelve at an assembly is not. The number has to move.
    const clubSummary = computeYtdSummary(TAPS, index, NOW, 3);

    expect(clubSummary.target).toBe(3);
    expect(clubSummary.averageAttendance).toBeCloseTo(5 / 3, 10);
    expect(clubSummary.percentOfTarget).toBeCloseTo((5 / 3 / 3) * 100, 10);
    // The attendance itself is untouched by the goal it is measured against.
    expect(clubSummary.sessions).toEqual(summary.sessions);
  });

  it('does not clamp a year that beats the target', () => {
    const packed = Array.from({ length: 60 }, (_, i) =>
      tap('big', `04${String(i).padStart(12, '0')}`, at('2026-09-01'), i + 100),
    );
    const bigRoster = packed.map((t, i) =>
      person(i + 100, t.uid, 2028, `S${i}`),
    );

    const { percentOfTarget } = computeYtdSummary(
      packed,
      indexRoster(bigRoster),
      NOW,
    );

    expect(percentOfTarget).toBe(120);
  });

  it('names the latest and best sessions', () => {
    expect(summary.latestSession).toEqual({ date: '2026-09-14', attendance: 0 });
    expect(summary.bestSession).toEqual({ date: '2026-09-10', attendance: 3 });
  });

  it('keeps the earlier session when two tie for best', () => {
    const tied = [
      tap('first', jordan.cardUid, at('2026-09-01'), 1),
      tap('second', priya.cardUid, at('2026-09-08'), 2),
    ];

    expect(computeYtdSummary(tied, index, NOW).bestSession).toEqual({
      date: '2026-09-01',
      attendance: 1,
    });
  });

  it('counts each student once across the year', () => {
    // Jordan, Priya, Sam. The alum only came last spring.
    expect(summary.uniqueStudents).toBe(3);
  });

  it('flags an empty year instead of reporting a measured zero', () => {
    const empty = computeYtdSummary([], index, NOW);

    expect(empty).toMatchObject({
      schoolYearStart: '2026-08-01',
      sessions: [],
      sessionsCount: 0,
      hasSessions: false,
      averageAttendance: 0,
      percentOfTarget: 0,
      latestSession: null,
      bestSession: null,
      uniqueStudents: 0,
    });
  });

  it('treats last year alone as an empty year', () => {
    const lastYear = TAPS.filter((t) => t.sessionId === 'spring-26');

    expect(computeYtdSummary(lastYear, index, NOW).hasSessions).toBe(false);
  });

  it('trims a session that straddles the rollover to its August taps', () => {
    const straddling = [
      tap('night', jordan.cardUid, '2026-08-01T03:30:00.000Z', 1),
      tap('night', priya.cardUid, '2026-08-01T04:30:00.000Z', 2),
    ];

    const { sessions } = computeYtdSummary(straddling, index, NOW);

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      date: '2026-08-01',
      attendance: 1,
      tapCount: 1,
    });
  });
});

describe('gradeBreakdown', () => {
  it('always lists grades 9 through 12, even at zero', () => {
    expect(gradeBreakdown([], [], NOW)).toEqual([
      { grade: '9', attended: 0, enrolled: 0 },
      { grade: '10', attended: 0, enrolled: 0 },
      { grade: '11', attended: 0, enrolled: 0 },
      { grade: '12', attended: 0, enrolled: 0 },
    ]);
  });

  it('compares attended against enrolled per grade', () => {
    const attended = [jordan, priya, sam];

    expect(gradeBreakdown(attended, roster, NOW)).toEqual([
      { grade: '9', attended: 1, enrolled: 1 },
      { grade: '10', attended: 0, enrolled: 1 },
      { grade: '11', attended: 1, enrolled: 1 },
      { grade: '12', attended: 1, enrolled: 1 },
      // Alex is enrolled but has graduated, so the row appears with no attendance.
      { grade: 'Alumni', attended: 0, enrolled: 1 },
    ]);
  });

  it('omits Alumni and Below 9 when nobody falls in them', () => {
    const grades = gradeBreakdown([jordan], [jordan, priya], NOW).map(
      (row) => row.grade,
    );

    expect(grades).toEqual(['9', '10', '11', '12']);
  });

  it('adds Below 9 when a class too far out shows up', () => {
    const young = person(9, '04DDDDDDDDDDDD', 2031, 'Riley');

    expect(gradeBreakdown([young], [young], NOW)).toContainEqual({
      grade: 'Below 9',
      attended: 1,
      enrolled: 1,
    });
  });

  it('moves everyone up a grade in the next school year', () => {
    const nextFall = at('2027-09-15');

    expect(gradeBreakdown([jordan, priya], [jordan, priya], nextFall)).toEqual([
      { grade: '9', attended: 0, enrolled: 0 },
      { grade: '10', attended: 0, enrolled: 0 },
      { grade: '11', attended: 0, enrolled: 0 },
      { grade: '12', attended: 1, enrolled: 1 },
      { grade: 'Alumni', attended: 1, enrolled: 1 },
    ]);
  });
});

describe('unidentifiedTaps', () => {
  it('counts unknown taps across all time, most recently seen card first', () => {
    const result = unidentifiedTaps(TAPS, index);

    expect(result.tapCount).toBe(3);
    expect(result.cardCount).toBe(2);
    expect(result.cards).toEqual([
      { uid: UNKNOWN_B, tapCount: 1, lastSeenAt: at('2026-09-14') },
      { uid: UNKNOWN_A, tapCount: 2, lastSeenAt: at('2026-09-10', '14:12:00') },
    ]);
  });

  it('stops counting a card once it is enrolled', () => {
    const withoutSam = indexRoster([jordan, priya, morgan, alum]);

    expect(unidentifiedTaps(TAPS, withoutSam).cards.map((c) => c.uid)).toContain(
      sam.cardUid,
    );
    expect(unidentifiedTaps(TAPS, index).cards.map((c) => c.uid)).not.toContain(
      sam.cardUid,
    );
  });

  it('includes a tap whose stored person id has vanished and whose card is unknown', () => {
    const gone = tap('s', UNKNOWN_A, at('2026-09-10'), 99);

    expect(unidentifiedTaps([gone], index)).toEqual({
      tapCount: 1,
      cardCount: 1,
      cards: [{ uid: UNKNOWN_A, tapCount: 1, lastSeenAt: gone.scannedAt }],
    });
  });

  it('is empty when every tap resolves', () => {
    const known = TAPS.filter((t) => t.uid !== UNKNOWN_A && t.uid !== UNKNOWN_B);

    expect(unidentifiedTaps(known, index)).toEqual({
      tapCount: 0,
      cardCount: 0,
      cards: [],
    });
  });
});

describe('computeDashboardMetrics', () => {
  it('assembles every section from the raw taps and roster', () => {
    const metrics = computeDashboardMetrics(TAPS, roster, NOW);

    expect(metrics.computedAt).toBe(NOW);
    expect(metrics.enrolledStudents).toBe(5);
    expect(metrics.ytd.sessionsCount).toBe(3);
    expect(metrics.ytd.uniqueStudents).toBe(3);
    expect(metrics.gradeBreakdown.map((r) => [r.grade, r.attended, r.enrolled])).toEqual([
      ['9', 1, 1],
      ['10', 0, 1],
      ['11', 1, 1],
      ['12', 1, 1],
      ['Alumni', 0, 1],
    ]);
    expect(metrics.unidentified.tapCount).toBe(3);
  });

  it('handles an empty device', () => {
    const metrics = computeDashboardMetrics([], [], NOW);

    expect(metrics.ytd.hasSessions).toBe(false);
    expect(metrics.ytd.averageAttendance).toBe(0);
    expect(metrics.ytd.percentOfTarget).toBe(0);
    expect(metrics.enrolledStudents).toBe(0);
    expect(metrics.gradeBreakdown).toHaveLength(4);
    expect(metrics.unidentified).toEqual({ tapCount: 0, cardCount: 0, cards: [] });
    expect(metrics.scope).toBe('body');
  });
});

describe('subtree roll-up metrics', () => {
  function enrolled(
    id: number,
    bodyId: number,
    cardUid: string,
    email: string,
    gradYear = 2027,
  ): Person {
    return {
      id,
      bodyId,
      cardUid,
      firstName: 'Student',
      lastName: `Row${id}`,
      gradYear,
      email,
      enrolledAt: at('2026-09-01'),
    };
  }

  it('counts a shared email once, then a shared card, and sums unknown cards per body', () => {
    const parentJane = enrolled(1, 10, '04AAAAAAAAAAAA', 'Jane@school.test');
    const childJane = enrolled(2, 20, '04BBBBBBBBBBBB', 'jane@school.test');
    const childAda = enrolled(3, 20, '04CCCCCCCCCCCC', 'ada@school.test', 2028);
    const sharedCardA = enrolled(4, 10, '04DDDDDDDDDDDD', '');
    const sharedCardB = enrolled(5, 20, '04DDDDDDDDDDDD', '  ');
    const soloA = enrolled(6, 10, '04EEEEEEEEEEEE', '');
    const soloB = enrolled(7, 20, '04FFFFFFFFFFFF', '');
    const people = [parentJane, childJane, childAda, sharedCardA, sharedCardB, soloA, soloB];

    const taps: TapRecord[] = [
      { ...tap('meet', parentJane.cardUid!, NOW, parentJane.id!), bodyId: 10 },
      { ...tap('meet', childJane.cardUid!, NOW, childJane.id!), bodyId: 20 },
      { ...tap('meet', childAda.cardUid!, NOW, childAda.id!), bodyId: 20 },
      { ...tap('meet', sharedCardA.cardUid!, NOW, sharedCardA.id!), bodyId: 10 },
      { ...tap('meet', sharedCardB.cardUid!, NOW, sharedCardB.id!), bodyId: 20 },
      { ...tap('meet', soloA.cardUid!, NOW, soloA.id!), bodyId: 10 },
      { ...tap('meet', soloB.cardUid!, NOW, soloB.id!), bodyId: 20 },
      { ...tap('meet', '04UNK000000001', NOW, null), bodyId: 10 },
      { ...tap('meet', '04UNK000000001', NOW, null), bodyId: 20 },
    ];

    const rolled = computeRollupDashboardMetrics(taps, people, NOW);
    // Jane once (email), Ada once, the shared card once, two card-only solos.
    expect(rolled.ytd.uniqueStudents).toBe(5);
    expect(rolled.enrolledStudents).toBe(5);
    expect(rolled.ytd.sessions).toHaveLength(1);
    expect(rolled.ytd.sessions[0].attendance).toBe(5);
    expect(rolled.unidentified.cardCount).toBe(2);
    expect(rolled.unidentified.tapCount).toBe(2);
    expect(rolled.unidentified.cards.map((card) => card.bodyId).sort()).toEqual([10, 20]);
    expect(rolled.scope).toBe('subtree');

    // The same rows, counted per roster row, do not collapse the two Janes.
    const perRow = computeDashboardMetrics(taps, people, NOW);
    expect(perRow.ytd.uniqueStudents).toBe(7);
    expect(perRow.scope).toBe('body');
  });

  it('does not let one body’s roster identify another body’s unknown card', () => {
    const known = enrolled(1, 20, '04AAAAAAAAAAAA', 'known@school.test');
    const taps: TapRecord[] = [
      { ...tap('meet', known.cardUid!, NOW, null), bodyId: 10 },
    ];
    const rolled = computeRollupDashboardMetrics(taps, [known], NOW);
    expect(rolled.ytd.uniqueStudents).toBe(0);
    expect(rolled.unidentified.cardCount).toBe(1);
  });
});
