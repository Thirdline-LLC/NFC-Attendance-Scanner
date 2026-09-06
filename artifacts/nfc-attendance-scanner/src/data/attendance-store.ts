import Dexie, { type Table } from 'dexie';

export type AttendanceScan = {
  uid: string;
  scannedAt: string;
};

const DATABASE_NAME = 'attendance-scanner-local';
const FALLBACK_KEY = 'attendance-scanner-local-scans';
const database = new Dexie(DATABASE_NAME);
database.version(1).stores({ scans: 'uid, scannedAt' });
const scansTable = database.table<AttendanceScan>('scans') as Table<AttendanceScan, string>;

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