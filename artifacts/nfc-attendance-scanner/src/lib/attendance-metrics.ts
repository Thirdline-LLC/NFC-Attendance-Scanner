import type { Person, TapRecord } from '@/data/attendance-store';
import {
  currentSeniorGradYear,
  deriveGrade,
} from '@/lib/attendance-export';
import { formatSessionDate } from '@/lib/session-formatting';
import {
  rangeContainsDay,
  schoolYearRange,
  schoolYearStart,
  type DateRange,
} from '@/lib/date-range';
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

// Defined beside the range presets, which also start a range on it; kept
// exported from here for the callers that already import it from the metrics.
export { schoolYearStart };

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

/**
 * One meeting (session) inside a range, as the By meeting sheet and the
 * average attendance % count it.
 */
export type RangeMeeting = {
  sessionId: string;
  /** Session-calendar day of the session's earliest tap in the range. */
  date: string;
  /** ISO timestamp of that earliest tap; orders meetings. */
  startedAt: string;
  /** Distinct students present who were on the roster that day. */
  present: number;
  /** The roster as of that meeting day (`isOnRosterAsOf`). */
  rosterSize: number;
};

/** One person's line in a range: the export Summary row. */
export type PersonRangeSummary = {
  person: Person;
  /** Person-clipped meetings they were present at. */
  attended: number;
  /** Meetings in the range on or after the day they joined the roster. */
  held: number;
  /** `attended ÷ held × 100`, or `null` when nothing was held for them. */
  percent: number | null;
  /** Their first and last check-in in the range, ISO, or `null`. */
  firstCheckIn: string | null;
  lastCheckIn: string | null;
};

export type RangeMetrics = {
  range: DateRange;
  /** The taps whose own session day is in the range, oldest first. */
  taps: TapRecord[];
  /** Meetings in the range, oldest first. */
  meetings: RangeMeeting[];
  meetingsHeld: number;
  /**
   * The mean over meetings of `present ÷ roster-as-of-that-day × 100`.
   * Meetings held while the roster was empty cannot be divided and are left
   * out; `null` when there is no meeting to average, or none with a roster.
   */
  averageAttendancePercent: number | null;
  /**
   * Distinct enrolled students with at least one tap in the range. Not
   * clipped by `enrolledAt`: a card enrolled after it was first tapped still
   * counts as having been here.
   */
  uniquePresent: number;
  /** Everyone on the roster now, identity-deduped. */
  enrolled: number;
  /** One per roster identity, by last name then first name. */
  people: PersonRangeSummary[];
};

/**
 * The session-calendar day a person joined this roster: the day of their
 * `enrolledAt`.
 */
export function enrolledDay(person: Pick<Person, 'enrolledAt'>): string {
  return formatSessionDate(person.enrolledAt);
}

/**
 * Whether a person counts in the roster as of a meeting day: they joined on
 * or before it.
 *
 * Limitation: roster removals are hard deletes (`removeStudent`,
 * `removeAlumni`), so a student removed after a meeting is gone from every
 * past meeting's roster too, and a meeting's roster size — and with it the
 * average attendance % — can shift after a removal. There is no `leftAt` to
 * clip by. Additions are exact, because `enrolledAt` is kept.
 */
export function isOnRosterAsOf(person: Pick<Person, 'enrolledAt'>, day: string): boolean {
  return enrolledDay(person) <= day;
}

type RangeIdentity = { key: string; person: Person; joinedDay: string };

function comparePeopleByName(a: Person, b: Person): number {
  return (
    a.lastName.localeCompare(b.lastName, undefined, { sensitivity: 'base' }) ||
    a.firstName.localeCompare(b.firstName, undefined, { sensitivity: 'base' })
  );
}

/**
 * The attendance metrics for one body (`identity: 'row'`) or a body plus its
 * descendants (`identity: 'rollup'`) over a range. The one implementation
 * behind the export Summary and By meeting sheets and the dashboard's
 * per-period table, so the two can never disagree for the same range.
 *
 * Definitions (Design 09 §4, Asher's metrics definition):
 * - **Meetings held** = sessions of the body whose day falls in the range.
 *   Taps are classified by their own session day first and then grouped into
 *   sessions — the rule `selectYearToDateTaps` already uses — so a session
 *   straddling midnight keeps only its in-range taps and all three sheets
 *   are cut from the same taps. A person's meetings held are only those on
 *   or after the day they joined (`enrolledDay`), so a student added
 *   mid-range is not marked absent from meetings before they were on it.
 * - **Present** at a meeting = distinct students who tapped and were on the
 *   roster that day. The same clip as the denominator: a tap credited
 *   retroactively (a card enrolled after the tap) still shows in the
 *   Attendance sheet and in `uniquePresent`, but cannot make a meeting read
 *   5 of 4 or a student 3 of 2.
 * - **Average attendance %** = mean over meetings of
 *   `present ÷ roster-as-of-that-day × 100` (see `isOnRosterAsOf`).
 *
 * `'row'` resolves every tap against the one roster and keys people by
 * roster row. `'rollup'` resolves each tap against its own body's roster and
 * dedupes people with `rollupIdentityKey`, as the roll-up figures do; an
 * identity joins on the earliest `enrolledAt` among its rows.
 */
export function computeRangeMetrics(
  taps: readonly TapRecord[],
  persons: readonly Person[],
  range: DateRange,
  identity: 'row' | 'rollup' = 'row',
): RangeMetrics {
  const keyOf = (person: Person): string =>
    identity === 'rollup' ? rollupIdentityKey(person) : `row:${studentKey(person)}`;

  const identities = new Map<string, RangeIdentity>();
  for (const person of persons) {
    const key = keyOf(person);
    const joinedDay = enrolledDay(person);
    const known = identities.get(key);
    if (!known) identities.set(key, { key, person, joinedDay });
    else if (joinedDay < known.joinedDay) known.joinedDay = joinedDay;
  }

  const singleRoster = indexRoster(persons);
  const rosterByBody = new Map<number, RosterIndex>();
  if (identity === 'rollup') {
    for (const [bodyId, rows] of partitionByBodyId(persons)) {
      rosterByBody.set(bodyId, indexRoster(rows));
    }
  }
  const resolve = (tap: TapRecord): Person | undefined => {
    if (identity === 'row') return resolveTapPerson(tap, singleRoster);
    const roster = rosterByBody.get(typeof tap.bodyId === 'number' ? tap.bodyId : -1);
    return roster ? resolveTapPerson(tap, roster) : undefined;
  };

  const inRange = taps
    .filter((tap) => rangeContainsDay(range, formatSessionDate(tap.scannedAt)))
    .sort((a, b) => Date.parse(a.scannedAt) - Date.parse(b.scannedAt));

  const sessions = new Map<string, { startedAt: string; present: Set<string> }>();
  const checkIns = new Map<string, { first: string; last: string }>();
  for (const tap of inRange) {
    // Oldest first, so the first tap seen for a session is its start.
    let session = sessions.get(tap.sessionId);
    if (!session) {
      session = { startedAt: tap.scannedAt, present: new Set() };
      sessions.set(tap.sessionId, session);
    }
    const person = resolve(tap);
    if (!person) continue;
    const key = keyOf(person);
    session.present.add(key);
    const seen = checkIns.get(key);
    if (!seen) checkIns.set(key, { first: tap.scannedAt, last: tap.scannedAt });
    else seen.last = tap.scannedAt;
  }

  const roster = [...identities.values()];
  const meetings: RangeMeeting[] = [...sessions].map(([sessionId, session]) => {
    const date = formatSessionDate(session.startedAt);
    let present = 0;
    for (const key of session.present) {
      const who = identities.get(key);
      if (who && who.joinedDay <= date) present += 1;
    }
    return {
      sessionId,
      date,
      startedAt: session.startedAt,
      present,
      rosterSize: roster.filter((who) => who.joinedDay <= date).length,
    };
  });

  const divisible = meetings.filter((meeting) => meeting.rosterSize > 0);
  const averageAttendancePercent =
    divisible.length > 0
      ? divisible.reduce((sum, meeting) => sum + meeting.present / meeting.rosterSize, 0) /
          divisible.length *
        100
      : null;

  const people = roster
    .map(({ key, person, joinedDay }): PersonRangeSummary => {
      let held = 0;
      let attended = 0;
      for (const meeting of meetings) {
        if (meeting.date < joinedDay) continue;
        held += 1;
        if (sessions.get(meeting.sessionId)?.present.has(key)) attended += 1;
      }
      const seen = checkIns.get(key);
      return {
        person,
        attended,
        held,
        percent: held > 0 ? (attended / held) * 100 : null,
        firstCheckIn: seen?.first ?? null,
        lastCheckIn: seen?.last ?? null,
      };
    })
    .sort((a, b) => comparePeopleByName(a.person, b.person));

  return {
    range,
    taps: inRange,
    meetings,
    meetingsHeld: meetings.length,
    averageAttendancePercent,
    uniquePresent: checkIns.size,
    enrolled: roster.length,
    people,
  };
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
   * Mean over this school year's meetings of present ÷ roster as of that
   * meeting day, 0–100. `null` when there is no meeting yet, or no roster at
   * any of them.
   */
  averageAttendancePercent: number | null;
};

/**
 * One row per direct child of `parentId`, in `sortOrder`, each the child plus
 * its own descendants with the Design 08 roll-up identity. Archived children
 * are kept (their history is still in the roll-up) and flagged.
 *
 * Computed by `computeRangeMetrics` over `schoolYearRange(now)` — the same
 * helper and the same range the Export dialog's "This school year" uses — so
 * a row here matches that period's exported Summary figures exactly.
 * `taps`/`persons` may be the whole subtree's; each row takes only its own
 * bodies' rows.
 */
export function computePeriodBreakdown(
  parentId: number,
  bodies: readonly BodyNode[],
  taps: readonly TapRecord[],
  persons: readonly Person[],
  now: string,
): PeriodBreakdownRow[] {
  const range = schoolYearRange(now);
  const children = bodies
    .filter((body) => body.id !== undefined && body.parentId === parentId)
    .sort(compareSiblingOrder);
  return children.map((child) => {
    const ids = new Set(subtreeBodyIds(child.id as number, bodies));
    const metrics = computeRangeMetrics(
      taps.filter((tap) => tap.bodyId !== undefined && ids.has(tap.bodyId)),
      persons.filter((person) => person.bodyId !== undefined && ids.has(person.bodyId)),
      range,
      'rollup',
    );
    return {
      bodyId: child.id as number,
      name: child.name,
      archived: isArchived(child),
      meetingsHeld: metrics.meetingsHeld,
      uniquePresent: metrics.uniquePresent,
      enrolled: metrics.enrolled,
      averageAttendancePercent: metrics.averageAttendancePercent,
    };
  });
}
