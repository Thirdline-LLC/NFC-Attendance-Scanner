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
};

const DATABASE_NAME = 'attendance-scanner-local';
const FALLBACK_KEY = 'attendance-scanner-local-scans';
const database = new Dexie(DATABASE_NAME);
database.version(1).stores({ scans: 'uid, scannedAt' });
database.version(2).stores({
  scans: 'uid, scannedAt',
  persons: '++id, &cardUid, lastName, gradYear, enrolledAt',
  taps: '++id, uid, scannedAt, personId',
});
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

export async function listTapRecords(): Promise<TapRecord[]> {
  return tapsTable.orderBy('scannedAt').toArray();
}

export async function recordTap(tap: Omit<TapRecord, 'id'>): Promise<TapRecord> {
  const id = await tapsTable.add(tap);
  return { ...tap, id };
}

export async function clearAttendanceSession(): Promise<void> {
  await Promise.all([scansTable.clear(), tapsTable.clear()]);
}