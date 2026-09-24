import Dexie from 'dexie';
import { maskCardUid } from '@/lib/scan-format';
import { findEmailOwner } from '@/lib/student-email';
import type { ExportDelivery } from '@/lib/workbook-delivery';
import {
  flattenBodyTree,
  isArchived,
  nextSiblingSortOrder,
  wouldCycle,
} from '@/data/body-hierarchy';
import {
  compareBySortOrder,
  missingRequiredFields,
  nextVocabSortOrder,
  sameLabel,
  sanitizeCustomFields,
} from '@/data/body-vocabulary';

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
 * One node in the device-local body tree. The admin chooses the name, the
 * type label, and where the node sits. `typeLabel` is a free string — the
 * product has no club/class/section mode. Each node owns its own roster and
 * tap history (D-T2). The device points `settings.activeBodyId` at exactly
 * one non-archived node, which may be a root or any descendant.
 */
export type AttendanceBody = {
  id?: number;
  name: string;
  /** Admin-defined vocabulary. Any string. Not a product enum. */
  typeLabel: string;
  createdAt: string;
  /** `null` = root. Points at the parent body's id. */
  parentId?: number | null;
  /** Sibling order under the same parent. */
  sortOrder?: number;
  /**
   * Admin-defined key/value bag for this node only. 08a stores the bag;
   * field definitions (BodyFieldDef) are 08b and are not required to write
   * a value. Values are strings.
   */
  customFields?: Record<string, string>;
  /** Soft archive. An archived body cannot become `activeBodyId`. */
  archivedAt?: string | null;
};

/**
 * A hierarchy write that would break the tree (a cycle, a missing parent,
 * an empty name) or the attachment rule (activating an archived body).
 */
export class BodyHierarchyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BodyHierarchyError';
  }
}

/**
 * The admin's saved vocabulary for `AttendanceBody.typeLabel` (08b). A
 * suggestion list, not a closed enum — `typeLabel` on a body stays free
 * text either way (see `createBody`/`renameBody`).
 */
export type BodyTypeDef = {
  id?: number;
  label: string;
  /** Display order in the admin list and the create-form datalist. */
  sortOrder?: number;
};

/**
 * A custom field the admin wants collected on bodies of one type label.
 * `AttendanceBody.customFields` already had a home in 08a; this is what
 * decides which keys the UI offers for a given `typeLabel`, and whether
 * leaving one blank is allowed. Matched to a body by `appliesToTypeLabel`
 * against `typeLabel`, trimmed and case-insensitive (see `body-vocabulary.ts`)
 * — the two are free text kept in step by the UI, not a foreign key.
 */
export type BodyFieldDef = {
  id?: number;
  label: string;
  appliesToTypeLabel: string;
  required: boolean;
  sortOrder?: number;
};

/**
 * A vocabulary write that would break it (an empty or duplicate label, a
 * required custom field left blank).
 */
export class BodyVocabError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BodyVocabError';
  }
}

export type ActivityKind =
  | 'export-session'
  | 'export-all'
  | 'export-roster'
  | 'import-roster'
  | 'remove-student'
  | 'purge-history'
  | 'remove-alumni'
  | 'pin-set'
  | 'pin-changed'
  | 'pin-disabled'
  | 'pin-enabled'
  | 'body-reparent'
  | 'body-archive';

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
    // The card was globally unique through v6, back when the device was
    // implicitly one club. Each body now owns its own roster (D-T2), so two
    // different bodies may enroll the same physical card for two different
    // students — the uniqueness that matters is per body, not per device.
    // Every v1-v6 row lands under the one backfilled body, so this migration
    // cannot introduce a compound-key collision: their cardUids were already
    // globally unique, which is a stronger guarantee than this index needs.
    persons: '++id, &[bodyId+cardUid], lastName, gradYear, enrolledAt, bodyId',
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
// v7 bodies were a flat list. Each one becomes a root (`parentId: null`),
// with `sortOrder` taken from `createdAt` so the old list order survives.
// `activeBodyId` is left alone. Roster rows and taps stay on the same body
// (D-T2) — this migration only describes how those bodies nest.
database
  .version(8)
  .stores({
    scans: 'uid, scannedAt',
    persons: '++id, &[bodyId+cardUid], lastName, gradYear, enrolledAt, bodyId',
    taps: '++id, uid, scannedAt, personId, sessionId, bodyId',
    settings: 'key',
    activity: '++id, at, kind',
    bodies: '++id, parentId, createdAt, sortOrder',
  })
  .upgrade(async (transaction) => {
    const table = transaction.table('bodies');
    const bodies = (await table.toArray()) as AttendanceBody[];
    bodies.sort((a, b) => {
      const created = a.createdAt.localeCompare(b.createdAt);
      if (created !== 0) return created;
      return (a.id ?? 0) - (b.id ?? 0);
    });
    for (let index = 0; index < bodies.length; index += 1) {
      const body = bodies[index];
      if (body.id === undefined) continue;
      await table.update(body.id, { parentId: null, sortOrder: index });
    }
  });
// `BodyTypeDef` and `BodyFieldDef` (08b): the admin's saved vocabulary and
// which custom fields apply to which type label. Neither existed before —
// `typeLabel` was always free text with no saved list of what had been typed.
// Seeded from what the device already has: every distinct `typeLabel` already
// on a body becomes a vocabulary entry, first-appearance order, so an
// upgraded device's picker is not emptier than the bodies already on it.
// `bodyFields` starts empty; nothing on disk before this version can imply a
// field definition.
database
  .version(9)
  .stores({
    scans: 'uid, scannedAt',
    persons: '++id, &[bodyId+cardUid], lastName, gradYear, enrolledAt, bodyId',
    taps: '++id, uid, scannedAt, personId, sessionId, bodyId',
    settings: 'key',
    activity: '++id, at, kind',
    bodies: '++id, parentId, createdAt, sortOrder',
    bodyTypes: '++id, sortOrder',
    // `required` is a boolean and is deliberately not indexed — IndexedDB has
    // no boolean key type, the same reason the v3 `counted` index never held
    // an entry (see the v4 upgrader above). Callers filter it in memory.
    bodyFields: '++id, appliesToTypeLabel, sortOrder',
  })
  .upgrade(async (transaction) => {
    const bodies = (await transaction.table('bodies').toArray()) as AttendanceBody[];
    bodies.sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
    const seen = new Set<string>();
    let sortOrder = 0;
    for (const body of bodies) {
      const label = body.typeLabel.trim();
      const key = label.toLowerCase();
      if (!label || seen.has(key)) continue;
      seen.add(key);
      await transaction.table('bodyTypes').add({ label, sortOrder });
      sortOrder += 1;
    }
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
const bodyTypesTable = database.table<BodyTypeDef, number>('bodyTypes');
const bodyFieldsTable = database.table<BodyFieldDef, number>('bodyFields');

// A brand-new install never runs the v7 `.upgrade()` above — Dexie only
// upgrades a database that already existed at an earlier version. `populate`
// is Dexie's hook for "this database has never existed before", firing once
// inside the same transaction that creates every table, which is why it is
// the one safe place to seed a fresh kiosk's first body: nothing else can be
// racing it, unlike the `getActiveBodyId` fallback below, which several
// concurrent first reads could all reach at once.
database.on('populate', async () => {
  const bodyId = await bodiesTable.add({
    name: 'Club',
    typeLabel: 'club',
    createdAt: new Date().toISOString(),
    parentId: null,
    sortOrder: 0,
  });
  await settingsTable.put({ key: ACTIVE_BODY_ID_KEY, value: String(bodyId) });
  await bodyTypesTable.add({ label: 'club', sortOrder: 0 });
});

/**
 * The card is unique per body (`&[bodyId+cardUid]`), not per device: a
 * different body may enroll the same physical card for a different student,
 * so the lookup is scoped to the active body from the start rather than
 * finding a match and then checking whose it is.
 */
export async function findPersonByUid(cardUid: string): Promise<Person | undefined> {
  const bodyId = await getActiveBodyId();
  return personsTable.where('[bodyId+cardUid]').equals([bodyId, cardUid]).first();
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
  const bodyId = await getActiveBodyId();
  return database.transaction('rw', personsTable, tapsTable, async () => {
    const person = await personsTable.get(input.personId);
    if (!person) {
      throw new Error(`No enrolled student has id ${input.personId}.`);
    }
    if (person.cardUid && person.cardUid !== input.cardUid) {
      throw new CardAlreadyBoundError(person);
    }

    // Scoped to this body: the card index is per body (`&[bodyId+cardUid]`),
    // so a different body may already use this same physical card for one of
    // its own students without conflict, and that ownership is neither this
    // body's business to block on nor to reveal.
    const owner = await personsTable
      .where('[bodyId+cardUid]')
      .equals([bodyId, input.cardUid])
      .first();
    if (owner && owner.id !== input.personId) {
      throw new CardTakenError(owner);
    }

    await personsTable.update(input.personId, { cardUid: input.cardUid });

    const sessionTaps = (
      await tapsTable.where('sessionId').equals(input.sessionId).toArray()
    )
      .filter(
        (tap) =>
          tap.bodyId === bodyId && tap.uid === input.cardUid && tap.id !== undefined,
      )
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
      attendanceCount: await countSessionAttendanceFor(input.sessionId, bodyId),
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

const PIN_REQUIRED_KEY = 'pin-required';

/**
 * Whether the teacher PIN gates the locked routes. Missing — a device that
 * predates this setting, or one whose row was cleared — reads as required:
 * the gate a teacher never opted out of must not go missing under them.
 * Anything other than the literal `'false'` also reads as required, so a
 * corrupted row fails closed rather than open.
 */
export async function getPinRequired(): Promise<boolean> {
  return (await readSetting(PIN_REQUIRED_KEY)) !== 'false';
}

export async function setPinRequired(required: boolean): Promise<void> {
  await writeSetting(PIN_REQUIRED_KEY, required ? 'true' : 'false');
}

/**
 * Every body on this device, in tree order: roots by `sortOrder`, then each
 * node's children by `sortOrder`. Archived nodes stay in the list; they just
 * cannot be activated.
 */
export async function listBodies(): Promise<AttendanceBody[]> {
  const bodies = await bodiesTable.toArray();
  return flattenBodyTree(bodies).map((row) => row.body as AttendanceBody);
}

export type CreateBodyInput = {
  name: string;
  typeLabel: string;
  /** Omit or `null` to create a root. Otherwise the parent body's id. */
  parentId?: number | null;
  customFields?: Record<string, string>;
};

/**
 * Adds `label` to the saved vocabulary if no entry already matches it
 * case-insensitively (see `sameLabel`). Runs inside the caller's transaction,
 * which must declare `bodyTypesTable`. This is how a one-off label typed at
 * create or rename ends up in the admin's list (08b) without a separate save
 * step.
 */
async function ensureBodyType(label: string): Promise<void> {
  const existing = await bodyTypesTable.toArray();
  if (existing.some((def) => sameLabel(def.label, label))) return;
  await bodyTypesTable.add({
    label,
    sortOrder: nextVocabSortOrder(existing),
  });
}

/**
 * Creates a root or a child. Does not attach the device to it — call
 * `setActiveBody` too. Does not copy roster or taps from the parent (D-T2:
 * membership is explicit per body). Depth is not capped. A `typeLabel` not
 * already in the saved vocabulary is added to it (08b) — the vocabulary is a
 * record of labels in use, not a closed set the admin must pre-declare.
 */
export async function createBody(input: CreateBodyInput): Promise<AttendanceBody> {
  const name = input.name.trim();
  const typeLabel = input.typeLabel.trim();
  if (!name || !typeLabel) {
    throw new BodyHierarchyError('A body needs a name and a type label.');
  }
  const parentId = input.parentId ?? null;
  const customFields = input.customFields ?? {};

  return database.transaction(
    'rw',
    bodiesTable,
    bodyTypesTable,
    bodyFieldsTable,
    async () => {
      const bodies = await bodiesTable.toArray();
      if (parentId !== null && !bodies.some((body) => body.id === parentId)) {
        throw new BodyHierarchyError(`No attendance body has id ${parentId}.`);
      }
      const fieldDefs = await bodyFieldsTable.toArray();
      // Restricted to this type's own field defs before the required check:
      // a value the UI collected while a different type label was drafted
      // must not sneak in, or count toward satisfying this type's own
      // required fields.
      const sanitizedFields = sanitizeCustomFields(typeLabel, fieldDefs, customFields);
      const missing = missingRequiredFields(typeLabel, fieldDefs, sanitizedFields);
      if (missing.length > 0) {
        throw new BodyVocabError(
          `${missing.map((field) => field.label).join(', ')} ${missing.length === 1 ? 'is' : 'are'} required for a ${typeLabel}.`,
        );
      }
      const body: Omit<AttendanceBody, 'id'> = {
        name,
        typeLabel,
        createdAt: new Date().toISOString(),
        parentId,
        sortOrder: nextSiblingSortOrder(bodies, parentId),
        ...(Object.keys(sanitizedFields).length > 0 ? { customFields: sanitizedFields } : {}),
      };
      const id = await bodiesTable.add({ ...body });
      await ensureBodyType(typeLabel);
      return { ...body, id };
    },
  );
}

/**
 * Points this device's `activeBodyId` at another body. Any non-archived node
 * is valid — root or descendant. Reassignment only: the previous body's
 * roster and tap history stay exactly where they are (D-T2).
 */
export async function setActiveBody(bodyId: number): Promise<void> {
  const body = await bodiesTable.get(bodyId);
  if (!body) {
    throw new Error(`No attendance body has id ${bodyId}.`);
  }
  if (isArchived(body)) {
    throw new BodyHierarchyError('Archived bodies cannot be the active body.');
  }
  await writeSetting(ACTIVE_BODY_ID_KEY, String(bodyId));
}

/**
 * Renames a body and/or its type label. Does not move roster rows or taps.
 * A `typeLabel` this body did not already have is added to the saved
 * vocabulary the same way `createBody` adds one (08b) — only when it
 * actually changes, so renaming a body's `name` alone never resurrects a
 * vocabulary entry the admin deleted. Refuses to change `typeLabel` onto one
 * that leaves a required field (for the new label) blank — the same rule
 * `createBody` and `updateBodyCustomFields` enforce, checked here too since a
 * type change can retarget which fields are required without customFields
 * itself being touched.
 *
 * `customFields`, when given, is merged over the body's saved fields and
 * validated *and written* in the same transaction as the type change — a
 * type change that needs a new required field is one atomic write, not a
 * "save the field under the old type, then rename" two-step a caller has to
 * sequence for itself (and a UI has to keep its own save button disabled
 * across).
 */
export async function renameBody(
  bodyId: number,
  input: { name: string; typeLabel: string; customFields?: Record<string, string> },
): Promise<AttendanceBody> {
  const name = input.name.trim();
  const typeLabel = input.typeLabel.trim();
  if (!name || !typeLabel) {
    throw new BodyHierarchyError('A body needs a name and a type label.');
  }
  return database.transaction(
    'rw',
    bodiesTable,
    bodyTypesTable,
    bodyFieldsTable,
    async () => {
      const existing = await bodiesTable.get(bodyId);
      if (!existing) {
        throw new BodyHierarchyError(`No attendance body has id ${bodyId}.`);
      }
      const typeChanged = !sameLabel(existing.typeLabel, typeLabel);
      const fieldDefs = await bodyFieldsTable.toArray();
      const changes: Partial<AttendanceBody> = { name, typeLabel };
      let customFields = existing.customFields;
      if (input.customFields) {
        customFields = sanitizeCustomFields(typeLabel, fieldDefs, {
          ...(existing.customFields ?? {}),
          ...input.customFields,
        });
        changes.customFields = customFields;
      }
      if (typeChanged) {
        const missing = missingRequiredFields(typeLabel, fieldDefs, customFields ?? {});
        if (missing.length > 0) {
          throw new BodyVocabError(
            `${missing.map((field) => field.label).join(', ')} ${missing.length === 1 ? 'is' : 'are'} required for a ${typeLabel} — fill it in before changing the type.`,
          );
        }
      }
      await bodiesTable.update(bodyId, changes);
      if (typeChanged) {
        await ensureBodyType(typeLabel);
      }
      return { ...existing, ...changes };
    },
  );
}

/**
 * Moves a body under a new parent, or to the root when `parentId` is null.
 * Refuses a cycle. Does not move or wipe `persons` / `taps`.
 */
export async function reparentBody(bodyId: number, parentId: number | null): Promise<void> {
  let moved = false;
  await database.transaction('rw', bodiesTable, async () => {
    const bodies = await bodiesTable.toArray();
    const body = bodies.find((candidate) => candidate.id === bodyId);
    if (!body) {
      throw new BodyHierarchyError(`No attendance body has id ${bodyId}.`);
    }
    if (parentId !== null && !bodies.some((candidate) => candidate.id === parentId)) {
      throw new BodyHierarchyError(`No attendance body has id ${parentId}.`);
    }
    if (wouldCycle(bodies, bodyId, parentId)) {
      throw new BodyHierarchyError('That move would make a body its own ancestor.');
    }
    if ((body.parentId ?? null) === parentId) return;
    const sortOrder = nextSiblingSortOrder(
      bodies.filter((candidate) => candidate.id !== bodyId),
      parentId,
    );
    await bodiesTable.update(bodyId, { parentId, sortOrder });
    moved = true;
  });
  if (!moved) return;
  try {
    await recordActivity({ at: new Date().toISOString(), kind: 'body-reparent' });
  } catch {
    // The move already landed. A missing log row is not the move failing.
  }
}

/**
 * Soft-archives a body. Its roster and taps stay. The device cannot attach
 * to it until `restoreBody`. The active body cannot be archived — attach
 * somewhere else first so the desk is never left pointing at an archive.
 */
export async function archiveBody(bodyId: number): Promise<void> {
  const body = await bodiesTable.get(bodyId);
  if (!body) {
    throw new BodyHierarchyError(`No attendance body has id ${bodyId}.`);
  }
  if (isArchived(body)) return;
  const activeId = Number(await readSetting(ACTIVE_BODY_ID_KEY));
  if (activeId === bodyId) {
    throw new BodyHierarchyError(
      'The active body cannot be archived. Attach this device to another body first.',
    );
  }
  await bodiesTable.update(bodyId, { archivedAt: new Date().toISOString() });
  try {
    await recordActivity({ at: new Date().toISOString(), kind: 'body-archive' });
  } catch {
    // The archive already landed.
  }
}

/** Clears `archivedAt` so the body can be activated again. */
export async function restoreBody(bodyId: number): Promise<void> {
  const body = await bodiesTable.get(bodyId);
  if (!body) {
    throw new BodyHierarchyError(`No attendance body has id ${bodyId}.`);
  }
  if (!isArchived(body)) return;
  await bodiesTable.update(bodyId, { archivedAt: null });
}

/** The admin's saved type-label vocabulary (08b), in `sortOrder`. */
export async function listBodyTypeDefs(): Promise<BodyTypeDef[]> {
  return (await bodyTypesTable.toArray()).sort(compareBySortOrder);
}

/**
 * Adds a vocabulary entry the admin typed directly (as opposed to the
 * one-off label `createBody`/`renameBody` add on the fly). Refuses a label
 * that already matches one on the list case-insensitively — the whole point
 * of the list is one entry per label a teacher would recognize as the same
 * word.
 */
export async function addBodyTypeDef(label: string): Promise<BodyTypeDef> {
  const trimmed = label.trim();
  if (!trimmed) {
    throw new BodyVocabError('A body type needs a label.');
  }
  return database.transaction('rw', bodyTypesTable, async () => {
    const existing = await bodyTypesTable.toArray();
    if (existing.some((def) => sameLabel(def.label, trimmed))) {
      throw new BodyVocabError(`"${trimmed}" is already in the vocabulary.`);
    }
    const def: Omit<BodyTypeDef, 'id'> = {
      label: trimmed,
      sortOrder: nextVocabSortOrder(existing),
    };
    const id = await bodyTypesTable.add({ ...def });
    return { ...def, id };
  });
}

/**
 * Renames a vocabulary entry, and rewrites every body and field definition
 * that used the old label so neither silently falls off the vocabulary or
 * stops matching its fields. One transaction over all three tables so a
 * failure part-way cannot leave a body pointing at a label nothing owns
 * any more.
 */
export async function renameBodyTypeDef(id: number, label: string): Promise<BodyTypeDef> {
  const trimmed = label.trim();
  if (!trimmed) {
    throw new BodyVocabError('A body type needs a label.');
  }
  return database.transaction(
    'rw',
    bodyTypesTable,
    bodiesTable,
    bodyFieldsTable,
    async () => {
      const existing = await bodyTypesTable.get(id);
      if (!existing) {
        throw new BodyVocabError(`No body type has id ${id}.`);
      }
      const others = (await bodyTypesTable.toArray()).filter((def) => def.id !== id);
      if (others.some((def) => sameLabel(def.label, trimmed))) {
        throw new BodyVocabError(`"${trimmed}" is already in the vocabulary.`);
      }
      const oldLabel = existing.label;
      await bodyTypesTable.update(id, { label: trimmed });

      // Exact comparison, not `sameLabel`: a casing-only change ("club" ->
      // "Club") still needs every body and field def rewritten to the new
      // spelling, or they silently keep the old one while the vocabulary
      // entry itself has moved on.
      if (oldLabel !== trimmed) {
        const bodies = await bodiesTable.toArray();
        for (const body of bodies) {
          if (body.id !== undefined && sameLabel(body.typeLabel, oldLabel)) {
            await bodiesTable.update(body.id, { typeLabel: trimmed });
          }
        }
        const fieldDefs = await bodyFieldsTable.toArray();
        for (const def of fieldDefs) {
          if (def.id !== undefined && sameLabel(def.appliesToTypeLabel, oldLabel)) {
            await bodyFieldsTable.update(def.id, { appliesToTypeLabel: trimmed });
          }
        }
      }

      return { ...existing, label: trimmed };
    },
  );
}

/**
 * Removes a vocabulary entry. Bodies already carrying that label keep it —
 * `typeLabel` is free text, not a foreign key — and field definitions for it
 * still apply to them; only the datalist suggestion and the admin list
 * shrink.
 */
export async function deleteBodyTypeDef(id: number): Promise<void> {
  await bodyTypesTable.delete(id);
}

/** Every custom-field definition (08b), in `sortOrder`. */
export async function listBodyFieldDefs(): Promise<BodyFieldDef[]> {
  return (await bodyFieldsTable.toArray()).sort(compareBySortOrder);
}

export type BodyFieldDefInput = {
  label: string;
  appliesToTypeLabel: string;
  required: boolean;
};

/**
 * True when two field defs would be the same field on the same type label —
 * `sameLabel` on both `label` and `appliesToTypeLabel`. Two field defs with
 * the same label on *different* type labels are fine; one label on the same
 * type twice is not, because `AttendanceBody.customFields` is keyed by
 * label, so the second def could never have a value of its own.
 */
function sameField(
  a: { label: string; appliesToTypeLabel: string },
  b: { label: string; appliesToTypeLabel: string },
): boolean {
  return sameLabel(a.label, b.label) && sameLabel(a.appliesToTypeLabel, b.appliesToTypeLabel);
}

/** Adds a custom-field definition for one type label. */
export async function addBodyFieldDef(input: BodyFieldDefInput): Promise<BodyFieldDef> {
  const label = input.label.trim();
  const appliesToTypeLabel = input.appliesToTypeLabel.trim();
  if (!label || !appliesToTypeLabel) {
    throw new BodyVocabError('A custom field needs a label and a body type.');
  }
  return database.transaction('rw', bodyFieldsTable, async () => {
    const existing = await bodyFieldsTable.toArray();
    if (existing.some((def) => sameField(def, { label, appliesToTypeLabel }))) {
      throw new BodyVocabError(`"${label}" is already a field on ${appliesToTypeLabel}.`);
    }
    const def: Omit<BodyFieldDef, 'id'> = {
      label,
      appliesToTypeLabel,
      required: input.required,
      sortOrder: nextVocabSortOrder(existing),
    };
    const id = await bodyFieldsTable.add({ ...def });
    return { ...def, id };
  });
}

/**
 * Renames a field definition, moves it to another type label, or toggles
 * `required`. A label change rewrites the matching key in `customFields` on
 * every body of the field's (old) type that has a value under the old
 * label — `customFields` is keyed by label, so an unrewritten key would
 * strand that value where nothing can show or edit it again.
 */
export async function updateBodyFieldDef(
  id: number,
  input: BodyFieldDefInput,
): Promise<BodyFieldDef> {
  const label = input.label.trim();
  const appliesToTypeLabel = input.appliesToTypeLabel.trim();
  if (!label || !appliesToTypeLabel) {
    throw new BodyVocabError('A custom field needs a label and a body type.');
  }
  return database.transaction('rw', bodyFieldsTable, bodiesTable, async () => {
    const existing = await bodyFieldsTable.get(id);
    if (!existing) {
      throw new BodyVocabError(`No custom field has id ${id}.`);
    }
    const others = (await bodyFieldsTable.toArray()).filter((def) => def.id !== id);
    if (others.some((def) => sameField(def, { label, appliesToTypeLabel }))) {
      throw new BodyVocabError(`"${label}" is already a field on ${appliesToTypeLabel}.`);
    }
    const changes = { label, appliesToTypeLabel, required: input.required };
    await bodyFieldsTable.update(id, changes);

    // Exact comparison, not `sameLabel`: `customFields` keys are
    // case-sensitive, so a casing-only rename ("Advisor" -> "advisor") still
    // has to migrate the stored key or the old-cased value is stranded under
    // a key nothing reads or shows any more.
    if (label !== existing.label) {
      const bodies = await bodiesTable.toArray();
      for (const body of bodies) {
        if (body.id === undefined) continue;
        if (!sameLabel(body.typeLabel, existing.appliesToTypeLabel)) continue;
        const fields = body.customFields;
        if (!fields || !(existing.label in fields)) continue;
        const { [existing.label]: value, ...rest } = fields;
        await bodiesTable.update(body.id, { customFields: { ...rest, [label]: value } });
      }
    }

    return { ...existing, ...changes };
  });
}

export async function deleteBodyFieldDef(id: number): Promise<void> {
  await bodyFieldsTable.delete(id);
}

/**
 * Writes a body's custom-field values (08a stored the bag; this is the 08b
 * write path with the required-field rule behind it). Refuses to save while
 * a field the vocabulary marks required, for this body's own `typeLabel`, is
 * missing or blank — the same rule the editor UI disables its save button
 * on, enforced here too since the UI is not the only caller.
 */
export async function updateBodyCustomFields(
  bodyId: number,
  customFields: Record<string, string>,
): Promise<AttendanceBody> {
  return database.transaction('rw', bodiesTable, bodyFieldsTable, async () => {
    const body = await bodiesTable.get(bodyId);
    if (!body) {
      throw new BodyHierarchyError(`No attendance body has id ${bodyId}.`);
    }
    const fieldDefs = await bodyFieldsTable.toArray();
    const missing = missingRequiredFields(body.typeLabel, fieldDefs, customFields);
    if (missing.length > 0) {
      throw new BodyVocabError(
        `${missing.map((field) => field.label).join(', ')} ${missing.length === 1 ? 'is' : 'are'} required for a ${body.typeLabel}.`,
      );
    }
    const trimmed = Object.fromEntries(
      Object.entries(customFields)
        .map(([key, value]) => [key, value.trim()] as const)
        .filter(([, value]) => value.length > 0),
    );
    await bodiesTable.update(bodyId, { customFields: trimmed });
    return { ...body, customFields: trimmed };
  });
}

/**
 * The id of the body this device is currently attached to.
 *
 * A fresh v1-v6 database is backfilled with exactly one body during the
 * upgrade to v7, and a brand-new database gets its first body from the
 * `populate` handler above, so the fallback below only matters for a
 * database that somehow lost the setting (a hand-edited `settings` row) —
 * recovering into a usable state rather than leaving every body-scoped read
 * and write with nothing to filter on. It runs inside a transaction and
 * re-checks the setting once inside: several calls can reach the fallback at
 * once (the dashboard alone starts about six body-resolving reads in one
 * `Promise.all`), and without the re-check each one would create its own
 * "Club".
 */
export async function getActiveBodyId(): Promise<number> {
  const stored = Number(await readSetting(ACTIVE_BODY_ID_KEY));
  if (Number.isInteger(stored)) {
    const body = await bodiesTable.get(stored);
    // An archived node cannot stay attached. Fall through and point the
    // device at another non-archived body instead of scanning into an archive.
    if (body && !isArchived(body)) return stored;
  }

  return database.transaction('rw', settingsTable, bodiesTable, async () => {
    const current = Number(await readSetting(ACTIVE_BODY_ID_KEY));
    if (Number.isInteger(current)) {
      const body = await bodiesTable.get(current);
      if (body && !isArchived(body)) return current;
    }

    const firstBody = (await listBodies()).find(
      (body) => body.id !== undefined && !isArchived(body),
    );
    if (firstBody?.id !== undefined) {
      await writeSetting(ACTIVE_BODY_ID_KEY, String(firstBody.id));
      return firstBody.id;
    }

    const createdId = await bodiesTable.add({
      name: 'Club',
      typeLabel: 'club',
      createdAt: new Date().toISOString(),
      parentId: null,
      sortOrder: 0,
    });
    await writeSetting(ACTIVE_BODY_ID_KEY, String(createdId));
    return createdId;
  });
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
 *
 * Scoped to the person's own body: the card index is per body now
 * (`&[bodyId+cardUid]`), so a different body's roster can legitimately use
 * the same physical card for a different student, and an unscoped match by
 * `uid` would delete or count that other body's taps of it.
 */
async function tapsBelongingTo(person: Person): Promise<TapRecord[]> {
  const taps = await tapsTable
    .where('bodyId')
    .equals(person.bodyId as number)
    .toArray();

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
 * Taps whose `bodyId` is in `bodyIds`. Used for "this body + descendants":
 * the caller passes `subtreeBodyIds` and rolls the rows up. This does not
 * change what the scanner records — a tap is still written for `activeBodyId`
 * only.
 */
export async function listTapsForBodies(bodyIds: readonly number[]): Promise<TapRecord[]> {
  if (bodyIds.length === 0) return [];
  return tapsTable.where('bodyId').anyOf([...bodyIds]).sortBy('scannedAt');
}

/** Roster rows whose `bodyId` is in `bodyIds`. Same scope as `listTapsForBodies`. */
export async function listPersonsForBodies(bodyIds: readonly number[]): Promise<Person[]> {
  if (bodyIds.length === 0) return [];
  return personsTable.where('bodyId').anyOf([...bodyIds]).sortBy('lastName');
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

/**
 * Session ids are not unique across bodies — the device never rotates the
 * session id on a switch (D-T2 only promises the roster and history stay
 * put) — so every session-keyed read is scoped to the active body as well,
 * the same way `listPersons`/`listTapRecords` are.
 */
export async function listSessionTapRecords(sessionId: string): Promise<TapRecord[]> {
  const bodyId = await getActiveBodyId();
  return tapsTable
    .where('sessionId')
    .equals(sessionId)
    .filter((tap) => tap.bodyId === bodyId)
    .sortBy('scannedAt');
}

/**
 * `bodyId` is a parameter for the same reason `alumniWithTaps` takes one:
 * `recordSessionTap` and `bindCardToPerson` call this from inside their own
 * `tapsTable`-only transactions, and resolving the active body there would
 * touch `settings`/`bodies`, which are outside that transaction's declared
 * tables.
 */
async function countSessionAttendanceFor(
  sessionId: string,
  bodyId: number,
): Promise<number> {
  return tapsTable
    .where('sessionId')
    .equals(sessionId)
    .filter((tap) => tap.bodyId === bodyId && tap.counted)
    .count();
}

export async function countSessionAttendance(sessionId: string): Promise<number> {
  return countSessionAttendanceFor(sessionId, await getActiveBodyId());
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
      .filter((tap) => tap.bodyId === bodyId && tap.uid === input.uid && tap.counted)
      .first();
    const counted = input.personId !== null && !prior;
    const tap = { ...input, bodyId, counted };
    const id = await tapsTable.add(tap);
    const attendanceCount = await countSessionAttendanceFor(input.sessionId, bodyId);

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
