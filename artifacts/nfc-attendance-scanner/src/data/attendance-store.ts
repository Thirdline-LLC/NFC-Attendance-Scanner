import Dexie from 'dexie';
import { findEmailOwner } from '@/lib/student-email';
import type { ExportDelivery } from '@/lib/workbook-delivery';

export type Person = {
  id?: number;
  cardUid: string;
  firstName: string;
  lastName: string;
  gradYear: number;
  email: string;
  enrolledAt: string;
};

export type TapRecord = {
  id?: number;
  uid: string;
  scannedAt: string;
  personId: number | null;
  sessionId: string;
  counted: boolean;
};

export type ActivityKind =
  | 'export-session'
  | 'export-all'
  | 'remove-student'
  | 'purge-history'
  | 'remove-alumni'
  | 'pin-set'
  | 'pin-changed';

/**
 * One line of the device's activity log. Only counts, timestamps, filenames
 * and delivery: the log records that student data moved or was deleted, never
 * the data itself, so reading the log is not a disclosure.
 */
export type ActivityEntry = {
  id?: number;
  /** ISO timestamp of the action. */
  at: string;
  kind: ActivityKind;
  /** Exports: the name the file was written under. */
  filename?: string;
  /** Exports: which route delivered it. */
  delivery?: ExportDelivery;
  /** Exports, removals and purges: rows involved. */
  taps?: number;
  /** Exports (1 for a session export), removals and purges: sessions involved. */
  sessions?: number;
  /** Removing graduated students: how many. */
  students?: number;
  /** A history purge: the school-year boundary it deleted before, `YYYY-MM-DD`. */
  before?: string;
};

const DATABASE_NAME = 'attendance-scanner-local';
const CURRENT_SESSION_KEY = 'attendance-scanner-current-session';
const SESSION_STARTED_AT_PREFIX = 'attendance-scanner-session-started-at:';
const database = new Dexie(DATABASE_NAME);
database.version(1).stores({ scans: 'uid, scannedAt' });
database.version(2).stores({
  scans: 'uid, scannedAt',
  persons: '++id, &cardUid, lastName, gradYear, enrolledAt',
  taps: '++id, uid, scannedAt, personId',
});
database
  .version(3)
  .stores({
    scans: 'uid, scannedAt',
    persons: '++id, &cardUid, lastName, gradYear, enrolledAt',
    taps:
      '++id, uid, scannedAt, personId, sessionId, counted, [sessionId+uid+counted], [sessionId+counted]',
  })
  .upgrade((transaction) => {
    // `counted` means "this is the tap that counts this card toward this
    // session", which is why `recordSessionTap` sets it on the first tap of a
    // card in a session and on none of the repeats. Migrated rows have to obey
    // the same rule. Stamping every identified tap `true` broke it: a v1/v2
    // database predates sessions entirely, so all of its taps land in the one
    // `'legacy'` session, and a student who tapped at ten meetings arrived
    // there counted ten times over — one card, one session, ten units of
    // attendance. The first tap of each card wins, in primary-key order,
    // which is the order they were recorded in.
    const countedKeys = new Set<string>();

    return transaction
      .table('taps')
      .toCollection()
      .modify((tap: Partial<TapRecord>) => {
        tap.sessionId = tap.sessionId ?? 'legacy';
        // A UID cannot contain a NUL, so the two halves cannot run together.
        const key = `${tap.sessionId}\u0000${tap.uid}`;
        tap.counted =
          typeof tap.counted === 'boolean'
            ? tap.counted
            : typeof tap.personId === 'number' && !countedKeys.has(key);
        // A row that already carried the flag claims the card too, so a
        // migrated tap after it is a repeat rather than a second count.
        if (tap.counted) countedKeys.add(key);
      });
  });
// `counted` is a boolean, and IndexedDB has no boolean key type: the index and
// the two compound indexes v3 declared over it could never hold a single
// entry. They are dropped rather than re-encoded as 0/1 because nothing
// queries them — `countSessionAttendance` walks the `sessionId` index and
// filters in memory — and a declared index that does not exist invites a
// query that would quietly return nothing.
database.version(4).stores({
  scans: 'uid, scannedAt',
  persons: '++id, &cardUid, lastName, gradYear, enrolledAt',
  taps: '++id, uid, scannedAt, personId, sessionId',
});
// Device settings, keyed by name. Not student data and not exported: this is
// how this kiosk is configured, which is why it sits beside the records rather
// than in localStorage — it should survive and be cleared with them.
database.version(5).stores({
  scans: 'uid, scannedAt',
  persons: '++id, &cardUid, lastName, gradYear, enrolledAt',
  taps: '++id, uid, scannedAt, personId, sessionId',
  settings: 'key',
});
// What left the device and what was deleted, as counts, timestamps and
// filenames. A row here never carries a name, an email or a card UID: the log
// exists so a teacher can answer "where did that file go" and "when was that
// student removed" without the answer itself being a disclosure. Kept beside
// the records so it is cleared with them.
database.version(6).stores({
  scans: 'uid, scannedAt',
  persons: '++id, &cardUid, lastName, gradYear, enrolledAt',
  taps: '++id, uid, scannedAt, personId, sessionId',
  settings: 'key',
  activity: '++id, at, kind',
});
// Pre-enrollment rows from a v1/v2 database. Nothing writes here any more —
// the table is kept so `clearAllAttendanceHistory` can still purge what an
// upgraded database carried up, and so the schema versions stay replayable.
const scansTable = database.table<{ uid: string; scannedAt: string }, string>(
  'scans',
);
const personsTable = database.table<Person, number>('persons');
const tapsTable = database.table<TapRecord, number>('taps');
const settingsTable = database.table<{ key: string; value: string }, string>(
  'settings',
);
const activityTable = database.table<ActivityEntry, number>('activity');

export async function findPersonByUid(cardUid: string): Promise<Person | undefined> {
  return personsTable.where('cardUid').equals(cardUid).first();
}

export async function listPersons(): Promise<Person[]> {
  return personsTable.orderBy('lastName').toArray();
}

/**
 * Thrown when a write would give two roster entries the same address. The
 * enrollment form resolves collisions before saving, so reaching this means the
 * store was written to some other way — a second kiosk tab, or a direct call.
 */
export class DuplicateEmailError extends Error {
  constructor(readonly owner: Person) {
    super(
      `${owner.email} already belongs to ${owner.firstName} ${owner.lastName}, class of ${owner.gradYear}.`,
    );
    this.name = 'DuplicateEmailError';
  }
}

/**
 * Guards the roster's one-address-per-student rule. Runs inside the caller's
 * transaction so the check and the write cannot be interleaved with another.
 * `excludeId` lets a student keep their own address while being edited.
 */
async function assertEmailAvailable(
  email: string,
  excludeId?: number,
): Promise<void> {
  // Compared exactly as the enrollment form compares, so the two layers agree
  // on what counts as a duplicate.
  const owner = findEmailOwner(email, await personsTable.toArray(), excludeId);

  if (owner) {
    throw new DuplicateEmailError(owner);
  }
}

export async function addPerson(person: Omit<Person, 'id'>): Promise<Person> {
  return database.transaction('rw', personsTable, async () => {
    await assertEmailAvailable(person.email);
    // A copy, because Dexie stamps the generated key onto the object it is
    // handed. Stamping the caller's object turns an innocent reuse of it —
    // spreading a fixture, retrying a failed save — into an insert carrying
    // somebody else's primary key, which fails as a ConstraintError far from
    // the cause.
    const id = await personsTable.add({ ...person });
    return { ...person, id };
  });
}

export async function updatePerson(
  personId: number,
  changes: Pick<Person, 'firstName' | 'lastName' | 'gradYear' | 'email'>,
): Promise<Person> {
  return database.transaction('rw', personsTable, async () => {
    await assertEmailAvailable(changes.email, personId);
    await personsTable.update(personId, changes);
    const updatedPerson = await personsTable.get(personId);
    if (!updatedPerson) {
      throw new Error('The enrolled person could not be found after updating.');
    }
    return updatedPerson;
  });
}

/**
 * Every tap ever recorded, across every session, oldest first. Starting a new
 * session only rotates the session id (see `startNewSession` in
 * `use-attendance-session.ts`), so this is the whole history a dashboard or
 * export works from, not just the session on screen.
 */
const ATTENDANCE_TARGET_KEY = 'attendance-target';

/**
 * The per-meeting attendance this kiosk is aiming at, used by the dashboard.
 *
 * It is a device setting rather than a constant because one kiosk serves one
 * club: a robotics meeting of twelve and an assembly of two hundred are both
 * doing fine, and a shared number would tell either of them nothing.
 */
export const DEFAULT_ATTENDANCE_TARGET = 50;

/** The widest range worth storing: past this the number is a typo, not a goal. */
export const MIN_ATTENDANCE_TARGET = 1;
export const MAX_ATTENDANCE_TARGET = 10_000;

/** True for a whole number inside the allowed range. */
export function isValidAttendanceTarget(value: number): boolean {
  return (
    Number.isInteger(value) &&
    value >= MIN_ATTENDANCE_TARGET &&
    value <= MAX_ATTENDANCE_TARGET
  );
}

/**
 * The configured target, or the default when none has been set — and also when
 * the stored value cannot be trusted. A dashboard that refuses to render
 * because a settings row was hand-edited would be worse than one showing the
 * default, so a bad value is treated as absent.
 */
export async function getAttendanceTarget(): Promise<number> {
  const row = await settingsTable.get(ATTENDANCE_TARGET_KEY);
  if (!row) return DEFAULT_ATTENDANCE_TARGET;

  const stored = Number(row.value);
  return isValidAttendanceTarget(stored) ? stored : DEFAULT_ATTENDANCE_TARGET;
}

/** Stores a new target. Throws on anything outside the allowed range. */
export async function setAttendanceTarget(target: number): Promise<void> {
  if (!isValidAttendanceTarget(target)) {
    throw new RangeError(
      `An attendance target must be a whole number between ${MIN_ATTENDANCE_TARGET} and ${MAX_ATTENDANCE_TARGET}; got ${target}.`,
    );
  }

  await settingsTable.put({
    key: ATTENDANCE_TARGET_KEY,
    // Stored as text so the row shape stays one type whatever a later setting
    // needs to hold.
    value: String(target),
  });
}

/** What removing a student would take with them. */
export type PersonRemoval = {
  tapCount: number;
  sessionCount: number;
};

/**
 * Every tap that belongs to a student, by either route the app uses to match
 * one: the `personId` stored at scan time, and the card itself.
 *
 * Both are needed. A card tapped before it was enrolled is stored with a null
 * `personId` and is matched to its student retroactively by UID
 * (`resolveTapPerson`), so deleting only the id-matched rows would leave taps
 * that the export and the dashboard still resolve back to a deleted student.
 */
async function tapsBelongingTo(person: Person): Promise<TapRecord[]> {
  const taps = await tapsTable.toArray();

  return taps.filter(
    (tap) =>
      (person.id !== undefined && tap.personId === person.id) ||
      tap.uid === person.cardUid,
  );
}

/** What `deletePerson` would remove, so the operator can be told before asking. */
export async function previewPersonRemoval(
  personId: number,
): Promise<PersonRemoval> {
  const person = await personsTable.get(personId);
  if (!person) return { tapCount: 0, sessionCount: 0 };

  const taps = await tapsBelongingTo(person);

  return {
    tapCount: taps.length,
    sessionCount: new Set(taps.map((tap) => tap.sessionId)).size,
  };
}

/**
 * Removes a student and every tap that resolves to them.
 *
 * The taps go with the record deliberately. Keeping them would leave rows
 * carrying the student's card UID — a stable identifier for a physical card
 * that is still in somebody's wallet — which is not an erasure, only a
 * detached one. The cost is real and the caller has to say so out loud: past
 * sessions lose those check-ins, so the dashboard's year-to-date figures move.
 * `previewPersonRemoval` exists so the operator sees that before deciding.
 *
 * One transaction over both tables: a half-done removal that dropped the
 * person and kept the taps would be the exact state this is meant to prevent.
 */
export async function deletePerson(personId: number): Promise<PersonRemoval> {
  return database.transaction('rw', personsTable, tapsTable, async () => {
    const person = await personsTable.get(personId);
    if (!person) {
      throw new Error(`No enrolled student has id ${personId}.`);
    }

    const taps = await tapsBelongingTo(person);
    const removal = {
      tapCount: taps.length,
      sessionCount: new Set(taps.map((tap) => tap.sessionId)).size,
    };

    await tapsTable.bulkDelete(
      taps.map((tap) => tap.id).filter((id): id is number => id !== undefined),
    );
    await personsTable.delete(personId);

    return removal;
  });
}

export async function listTapRecords(): Promise<TapRecord[]> {
  return tapsTable.orderBy('scannedAt').toArray();
}

/**
 * Every session id present in the taps table, once each, ordered by each
 * session's earliest tap (oldest session first). Session ids are random UUIDs,
 * so sorting them lexically would tell a reader nothing; chronological order is
 * what a "recent sessions" list wants. Walks the `scannedAt` index instead of
 * loading every tap, since history is retained indefinitely.
 */
// Nothing calls this yet: the dashboard derives its sessions from the taps it
// already reads. Kept because it is the cheap way to ask "which sessions exist"
// without loading every tap, and it is covered by tests.
export async function listSessionIds(): Promise<string[]> {
  // A Set keeps insertion order, which here is first-tap order.
  const sessionIds = new Set<string>();
  await tapsTable.orderBy('scannedAt').each((tap) => {
    sessionIds.add(tap.sessionId);
  });
  return [...sessionIds];
}

export async function listSessionTapRecords(sessionId: string): Promise<TapRecord[]> {
  return tapsTable.where('sessionId').equals(sessionId).sortBy('scannedAt');
}

export async function countSessionAttendance(sessionId: string): Promise<number> {
  return tapsTable
    .where('sessionId')
    .equals(sessionId)
    .filter((tap) => tap.counted)
    .count();
}

export async function recordSessionTap(input: {
  sessionId: string;
  uid: string;
  scannedAt: string;
  personId: number | null;
}): Promise<{
  tap: TapRecord;
  priorCounted: boolean;
  /** When this card was actually counted, for a repeat tap to report. */
  priorCountedAt: string | null;
  attendanceCount: number;
}> {
  return database.transaction('rw', tapsTable, async () => {
    const prior = await tapsTable
      .where('sessionId')
      .equals(input.sessionId)
      .filter((tap) => tap.uid === input.uid && tap.counted)
      .first();
    const counted = input.personId !== null && !prior;
    const tap = { ...input, counted };
    const id = await tapsTable.add(tap);
    const attendanceCount = await countSessionAttendance(input.sessionId);

    return {
      tap: { ...tap, id },
      priorCounted: Boolean(prior),
      priorCountedAt: prior?.scannedAt ?? null,
      attendanceCount,
    };
  });
}

/**
 * Destructive: deletes every tap ever recorded, plus the pre-enrollment
 * `scans` table, in one transaction so a failure part-way cannot leave half
 * the history behind. The roster (`persons`) is deliberately untouched — a
 * card's identity outlives its attendance record. Nothing in the UI calls this
 * yet; it exists for a confirmed "delete all attendance history" action, never
 * for starting a session, which only rotates the session id.
 */
export async function clearAllAttendanceHistory(): Promise<void> {
  await database.transaction('rw', scansTable, tapsTable, async () => {
    await scansTable.clear();
    await tapsTable.clear();
  });
}

/**
 * Rows the activity log keeps before the oldest are dropped. Five hundred is
 * years of a club's exports and removals; the cap exists so the log cannot
 * grow without bound, not to forget anything a teacher would ask about.
 */
export const ACTIVITY_LOG_CAP = 500;

/**
 * Appends one row and trims the oldest beyond the cap, in one transaction so
 * a failure part-way cannot leave the log over the cap or missing the row that
 * was just added. `cap` is injectable for tests; production always uses the
 * constant.
 */
export async function recordActivity(
  entry: Omit<ActivityEntry, 'id'>,
  cap = ACTIVITY_LOG_CAP,
): Promise<void> {
  await database.transaction('rw', activityTable, async () => {
    // A copy, for the same reason `addPerson` copies: Dexie stamps the key
    // onto the object it is handed.
    await activityTable.add({ ...entry });
    const count = await activityTable.count();
    if (count > cap) {
      const stale = await activityTable
        .orderBy('at')
        .limit(count - cap)
        .primaryKeys();
      await activityTable.bulkDelete(stale);
    }
  });
}

/** The most recent rows, newest first. */
export async function listActivity(limit = 50): Promise<ActivityEntry[]> {
  return activityTable.orderBy('at').reverse().limit(limit).toArray();
}

function makeSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function getOrCreateSessionId(): string {
  try {
    const currentSession = localStorage.getItem(CURRENT_SESSION_KEY);
    if (currentSession) return currentSession;

    const sessionId = makeSessionId();
    localStorage.setItem(CURRENT_SESSION_KEY, sessionId);
    return sessionId;
  } catch {
    return makeSessionId();
  }
}

/**
 * Keeps a readable start time for a session that has not received a tap yet.
 * Once a session has taps, the scanner uses the earliest tap as its meeting
 * time, which is also what the dashboard and export data can identify.
 */
export function getOrCreateSessionStartedAt(sessionId: string): string {
  const storageKey = `${SESSION_STARTED_AT_PREFIX}${sessionId}`;

  try {
    const stored = localStorage.getItem(storageKey);
    if (stored && !Number.isNaN(Date.parse(stored))) return stored;

    const startedAt = new Date().toISOString();
    localStorage.setItem(storageKey, startedAt);
    return startedAt;
  } catch {
    return new Date().toISOString();
  }
}

export function createNewSessionId(): string {
  const sessionId = makeSessionId();
  try {
    localStorage.setItem(CURRENT_SESSION_KEY, sessionId);
  } catch {
    // The current session remains usable if localStorage is unavailable.
  }
  return sessionId;
}
