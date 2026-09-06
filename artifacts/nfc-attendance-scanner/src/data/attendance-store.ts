import Dexie, { type Table } from 'dexie';

export type AttendanceScan = {
  uid: string;
  scannedAt: string;
};

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
const FALLBACK_KEY = 'attendance-scanner-local-scans';
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
const scansTable = database.table<AttendanceScan, string>('scans');
const personsTable = database.table<Person, number>('persons');
const tapsTable = database.table<TapRecord, number>('taps');

function fallbackRead(): AttendanceScan[] {
  try {
    const value = localStorage.getItem(FALLBACK_KEY);
    return value ? (JSON.parse(value) as AttendanceScan[]) : [];
  } catch {
    return [];
  }
}

function fallbackWrite(scans: AttendanceScan[]) {
  try {
    localStorage.setItem(FALLBACK_KEY, JSON.stringify(scans));
  } catch {
    // Persistence is best-effort if browser storage is unavailable.
  }
}

export async function listScans(): Promise<AttendanceScan[]> {
  try {
    return await scansTable.orderBy('scannedAt').reverse().toArray();
  } catch {
    return fallbackRead().sort(
      (a, b) => Date.parse(b.scannedAt) - Date.parse(a.scannedAt),
    );
  }
}

export async function saveScan(scan: AttendanceScan): Promise<void> {
  try {
    await scansTable.put(scan);
  } catch {
    const scans = fallbackRead().filter((item) => item.uid !== scan.uid);
    fallbackWrite([scan, ...scans]);
  }
}

export async function clearScans(): Promise<void> {
  try {
    await scansTable.clear();
  } catch {
    fallbackWrite([]);
  }
}

export async function findPersonByUid(cardUid: string): Promise<Person | undefined> {
  return personsTable.where('cardUid').equals(cardUid).first();
}

export async function listPersons(): Promise<Person[]> {
  return personsTable.orderBy('lastName').toArray();
}

export async function addPerson(person: Omit<Person, 'id'>): Promise<Person> {
  const id = await personsTable.add(person);
  return { ...person, id };
}

export async function updatePerson(
  personId: number,
  changes: Pick<Person, 'firstName' | 'lastName' | 'gradYear' | 'email'>,
): Promise<Person> {
  await personsTable.update(personId, changes);
  const updatedPerson = await personsTable.get(personId);
  if (!updatedPerson) {
    throw new Error('The enrolled person could not be found after updating.');
  }
  return updatedPerson;
}

export async function listTapRecords(): Promise<TapRecord[]> {
  return tapsTable.orderBy('scannedAt').toArray();
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

export async function clearAttendanceSession(): Promise<void> {
  await Promise.all([scansTable.clear(), tapsTable.clear()]);
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