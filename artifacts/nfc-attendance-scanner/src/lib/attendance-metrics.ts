import type { Person, TapRecord } from '@/data/attendance-store';
import {
  currentSeniorGradYear,
  deriveGrade,
} from '@/lib/attendance-export';
import { formatSessionDate } from '@/lib/session-formatting';
import {
  compareSiblingOrder,
  isArchived,
  subtreeBodyIds,
  type BodyNode,
} from '@/data/body-hierarchy';
import {
  indexRoster,
  resolveTapPerson,
  type RosterIndex,
} from '@/lib/tap-identity';

/**
 * The target used when a caller does not supply one.
 *
 * The real target is a device setting (`getAttendanceTarget`), because one
 * kiosk serves one club and clubs are different sizes. This re-export keeps
 * the default in one place; nothing in the metrics reads it except as a
 * fallback.
 */
export { DEFAULT_ATTENDANCE_TARGET } from '@/data/attendance-store';
import { DEFAULT_ATTENDANCE_TARGET } from '@/data/attendance-store';

export type SessionAttendance = {
  sessionId: string;
  /** Eastern calendar date (`YYYY-MM-DD`) of the session's earliest tap. */
  date: string;
  /** ISO timestamp of the session's earliest tap; orders sessions. */
  startedAt: string;
  /** Distinct enrolled students who tapped in during the session. */
  attendance: number;
  /** Every tap in the session, repeat taps and unknown cards included. */
  tapCount: number;
};

export type SessionSnapshot = Pick<SessionAttendance, 'date' | 'attendance'>;

export type YtdSummary = {
  /** First day of the current school year, Eastern `YYYY-MM-DD`. */
  schoolYearStart: string;
  /** Sessions held this school year, oldest first. */
  sessions: SessionAttendance[];
  sessionsCount: number;
  /**
   * False until the year's first session. The averages below are then 0 by
   * definition rather than by measurement, and the UI should say so.
   */
  hasSessions: boolean;
  averageAttendance: number;
  target: number;
  /** Unrounded and unclamped: a strong year reads over 100. */
  percentOfTarget: number;
  latestSession: SessionSnapshot | null;
  bestSession: SessionSnapshot | null;
  /** Distinct students who attended at least once this school year. */
  uniqueStudents: number;
};

/** Exactly the set of strings `deriveGrade` can return. */
export type GradeBucket = '9' | '10' | '11' | '12' | 'Alumni' | 'Below 9';

export type GradeBreakdownRow = {
  grade: GradeBucket;
  /** Distinct students in this grade who attended this school year. */
  attended: number;
  /** Everyone enrolled in this grade, attended or not. */
  enrolled: number;
};

export type UnidentifiedCard = {
  uid: string;
  tapCount: number;
  lastSeenAt: string;
  /**
   * Set on a subtree roll-up so the same card in two bodies stays two rows.
   * Absent in "this body" mode.
   */
  bodyId?: number;
};

export type UnidentifiedSummary = {
  tapCount: number;
  cardCount: number;
  /** Most recently seen first, so the card just tapped is at the top. */
  cards: UnidentifiedCard[];
};

export type DashboardMetrics = {
  /** The `now` the metrics were computed against, so the UI can show it. */
  computedAt: string;
  ytd: YtdSummary;
  gradeBreakdown: GradeBreakdownRow[];
  enrolledStudents: number;
  unidentified: UnidentifiedSummary;
  /**
   * `body` is one node's roster and taps. `subtree` is that node plus its
   * descendants, with the roll-up identity rules in `rollupIdentityKey`.
   */
  scope: 'body' | 'subtree';
};

/**
 * First day of the school year in session on `now`. The senior class
 * graduates the spring after the year starts, so the year began on August 1
 * of the calendar year before their graduation year.
 */
export function schoolYearStart(now: string): string {
  return `${currentSeniorGradYear(now) - 1}-08-01`;
}

/**
 * Taps recorded on or after the school-year rollover. Classified tap by tap
 * rather than session by session, so a session that happened to straddle
 * midnight on July 31 keeps only its August taps and reads as an August 1
 * session; this matches how `Meeting Date` is assigned in the export.
 */
export function selectYearToDateTaps(
  taps: readonly TapRecord[],
  now: string,
): TapRecord[] {
  const start = schoolYearStart(now);

  // Both sides are Eastern `YYYY-MM-DD`, so a string compare is a date compare.
  return taps.filter((tap) => formatSessionDate(tap.scannedAt) >= start);
}

/**
 * Distinct-student key. Roster rows carry an id once stored; the card UID, or
 * failing that the address the roster keeps unique, stands in for an unsaved
 * row so it is never silently dropped from a count.
 */
function studentKey(person: Person): number | string {
  return person.id ?? person.cardUid ?? person.email;
}

/**
 * The distinct students behind a set of taps, in first-seen order. A tap
 * whose card was enrolled after it was recorded still resolves, so enrolling
 * a card retroactively credits its earlier taps.
 */
export function distinctStudents(
  taps: readonly TapRecord[],
  roster: RosterIndex,
): Person[] {
  const seen = new Map<number | string, Person>();

  for (const tap of taps) {
    const person = resolveTapPerson(tap, roster);
    if (person && !seen.has(studentKey(person))) {
      seen.set(studentKey(person), person);
    }
  }

  return [...seen.values()];
}

/**
 * One entry per session id, oldest session first. A session whose taps all
 * came from unknown cards still appears, with attendance 0: it was a meeting
 * that happened, and dropping it would flatter the average.
 */
export function computeSessionAttendance(
  taps: readonly TapRecord[],
  roster: RosterIndex,
): SessionAttendance[] {
  const groups = new Map<string, TapRecord[]>();

  for (const tap of taps) {
    const group = groups.get(tap.sessionId);
    if (group) group.push(tap);
    else groups.set(tap.sessionId, [tap]);
  }

  const sessions = [...groups].map(([sessionId, sessionTaps]) => {
    let startedAt = sessionTaps[0].scannedAt;
    for (const tap of sessionTaps) {
      if (Date.parse(tap.scannedAt) < Date.parse(startedAt)) {
        startedAt = tap.scannedAt;
      }
    }

    return {
      sessionId,
      date: formatSessionDate(startedAt),
      startedAt,
      // Counted against the roster as it stands now, not from the stored
      // `counted` flag. That flag was decided at scan time and cannot see a
      // card enrolled afterwards, so it would undercount retroactive
      // enrollments that this dashboard exists to credit.
      attendance: distinctStudents(sessionTaps, roster).length,
      tapCount: sessionTaps.length,
    };
  });

  return sessions.sort(
    (a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt),
  );
}

function snapshot(session: SessionAttendance): SessionSnapshot {
  return { date: session.date, attendance: session.attendance };
}

/**
 * The summary, plus the distinct students behind it, from taps already
 * narrowed to the school year.
 *
 * Split out so `computeDashboardMetrics` can filter the history once and reuse
 * the student list for the grade breakdown. Both were previously recomputed:
 * the year-to-date filter formats every tap's Eastern date, and running it
 * twice over a term's history was the single most expensive thing the
 * dashboard did.
 */
function summarizeYearToDateTaps(
  ytdTaps: readonly TapRecord[],
  roster: RosterIndex,
  now: string,
  target: number = DEFAULT_ATTENDANCE_TARGET,
): { summary: YtdSummary; students: Person[] } {
  const sessions = computeSessionAttendance(ytdTaps, roster);
  const hasSessions = sessions.length > 0;
  const averageAttendance = hasSessions
    ? sessions.reduce((sum, session) => sum + session.attendance, 0) /
      sessions.length
    : 0;

  let best: SessionAttendance | null = null;
  for (const session of sessions) {
    // Strictly greater, so a tie keeps the earlier session.
    if (!best || session.attendance > best.attendance) best = session;
  }
  // Sessions are sorted oldest first, so the latest is the last one.
  const latest = hasSessions ? sessions[sessions.length - 1] : null;
  const students = distinctStudents(ytdTaps, roster);

  return {
    summary: {
      schoolYearStart: schoolYearStart(now),
      sessions,
      sessionsCount: sessions.length,
      hasSessions,
      averageAttendance,
      target,
      percentOfTarget: (averageAttendance / target) * 100,
      latestSession: latest && snapshot(latest),
      bestSession: best && snapshot(best),
      uniqueStudents: students.length,
    },
    students,
  };
}

export function computeYtdSummary(
  taps: readonly TapRecord[],
  roster: RosterIndex,
  now: string,
  target: number = DEFAULT_ATTENDANCE_TARGET,
): YtdSummary {
  return summarizeYearToDateTaps(
    selectYearToDateTaps(taps, now),
    roster,
    now,
    target,
  ).summary;
}

const CORE_GRADES: readonly GradeBucket[] = ['9', '10', '11', '12'];
// Listed after the core grades rather than in ladder order, so the four rows
// a reader expects stay in a stable position when an odd bucket appears.
const EDGE_GRADES: readonly GradeBucket[] = ['Alumni', 'Below 9'];

/**
 * Attended vs enrolled per grade. Grades 9-12 are always listed, even at 0,
 * because their absence would read as a data problem; Alumni and Below 9 are
 * unusual enough that an empty row would only raise questions.
 */
export function gradeBreakdown(
  attended: readonly Person[],
  roster: readonly Person[],
  now: string,
): GradeBreakdownRow[] {
  const rows = new Map<GradeBucket, GradeBreakdownRow>();
  const rowFor = (person: Person): GradeBreakdownRow => {
    const grade = deriveGrade(person.gradYear, now) as GradeBucket;
    let row = rows.get(grade);
    if (!row) {
      row = { grade, attended: 0, enrolled: 0 };
      rows.set(grade, row);
    }
    return row;
  };

  for (const person of roster) rowFor(person).enrolled += 1;
  for (const person of attended) rowFor(person).attended += 1;

  return [
    ...CORE_GRADES.map(
      (grade) => rows.get(grade) ?? { grade, attended: 0, enrolled: 0 },
    ),
    ...EDGE_GRADES.flatMap((grade) => {
      const row = rows.get(grade);
      return row ? [row] : [];
    }),
  ];
}

/**
 * Taps that resolve to nobody, across all time rather than just this school
 * year: a card that needs enrolling needs it regardless of when it was seen.
 */
export function unidentifiedTaps(
  taps: readonly TapRecord[],
  roster: RosterIndex,
): UnidentifiedSummary {
  const cards = new Map<string, UnidentifiedCard>();
  let tapCount = 0;

  for (const tap of taps) {
    if (resolveTapPerson(tap, roster)) continue;

    tapCount += 1;
    const card = cards.get(tap.uid);
    if (!card) {
      cards.set(tap.uid, { uid: tap.uid, tapCount: 1, lastSeenAt: tap.scannedAt });
    } else {
      card.tapCount += 1;
      if (Date.parse(tap.scannedAt) > Date.parse(card.lastSeenAt)) {
        card.lastSeenAt = tap.scannedAt;
      }
    }
  }

  return {
    tapCount,
    cardCount: cards.size,
    cards: [...cards.values()].sort(
      (a, b) => Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt),
    ),
  };
}

/**
 * Everything the dashboard shows, from the full tap history and roster. `now`
 * is injected rather than read from the clock so the school-year boundary and
 * grade labels are reproducible.
 */
export function computeDashboardMetrics(
  taps: readonly TapRecord[],
  persons: readonly Person[],
  now: string,
  target: number = DEFAULT_ATTENDANCE_TARGET,
): DashboardMetrics {
  const roster = indexRoster(persons);
  const { summary, students } = summarizeYearToDateTaps(
    selectYearToDateTaps(taps, now),
    roster,
    now,
    target,
  );

  return {
    computedAt: now,
    ytd: summary,
    gradeBreakdown: gradeBreakdown(students, persons, now),
    enrolledStudents: persons.length,
    unidentified: unidentifiedTaps(taps, roster),
    scope: 'body',
  };
}

/**
 * Identity for a subtree roll-up ("this body + descendants").
 *
 * Prefer the student's email, trimmed and lowercased. When the row has no
 * email, use `cardUid`. Two roster rows that share an email — or, with no
 * email, the same card — are one person in the roll-up, even though each
 * body still owns its own row (D-T2). Two enrollments that share neither an
 * email nor a card still count twice: dual membership without a shared
 * identity is two people as far as this device can tell.
 *
 * "This body" metrics do not use this key. They count roster rows.
 */
export function rollupIdentityKey(
  person: Pick<Person, 'id' | 'email' | 'cardUid' | 'enrolledAt'>,
): string {
  const email = person.email.trim().toLowerCase();
  if (email) return `email:${email}`;
  if (person.cardUid) return `card:${person.cardUid}`;
  return `row:${person.id ?? person.enrolledAt}`;
}

function dedupeByRollupIdentity(people: readonly Person[]): Person[] {
  const seen = new Map<string, Person>();
  for (const person of people) {
    const key = rollupIdentityKey(person);
    if (!seen.has(key)) seen.set(key, person);
  }
  return [...seen.values()];
}

function partitionByBodyId<T extends { bodyId?: number }>(rows: readonly T[]): Map<number, T[]> {
  const groups = new Map<number, T[]>();
  for (const row of rows) {
    const id = typeof row.bodyId === 'number' ? row.bodyId : -1;
    const list = groups.get(id);
    if (list) list.push(row);
    else groups.set(id, [row]);
  }
  return groups;
}

/**
 * Dashboard metrics for a node plus its descendants.
 *
 * Taps are resolved against the roster of the body that recorded them
 * (`tap.bodyId`), never a merged roster — a card enrolled in one body must
 * not identify an unknown tap in another.
 *
 * Unique attendance (per session and for the year) uses `rollupIdentityKey`:
 * email, lowercased, then `cardUid`. Unknown cards are not deduped across
 * bodies. Each body's unidentified taps are counted on their own and then
 * summed ("sum of branch unknowns"), so the same physical card in two bodies
 * stays two unknown-card rows rather than one pooled card.
 */
export function computeRollupDashboardMetrics(
  taps: readonly TapRecord[],
  persons: readonly Person[],
  now: string,
  target: number = DEFAULT_ATTENDANCE_TARGET,
): DashboardMetrics {
  const personsByBody = partitionByBodyId(persons);
  const tapsByBody = partitionByBodyId(taps);
  const bodyIds = new Set<number>([...personsByBody.keys(), ...tapsByBody.keys()]);

  const rosterByBody = new Map<number, RosterIndex>();
  for (const id of bodyIds) {
    rosterByBody.set(id, indexRoster(personsByBody.get(id) ?? []));
  }

  const attended: Person[] = [];
  const ytdTaps: TapRecord[] = [];
  for (const id of bodyIds) {
    const bodyTaps = tapsByBody.get(id) ?? [];
    const ytd = selectYearToDateTaps(bodyTaps, now);
    ytdTaps.push(...ytd);
    attended.push(...distinctStudents(ytd, rosterByBody.get(id) ?? indexRoster([])));
  }

  const enrolledPeople = dedupeByRollupIdentity(persons);
  const enrolledByKey = new Map(
    enrolledPeople.map((person) => [rollupIdentityKey(person), person]),
  );
  const students = dedupeByRollupIdentity(attended).map(
    (person) => enrolledByKey.get(rollupIdentityKey(person)) ?? person,
  );

  const sessions = computeRollupSessionAttendance(ytdTaps, rosterByBody);
  const hasSessions = sessions.length > 0;
  const averageAttendance = hasSessions
    ? sessions.reduce((sum, session) => sum + session.attendance, 0) / sessions.length
    : 0;
  let best: SessionAttendance | null = null;
  for (const session of sessions) {
    if (!best || session.attendance > best.attendance) best = session;
  }
  const latest = hasSessions ? sessions[sessions.length - 1] : null;

  const cards: UnidentifiedCard[] = [];
  let unidentifiedTapCount = 0;
  for (const id of bodyIds) {
    const summary = unidentifiedTaps(
      tapsByBody.get(id) ?? [],
      rosterByBody.get(id) ?? indexRoster([]),
    );
    unidentifiedTapCount += summary.tapCount;
    for (const card of summary.cards) {
      cards.push(id === -1 ? { ...card } : { ...card, bodyId: id });
    }
  }
  cards.sort((a, b) => Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt));

  return {
    computedAt: now,
    ytd: {
      schoolYearStart: schoolYearStart(now),
      sessions,
      sessionsCount: sessions.length,
      hasSessions,
      averageAttendance,
      target,
      percentOfTarget: (averageAttendance / target) * 100,
      latestSession: latest && snapshot(latest),
      bestSession: best && snapshot(best),
      uniqueStudents: students.length,
    },
    gradeBreakdown: gradeBreakdown(students, enrolledPeople, now),
    enrolledStudents: enrolledPeople.length,
    unidentified: {
      tapCount: unidentifiedTapCount,
      cardCount: cards.length,
      cards,
    },
    scope: 'subtree',
  };
}

/**
 * Session attendance across bodies. Students are resolved per body, then
 * deduped with `rollupIdentityKey` so one person at two bodies in the same
 * session counts once. Tap totals are still the sum of every tap.
 */
function computeRollupSessionAttendance(
  taps: readonly TapRecord[],
  rosterByBody: ReadonlyMap<number, RosterIndex>,
): SessionAttendance[] {
  const groups = new Map<string, TapRecord[]>();
  for (const tap of taps) {
    const group = groups.get(tap.sessionId);
    if (group) group.push(tap);
    else groups.set(tap.sessionId, [tap]);
  }

  const sessions = [...groups].map(([sessionId, sessionTaps]) => {
    let startedAt = sessionTaps[0].scannedAt;
    for (const tap of sessionTaps) {
      if (Date.parse(tap.scannedAt) < Date.parse(startedAt)) startedAt = tap.scannedAt;
    }

    const present: Person[] = [];
    const byBody = partitionByBodyId(sessionTaps);
    for (const [bodyId, bodyTaps] of byBody) {
      present.push(
        ...distinctStudents(bodyTaps, rosterByBody.get(bodyId) ?? indexRoster([])),
      );
    }

    return {
      sessionId,
      date: formatSessionDate(startedAt),
      startedAt,
      attendance: dedupeByRollupIdentity(present).length,
      tapCount: sessionTaps.length,
    };
  });

  return sessions.sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
}

/** One row of the class view's per-period table (Design 09 §2). */
export type PeriodBreakdownRow = {
  bodyId: number;
  name: string;
  archived: boolean;
  /** Sessions held this school year. */
  meetingsHeld: number;
  /** Distinct enrolled students present at least once this school year. */
  uniquePresent: number;
  enrolled: number;
  /**
   * Average students present per meeting as a share of the roster, 0–100+.
   * `null` when there is no roster or no meeting yet to divide by.
   */
  averageAttendancePercent: number | null;
};

/**
 * One row per direct child of `parentId`, in `sortOrder`, each computed the
 * way the "This body + descendants" figures are — the child plus its own
 * descendants, with the Design 08 roll-up identity — so the rows use the same
 * rules as the totals above them. Archived children are kept (their history
 * is still in the roll-up) and flagged. Year to date, like every figure on
 * the dashboard. `taps`/`persons` may be the whole subtree's; each row takes
 * only its own bodies' rows.
 */
export function computePeriodBreakdown(
  parentId: number,
  bodies: readonly BodyNode[],
  taps: readonly TapRecord[],
  persons: readonly Person[],
  now: string,
): PeriodBreakdownRow[] {
  const children = bodies
    .filter((body) => body.id !== undefined && body.parentId === parentId)
    .sort(compareSiblingOrder);
  return children.map((child) => {
    const ids = new Set(subtreeBodyIds(child.id as number, bodies));
    const metrics = computeRollupDashboardMetrics(
      taps.filter((tap) => tap.bodyId !== undefined && ids.has(tap.bodyId)),
      persons.filter((person) => person.bodyId !== undefined && ids.has(person.bodyId)),
      now,
    );
    const { ytd, enrolledStudents } = metrics;
    return {
      bodyId: child.id as number,
      name: child.name,
      archived: isArchived(child),
      meetingsHeld: ytd.sessionsCount,
      uniquePresent: ytd.uniqueStudents,
      enrolled: enrolledStudents,
      averageAttendancePercent:
        enrolledStudents > 0 && ytd.hasSessions
          ? (ytd.averageAttendance / enrolledStudents) * 100
          : null,
    };
  });
}
