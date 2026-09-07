import Dexie from 'dexie';
import { findEmailOwner } from '@/lib/student-email';

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

const DATABASE_NAME = 'attendance-scanner-local';
const CURRENT_SESSION_KEY = 'attendance-scanner-current-session';
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
  .upgrade((transaction) =>
    transaction
      .table('taps')
      .toCollection()
      .modify((tap: Partial<TapRecord>) => {
        tap.sessionId = tap.sessionId ?? 'legacy';
        tap.counted =
          typeof tap.counted === 'boolean'
            ? tap.counted
            : typeof tap.personId === 'number';
      }),
  );
// Pre-enrollment rows from a v1/v2 database. Nothing writes here any more —
// the table is kept so `clearAllAttendanceHistory` can still purge what an
// upgraded database carried up, and so the schema versions stay replayable.
const scansTable = database.table<{ uid: string; scannedAt: string }, string>(
  'scans',
);
const personsTable = database.table<Person, number>('persons');
const tapsTable = database.table<TapRecord, number>('taps');

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
    const id = await personsTable.add(person);
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

export async function recordTap(tap: Omit<TapRecord, 'id'>): Promise<TapRecord> {
  const id = await tapsTable.add(tap);
  return { ...tap, id };
}

export async function recordSessionTap(input: {
  sessionId: string;
  uid: string;
  scannedAt: string;
  personId: number | null;
}): Promise<{
  tap: TapRecord;
  priorCounted: boolean;
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

export function createNewSessionId(): string {
  const sessionId = makeSessionId();
  try {
    localStorage.setItem(CURRENT_SESSION_KEY, sessionId);
  } catch {
    // The current session remains usable if localStorage is unavailable.
  }
  return sessionId;
}