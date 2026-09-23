import Dexie from 'dexie';
import { maskCardUid } from '@/lib/scan-format';
import { findEmailOwner } from '@/lib/student-email';
import type { ExportDelivery } from '@/lib/workbook-delivery';

export type Person = {
  id?: number;
  /**
   * The card this student taps with, or absent when they have none yet.
   *
   * Absent rather than an empty string: `persons` indexes `cardUid` as
   * unique, and IndexedDB skips a record whose key path does not evaluate, so
   * any number of card-less students coexist while two students still cannot
   * share a card. An empty string is a key like any other, and the second
   * card-less student would have collided with the first.
   *
   * A whole class can be pre-enrolled this way from a roster workbook and
   * bound to their cards one tap at a time at the kiosk.
   */
  cardUid?: string;
  firstName: string;
  lastName: string;
  gradYear: number;
  email: string;
  enrolledAt: string;
  /**
   * Which `AttendanceBody` owns this roster row. Optional on the type — not
   * on the row — so the many pure functions and fixtures that build a
   * `Person` without caring which body it belongs to (metrics, exports,
   * roster formatting) don't have to fabricate one; the store itself always
   * stamps it on write and filters by it on read.
   */
  bodyId?: number;
};

/**
 * A student who taps with a card — what enrolling at the scanner produces,
 * and what everything downstream of a tap is working with.
 */
export type BoundPerson = Person & { cardUid: string };

/** A student who has been enrolled but has no card on this device yet. */
export function isUnbound(person: Person): boolean {
  return !person.cardUid;
}

export type TapRecord = {
  id?: number;
  uid: string;
  scannedAt: string;
  personId: number | null;
  sessionId: string;
  counted: boolean;
  /** Which `AttendanceBody` this tap's history belongs to. See `Person.bodyId`. */
  bodyId?: number;
};

/**
 * A class, club, faculty group, or other entity a kiosk can attach to. Each
 * one owns its own roster and tap history (D-T2); the device merely points
 * `settings.activeBodyId` at whichever one it is currently scanning for.
 */
export type AttendanceBody = {
  id?: number;
  name: string;
  typeLabel: string;
  createdAt: string;
};

export type ActivityKind =
  | 'export-session'
  | 'export-all'
  | 'export-roster'
  | 'import-roster'
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
  /** Removing graduated students, or exporting the roster: how many. */
  students?: number;
  /** A roster import: students the file created, changed, left alone, refused. */
  added?: number;
  updated?: number;
  skipped?: number;
  rejected?: number;
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
const ACTIVE_BODY_ID_KEY = 'active-body-id';
// Every version 1-6 database was implicitly one club's roster and history.
// `bodies` makes that explicit (D-T2): the upgrader creates the one body
// that database already was, points every existing person and tap at it, and
// attaches the device to it, so nothing already on disk is orphaned or
// re-homed by the schema change.
database
  .version(7)
  .stores({
    scans: 'uid, scannedAt',
    persons: '++id, &cardUid, lastName, gradYear, enrolledAt, bodyId',
    taps: '++id, uid, scannedAt, personId, sessionId, bodyId',
    settings: 'key',
    activity: '++id, at, kind',
    bodies: '++id, createdAt',
  })
  .upgrade(async (transaction) => {
    const bodyId = await transaction.table('bodies').add({
      name: 'Club',
      typeLabel: 'club',
      createdAt: new Date().toISOString(),
    });
    await transaction
      .table('persons')
      .toCollection()
      .modify((person: Person) => {
        person.bodyId = bodyId;
      });
    await transaction
      .table('taps')
      .toCollection()
      .modify((tap: TapRecord) => {
        tap.bodyId = bodyId;
      });
    await transaction.table('settings').put({
      key: ACTIVE_BODY_ID_KEY,
      value: String(bodyId),
    });
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
const bodiesTable = database.table<AttendanceBody, number>('bodies');

/**
 * The card is a globally unique index, so at most one row can match — but a
 * card enrolled under a different body is not this device's roster right
 * now, so a match outside the active body is treated as no match (D-T2:
 * "desk cannot switch bodies").
 */
export async function findPersonByUid(cardUid: string): Promise<Person | undefined> {
  const bodyId = await getActiveBodyId();
  const person = await personsTable.where('cardUid').equals(cardUid).first();
  return person?.bodyId === bodyId ? person : undefined;
}

export async function listPersons(): Promise<Person[]> {
  const bodyId = await getActiveBodyId();
  return personsTable.where('bodyId').equals(bodyId).sortBy('lastName');
}

/**
 * The pre-enrolled students who have no card yet, by last name. These are the
 * only people an unrecognized card at the kiosk may be bound to: everyone else
 * already taps with a card of their own.
 */
export async function listUnboundPersons(): Promise<Person[]> {
  return (await listPersons()).filter(isUnbound);
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
 * Guards the roster's one-address-per-student rule, scoped to one body: each
 * `AttendanceBody` owns its own roster (D-T2), so the same address may belong
 * to a student in one body and a different student in another. Runs inside
 * the caller's transaction so the check and the write cannot be interleaved
 * with another. `excludeId` lets a student keep their own address while being
 * edited.
 */
async function assertEmailAvailable(
  email: string,
  bodyId: number,
  excludeId?: number,
): Promise<void> {
  // Compared exactly as the enrollment form compares, so the two layers agree
  // on what counts as a duplicate.
  const roster = await personsTable.where('bodyId').equals(bodyId).toArray();
  const owner = findEmailOwner(email, roster, excludeId);

  if (owner) {
    throw new DuplicateEmailError(owner);
  }
}

/**
 * Generic in what it is handed so the result keeps it: enrolling a card comes
 * back as a student who certainly has one, while a roster row with no card
 * comes back without. Callers that only need a `Person` are unaffected.
 *
 * Always adds to the active body's roster (D-T2) — callers never choose a
 * body, which is the whole point of "the device attaches to one body".
 */
export async function addPerson<T extends Omit<Person, 'id' | 'bodyId'>>(
  person: T,
): Promise<T & { id: number; bodyId: number }> {
  const bodyId = await getActiveBodyId();
  return database.transaction('rw', personsTable, async () => {
    await assertEmailAvailable(person.email, bodyId);
    // A copy, because Dexie stamps the generated key onto the object it is
    // handed. Stamping the caller's object turns an innocent reuse of it —
    // spreading a fixture, retrying a failed save — into an insert carrying
    // somebody else's primary key, which fails as a ConstraintError far from
    // the cause.
    const record = { ...person, bodyId };
    const id = await personsTable.add({ ...record });
    return { ...record, id };
  });
}

export async function updatePerson(
  personId: number,
  changes: Pick<Person, 'firstName' | 'lastName' | 'gradYear' | 'email'>,
): Promise<Person> {
  return database.transaction('rw', personsTable, async () => {
    const existing = await personsTable.get(personId);
    if (!existing) {
      throw new Error(`No enrolled student has id ${personId}.`);
    }
    await assertEmailAvailable(changes.email, existing.bodyId as number, personId);
    await personsTable.update(personId, changes);
    const updatedPerson = await personsTable.get(personId);
    if (!updatedPerson) {
      throw new Error('The enrolled person could not be found after updating.');
    }
    return updatedPerson;
  });
}

/**
 * Thrown when the student picked for an unrecognized card already taps with a
 * different one. Binding anyway would silently retire a card that is still in
 * somebody's wallet and still resolves their past taps, so the write refuses
 * and the operator is told whose card is already on file.
 */
export class CardAlreadyBoundError extends Error {
  constructor(readonly person: Person) {
    super(
      `${person.firstName} ${person.lastName} already taps with card ${maskCardUid(person.cardUid ?? '')}. Remove that card first if it has been replaced.`,
    );
    this.name = 'CardAlreadyBoundError';
  }
}

/** Thrown when the card being bound already belongs to another student. */
export class CardTakenError extends Error {
  constructor(readonly owner: Person) {
    super(
      `That card already belongs to ${owner.firstName} ${owner.lastName}, class of ${owner.gradYear}.`,
    );
    this.name = 'CardTakenError';
  }
}

/** What binding a card did, for the kiosk to report and re-render from. */
export type CardBinding = {
  person: Person;
  /** True when the binding also counted this card's tap for the session. */
  countedThisSession: boolean;
  attendanceCount: number;
};

/**
 * Links an unrecognized card to a pre-enrolled student who has none.
 *
 * The card has usually just been tapped, and that tap is already stored as an
 * unknown card: uncounted, with a null `personId`. So the binding also claims
 * this session's taps of that card, counting the first of them the way
 * `recordSessionTap` would have if the student had been recognised — otherwise
 * the student stands at the desk having tapped, bound and still not been
 * counted. Earlier sessions are deliberately left alone: their taps resolve to
 * the student through `resolveTapPerson` either way, and re-counting them
 * would move attendance figures for meetings that are already reported.
 *
 * One transaction over both tables, and both refusals happen inside it, so a
 * second tab cannot bind the same card between the check and the write.
 */
export async function bindCardToPerson(input: {
  personId: number;
  cardUid: string;
  sessionId: string;
}): Promise<CardBinding> {
  return database.transaction('rw', personsTable, tapsTable, async () => {
    const person = await personsTable.get(input.personId);
    if (!person) {
      throw new Error(`No enrolled student has id ${input.personId}.`);
    }
    if (person.cardUid && person.cardUid !== input.cardUid) {
      throw new CardAlreadyBoundError(person);
    }

    const owner = await personsTable
      .where('cardUid')
      .equals(input.cardUid)
      .first();
    if (owner && owner.id !== input.personId) {
      throw new CardTakenError(owner);
    }

    await personsTable.update(input.personId, { cardUid: input.cardUid });

    const sessionTaps = (
      await tapsTable.where('sessionId').equals(input.sessionId).toArray()
    )
      .filter((tap) => tap.uid === input.cardUid && tap.id !== undefined)
      .sort((a, b) => Date.parse(a.scannedAt) - Date.parse(b.scannedAt));
    // One count per card per session is the rule `recordSessionTap` keeps, so
    // a card already counted here — bound, unbound and bound again — gains
    // nothing from being claimed a second time.
    let counted = sessionTaps.some((tap) => tap.counted);
    const countedThisSession = !counted && sessionTaps.length > 0;

    for (const tap of sessionTaps) {
      await tapsTable.update(tap.id as number, {
        personId: input.personId,
        counted: !counted,
      });
      counted = true;
    }

    const bound = await personsTable.get(input.personId);
    if (!bound) {
      throw new Error('The student could not be found after binding the card.');
    }

    return {
      person: bound,
      countedThisSession,
      attendanceCount: await countSessionAttendance(input.sessionId),
    };
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

/**
 * Raw access to the device settings table for modules that own a setting of
 * their own (the teacher PIN). Values are strings; callers encode.
 */
export async function readSetting(key: string): Promise<string | undefined> {
  return (await settingsTable.get(key))?.value;
}

export async function writeSetting(key: string, value: string): Promise<void> {
  await settingsTable.put({ key, value });
}

/** Every body on this device, oldest first. */
export async function listBodies(): Promise<AttendanceBody[]> {
  return bodiesTable.orderBy('createdAt').toArray();
}

/** Creates a body. Does not attach the device to it — call `setActiveBody` too. */
export async function createBody(input: {
  name: string;
  typeLabel: string;
}): Promise<AttendanceBody> {
  const body: Omit<AttendanceBody, 'id'> = {
    ...input,
    createdAt: new Date().toISOString(),
  };
  const id = await bodiesTable.add({ ...body });
  return { ...body, id };
}

/**
 * Points this device's `activeBodyId` at another body. Reassignment only —
 * the previous body's roster and tap history stay exactly where they are
 * (D-T2): nothing here touches `persons` or `taps`.
 */
export async function setActiveBody(bodyId: number): Promise<void> {
  const body = await bodiesTable.get(bodyId);
  if (!body) {
    throw new Error(`No attendance body has id ${bodyId}.`);
  }
  await writeSetting(ACTIVE_BODY_ID_KEY, String(bodyId));
}

/**
 * The id of the body this device is currently attached to.
 *
 * A fresh v1-v6 database is backfilled with exactly one body and this
 * setting during the upgrade to v7, so the fallback path below only matters
 * for a database that somehow lost that setting (a hand-edited `settings`
 * row) or has no body at all yet (a brand-new v7+ database that has never
 * called `createBody`) — both recover into a usable state rather than
 * leaving every body-scoped read and write with nothing to filter on.
 */
export async function getActiveBodyId(): Promise<number> {
  const stored = Number(await readSetting(ACTIVE_BODY_ID_KEY));
  if (Number.isInteger(stored) && (await bodiesTable.get(stored))) {
    return stored;
  }

  const [firstBody] = await listBodies();
  if (firstBody?.id !== undefined) {
    await setActiveBody(firstBody.id);
    return firstBody.id;
  }

  const created = await createBody({ name: 'Club', typeLabel: 'club' });
  await setActiveBody(created.id as number);
  return created.id as number;
}

/** The body this device is currently attached to. */
export async function getActiveBody(): Promise<AttendanceBody> {
  const bodyId = await getActiveBodyId();
  const body = await bodiesTable.get(bodyId);
  if (!body) {
    throw new Error(`Active body ${bodyId} could not be found.`);
  }
  return body;
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

/** What a history purge would take, or took. */
export type HistoryPurge = { tapCount: number; sessionCount: number };

/** What removing the graduated students would take, or took. */
export type AlumniRemoval = { studentCount: number; tapCount: number };

function summarizeTaps(taps: readonly TapRecord[]): HistoryPurge {
  return {
    tapCount: taps.length,
    sessionCount: new Set(taps.map((tap) => tap.sessionId)).size,
  };
}

/**
 * Taps older than a boundary the caller defines. The predicate is handed in
 * rather than a date because "before this school year" is a calendar
 * judgement in Eastern time, which the dashboard already knows how to make;
 * the store only knows timestamps.
 */
export async function previewHistoryPurge(
  isStale: (scannedAt: string) => boolean,
): Promise<HistoryPurge> {
  const bodyId = await getActiveBodyId();
  const taps = (
    await tapsTable.where('bodyId').equals(bodyId).toArray()
  ).filter((tap) => isStale(tap.scannedAt));
  return summarizeTaps(taps);
}

/**
 * Deletes every tap the predicate marks stale, scoped to the active body, and
 * the same rows from the legacy `scans` table — `scans` predates bodies
 * entirely, so it is cleared without regard to which body is active. The
 * roster is untouched: a card's identity outlives its attendance record. One
 * transaction over both tables.
 */
export async function purgeHistoryBefore(
  isStale: (scannedAt: string) => boolean,
): Promise<HistoryPurge> {
  const bodyId = await getActiveBodyId();
  return database.transaction('rw', scansTable, tapsTable, async () => {
    const stale = (
      await tapsTable.where('bodyId').equals(bodyId).toArray()
    ).filter((tap) => isStale(tap.scannedAt));
    await tapsTable.bulkDelete(
      stale.map((tap) => tap.id).filter((id): id is number => id !== undefined),
    );
    const staleScans = (await scansTable.toArray()).filter((scan) =>
      isStale(scan.scannedAt),
    );
    await scansTable.bulkDelete(staleScans.map((scan) => scan.uid));
    return summarizeTaps(stale);
  });
}

/**
 * The graduates and every tap that resolves to them, by id or by card,
 * scoped to `bodyId`.
 *
 * `bodyId` is a parameter rather than resolved here so that `removeAlumni`
 * can call this from inside its own `personsTable`/`tapsTable` transaction:
 * resolving the active body reads `settings` (and possibly `bodies`), which
 * are not part of that transaction's table set, and Dexie throws
 * `NotFoundError` for a table access outside the ambient transaction's
 * declared tables.
 */
async function alumniWithTaps(
  isAlumni: (person: Person) => boolean,
  bodyId: number,
): Promise<{ alumni: Person[]; taps: TapRecord[] }> {
  const alumni = (
    await personsTable.where('bodyId').equals(bodyId).toArray()
  ).filter(isAlumni);
  const ids = new Set(alumni.map((person) => person.id));
  const cards = new Set(
    alumni
      .map((person) => person.cardUid)
      .filter((cardUid): cardUid is string => cardUid !== undefined),
  );
  const taps = (
    await tapsTable.where('bodyId').equals(bodyId).toArray()
  ).filter(
    (tap) =>
      (tap.personId !== null && ids.has(tap.personId)) || cards.has(tap.uid),
  );
  return { alumni, taps };
}

/**
 * Who would go, and how many taps with them. Grade is a calendar judgement
 * (`deriveGrade` in `attendance-export.ts`), so the caller passes the test.
 */
export async function previewAlumniRemoval(
  isAlumni: (person: Person) => boolean,
): Promise<AlumniRemoval> {
  const { alumni, taps } = await alumniWithTaps(isAlumni, await getActiveBodyId());
  return { studentCount: alumni.length, tapCount: taps.length };
}

/**
 * Removes every graduated student and their taps, exactly as `deletePerson`
 * would one at a time, in one transaction so the roster and the history
 * cannot disagree about who is gone.
 */
export async function removeAlumni(
  isAlumni: (person: Person) => boolean,
): Promise<AlumniRemoval> {
  const bodyId = await getActiveBodyId();
  return database.transaction('rw', personsTable, tapsTable, async () => {
    const { alumni, taps } = await alumniWithTaps(isAlumni, bodyId);
    await tapsTable.bulkDelete(
      taps.map((tap) => tap.id).filter((id): id is number => id !== undefined),
    );
    await personsTable.bulkDelete(
      alumni
        .map((person) => person.id)
        .filter((id): id is number => id !== undefined),
    );
    return { studentCount: alumni.length, tapCount: taps.length };
  });
}

/**
 * One student as a roster workbook describes them. The card column is
 * deliberately not here: the workbook only ever carries a masked tail (see
 * `roster-workbook.ts`), which cannot identify a card, so an import can never
 * bind one. Cards are bound at the kiosk by tapping them.
 */
export type RosterEntry = Pick<
  Person,
  'firstName' | 'lastName' | 'gradYear' | 'email'
>;

/** What an import did, in counts a teacher can read without any PII in them. */
export type RosterImportCounts = {
  /** Students the file created, with no card yet. */
  added: number;
  /** Students already on this device whose details the file changed. */
  updated: number;
  /** Students already on this device that the file matched exactly. */
  skipped: number;
};

/**
 * Applies parsed roster rows to this device's student list.
 *
 * The school email is the identity: a row whose address is already on the
 * device updates that student, and re-importing the same file a second time
 * therefore changes nothing. Names and graduation year are the only fields a
 * row may move.
 *
 * What it never does is touch `cardUid`. A pre-enrollment file lists students,
 * not hardware, and its card column holds masked tails at best, so a row can
 * neither bind a card nor clear one that a student is already tapping with.
 * That is the whole reason this is a separate write rather than a `put`.
 *
 * One transaction: a file that fails half way through leaves the roster as it
 * was, so the operator can fix the sheet and import it again without first
 * working out how far the last attempt got.
 */
export async function applyRosterImport(
  entries: readonly RosterEntry[],
): Promise<RosterImportCounts> {
  const bodyId = await getActiveBodyId();
  return database.transaction('rw', personsTable, async () => {
    const counts: RosterImportCounts = { added: 0, updated: 0, skipped: 0 };
    // Read once and kept in step by hand: `findEmailOwner` is how the rest of
    // the app decides two addresses are the same one, and re-reading the whole
    // table per row would make a class-sized import quadratic. Scoped to the
    // active body — importing a roster only ever touches that body's own
    // students (D-T2).
    const roster = await personsTable.where('bodyId').equals(bodyId).toArray();

    for (const entry of entries) {
      const existing = findEmailOwner(entry.email, roster);

      if (!existing) {
        const person: Omit<Person, 'id'> = {
          ...entry,
          bodyId,
          enrolledAt: new Date().toISOString(),
        };
        const id = await personsTable.add({ ...person });
        roster.push({ ...person, id });
        counts.added += 1;
        continue;
      }

      const changes = {
        firstName: entry.firstName,
        lastName: entry.lastName,
        gradYear: entry.gradYear,
      };
      const unchanged =
        existing.firstName === changes.firstName &&
        existing.lastName === changes.lastName &&
        existing.gradYear === changes.gradYear;

      if (unchanged) {
        counts.skipped += 1;
        continue;
      }

      await personsTable.update(existing.id as number, changes);
      Object.assign(existing, changes);
      counts.updated += 1;
    }

    return counts;
  });
}

export async function listTapRecords(): Promise<TapRecord[]> {
  const bodyId = await getActiveBodyId();
  return tapsTable.where('bodyId').equals(bodyId).sortBy('scannedAt');
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
  const bodyId = await getActiveBodyId();
  // A Set keeps insertion order, which here is first-tap order — `sortBy`
  // reads the whole scoped slice up front rather than walking the index, but
  // the `bodyId` clause already keeps that slice to one body's history.
  const taps = await tapsTable.where('bodyId').equals(bodyId).sortBy('scannedAt');
  const sessionIds = new Set<string>();
  for (const tap of taps) sessionIds.add(tap.sessionId);
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
  const bodyId = await getActiveBodyId();
  return database.transaction('rw', tapsTable, async () => {
    const prior = await tapsTable
      .where('sessionId')
      .equals(input.sessionId)
      .filter((tap) => tap.uid === input.uid && tap.counted)
      .first();
    const counted = input.personId !== null && !prior;
    const tap = { ...input, bodyId, counted };
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
 * Destructive: deletes every tap the active body ever recorded, plus the
 * pre-enrollment `scans` table, in one transaction so a failure part-way
 * cannot leave half the history behind. `scans` predates bodies entirely and
 * is cleared outright; `taps` is scoped so this cannot take another body's
 * history with it (D-T2). The roster (`persons`) is deliberately untouched —
 * a card's identity outlives its attendance record. Nothing in the UI calls
 * this yet; it exists for a confirmed "delete all attendance history"
 * action, never for starting a session, which only rotates the session id.
 */
export async function clearAllAttendanceHistory(): Promise<void> {
  const bodyId = await getActiveBodyId();
  await database.transaction('rw', scansTable, tapsTable, async () => {
    await scansTable.clear();
    const bodyTapIds = await tapsTable.where('bodyId').equals(bodyId).primaryKeys();
    await tapsTable.bulkDelete(bodyTapIds);
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
