import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { maskCardUid } from '@/lib/scan-format';
import * as XLSX from 'xlsx';

import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

import {
  ExportCancelledError,
  type DesktopBridge,
} from '@/platform/desktop-bridge';
import { buildAttendanceWorkbook } from './attendance-export';
import { deliverWorkbook } from './workbook-delivery';

// `XLSX.writeFile` is a module export, which ESM will not let vi.spyOn touch —
// and under Node it writes a real .xlsx into the package root, so it has to be
// replaced rather than merely observed.
vi.mock('xlsx', async (importOriginal) => ({
  ...(await importOriginal<typeof import('xlsx')>()),
  writeFile: vi.fn(),
}));

// The Capacitor plugins are lazy proxies: their methods do not exist as own
// properties until the bridge resolves them, so vi.spyOn finds nothing to
// replace. Standing fakes are the only way to observe these.
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: vi.fn(() => false) },
}));
vi.mock('@capacitor/filesystem', () => ({
  Directory: { Documents: 'DOCUMENTS' },
  Filesystem: { writeFile: vi.fn() },
}));
vi.mock('@capacitor/share', () => ({
  Share: { canShare: vi.fn(), share: vi.fn() },
}));

const isNative = vi.mocked(Capacitor.isNativePlatform);
const writeFile = vi.mocked(Filesystem.writeFile);
const canShare = vi.mocked(Share.canShare);
const share = vi.mocked(Share.share);
const browserDownload = vi.mocked(XLSX.writeFile);

const SAVED_URI = 'file:///Documents/attendance-2026-09-06-x.xlsx';
const DEVICE_PERSONS = [
  {
    id: 1,
    cardUid: '04A1B2C3D4E5F6',
    firstName: 'Jordan',
    lastName: 'Lee',
    gradYear: 2027,
    email: 'jlee27@stjohnschs.org',
    enrolledAt: '2026-09-01T10:00:00.000Z',
  },
  {
    id: 2,
    cardUid: '04F6E5D4C3B2A1',
    firstName: 'Priya',
    lastName: 'Nair',
    gradYear: 2028,
    email: 'pnair28@stjohnschs.org',
    enrolledAt: '2026-09-02T10:00:00.000Z',
  },
] as const;
const DEVICE_TAPS = [
  {
    uid: DEVICE_PERSONS[0].cardUid,
    scannedAt: '2026-09-15T16:00:00.000Z',
    personId: DEVICE_PERSONS[0].id,
    sessionId: 'device-check',
    counted: true,
  },
  {
    // A migrated tap has no person id, but its card is now enrolled and must
    // resolve to the current roster entry when the export is built.
    uid: DEVICE_PERSONS[1].cardUid,
    scannedAt: '2026-09-15T16:05:00.000Z',
    personId: null,
    sessionId: 'legacy',
    counted: false,
  },
  {
    uid: '0011223344AABB',
    scannedAt: '2026-09-15T16:10:00.000Z',
    personId: null,
    sessionId: 'device-check',
    counted: false,
  },
] as const;

function aWorkbook() {
  const worksheet = XLSX.utils.json_to_sheet([{ Name: 'Jordan Lee' }]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Attendance');
  return { filename: 'attendance-2026-09-06-x.xlsx', workbook };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('deliverWorkbook in a browser', () => {
  beforeEach(() => {
    isNative.mockReturnValue(false);
  });

  it('hands the workbook to the browser and claims nothing more', async () => {
    const delivered = await deliverWorkbook(aWorkbook());

    expect(browserDownload).toHaveBeenCalledTimes(1);
    expect(writeFile).not.toHaveBeenCalled();
    expect(delivered).toEqual({
      filename: 'attendance-2026-09-06-x.xlsx',
      delivery: 'download',
    });
    // A download reports nothing back, so there is no uri it could promise.
    expect(delivered.uri).toBeUndefined();
  });
});

describe('deliverWorkbook on a device', () => {
  beforeEach(() => {
    isNative.mockReturnValue(true);
    writeFile.mockResolvedValue({ uri: SAVED_URI });
    canShare.mockResolvedValue({ value: true });
    share.mockResolvedValue({ activityType: '' });
  });

  it('writes the file to Documents and offers it to the share sheet', async () => {
    const delivered = await deliverWorkbook(aWorkbook());

    expect(browserDownload).not.toHaveBeenCalled();
    const [written] = writeFile.mock.calls[0];
    expect(written.path).toBe('attendance-2026-09-06-x.xlsx');
    expect(written.directory).toBe(Directory.Documents);
    // base64, because that is what the WebView bridge can carry.
    expect(written.data).toMatch(/^[A-Za-z0-9+/]+=*$/);

    expect(share.mock.calls[0][0].files).toEqual([SAVED_URI]);
    expect(delivered).toEqual({
      filename: 'attendance-2026-09-06-x.xlsx',
      delivery: 'file',
      uri: SAVED_URI,
    });
  });

  it('still reports success when the operator dismisses the share sheet', async () => {
    share.mockRejectedValue(new Error('Share canceled'));

    const delivered = await deliverWorkbook(aWorkbook());

    // The file is on disk by then. Calling that a failed export would be false,
    // and would push the operator into exporting all over again.
    expect(delivered.delivery).toBe('file');
    expect(delivered.uri).toBe(SAVED_URI);
  });

  it('skips the share sheet when the platform has none', async () => {
    canShare.mockResolvedValue({ value: false });

    const delivered = await deliverWorkbook(aWorkbook());

    expect(share).not.toHaveBeenCalled();
    expect(delivered.delivery).toBe('file');
  });

  it('fails loudly when the file cannot be written', async () => {
    writeFile.mockRejectedValue(new Error('no space'));

    // Unlike a download, this failure really is knowable — so it must not be
    // swallowed into a success the operator would go on to trust.
    await expect(deliverWorkbook(aWorkbook())).rejects.toThrow('no space');
  });
});

describe.each(['iOS', 'Android'] as const)(
  'native workbook bytes on %s',
  (platform) => {
    const deviceDocuments = new Map<string, string>();

    beforeEach(() => {
      isNative.mockReturnValue(true);
      canShare.mockResolvedValue({ value: true });
      share.mockResolvedValue({ activityType: '' });
      writeFile.mockImplementation(async ({ path, data }) => {
        deviceDocuments.set(path, data);
        return { uri: `file:///Documents/${path}` };
      });
    });

    it('reopens the saved xlsx with known, migrated, and unknown-card rows', async () => {
      const { filename, workbook } = buildAttendanceWorkbook(
        DEVICE_TAPS,
        DEVICE_PERSONS,
        new Date('2026-09-15T17:00:00.000Z'),
      );

      const delivered = await deliverWorkbook({ filename, workbook });

      expect(delivered.delivery).toBe('file');
      expect(delivered.uri).toBe(`file:///Documents/${filename}`);
      expect(deviceDocuments.has(filename)).toBe(true);

      const savedBase64 = deviceDocuments.get(filename);
      expect(savedBase64).toBeDefined();
      const reopened = XLSX.read(savedBase64, { type: 'base64' });
      const rows = XLSX.utils.sheet_to_json(reopened.Sheets.Attendance, {
        defval: '',
      });

      expect(rows).toEqual([
        {
          Timestamp: '2026-09-15 12:00:00',
          'Card (last 4)': maskCardUid(DEVICE_PERSONS[0].cardUid),
          'Meeting Date': '2026-09-15',
          Name: 'Jordan Lee',
          Email: 'jlee27@stjohnschs.org',
          Grade: '12',
        },
        {
          Timestamp: '2026-09-15 12:05:00',
          'Card (last 4)': maskCardUid(DEVICE_PERSONS[1].cardUid),
          'Meeting Date': '2026-09-15',
          Name: 'Priya Nair',
          Email: 'pnair28@stjohnschs.org',
          Grade: '11',
        },
        {
          Timestamp: '2026-09-15 12:10:00',
          'Card (last 4)': maskCardUid('0011223344AABB'),
          'Meeting Date': '2026-09-15',
          Name: 'Unknown card',
          Email: '',
          Grade: '',
        },
      ]);

      // Keep the target in the test name: Capacitor uses this same native
      // filesystem/share branch on both platforms, while the actual device
      // check is still performed separately on an iPhone and an Android phone.
      expect(platform).toMatch(/iOS|Android/);
    });

    it('keeps the saved workbook available after the share sheet is dismissed', async () => {
      share.mockRejectedValue(new Error('Share canceled'));
      const { filename, workbook } = buildAttendanceWorkbook(
        DEVICE_TAPS,
        DEVICE_PERSONS,
        new Date('2026-09-15T17:00:00.000Z'),
      );

      const delivered = await deliverWorkbook({ filename, workbook });

      expect(delivered.delivery).toBe('file');
      expect(deviceDocuments.get(filename)).toBeDefined();
      expect(
        XLSX.read(deviceDocuments.get(filename)!, { type: 'base64' }).SheetNames,
      ).toEqual(['Attendance']);
    });
  },
);

describe('deliverWorkbook in the desktop app', () => {
  // The bridge the Electron preload exposes. Installed per test so the browser
  // and device suites above keep seeing a window without one.
  function installBridge(saveWorkbook: DesktopBridge['saveWorkbook']) {
    const bridge: DesktopBridge = {
      platform: 'electron',
      saveWorkbook,
      revealWorkbook: vi.fn().mockResolvedValue(true),
      downloadVerifiedAsset: vi.fn().mockResolvedValue({ ok: false, reason: 'invalid-request' }),
      openReleasesPage: vi.fn().mockResolvedValue(true),
    };
    window.attendanceDesktop = bridge;
    return bridge;
  }

  beforeEach(() => {
    // The desktop shell is not a Capacitor platform, and the branch is chosen
    // before that check anyway.
    isNative.mockReturnValue(false);
  });

  afterEach(() => {
    Reflect.deleteProperty(window, 'attendanceDesktop');
  });

  it('sends the bytes to the shell and reports the path it confirmed', async () => {
    const saveWorkbook = vi.fn().mockResolvedValue({
      status: 'saved',
      path: '/Users/teacher/Desktop/attendance-2026-09-06-x.xlsx',
      bytes: 4096,
    });
    installBridge(saveWorkbook);

    const delivered = await deliverWorkbook(aWorkbook());

    // Neither of the other two routes may run.
    expect(browserDownload).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();

    const [request] = saveWorkbook.mock.calls[0];
    expect(request.filename).toBe('attendance-2026-09-06-x.xlsx');
    expect(request.base64).toMatch(/^[A-Za-z0-9+/]+=*$/);

    expect(delivered).toEqual({
      filename: 'attendance-2026-09-06-x.xlsx',
      delivery: 'saved',
      uri: '/Users/teacher/Desktop/attendance-2026-09-06-x.xlsx',
    });
  });

  it('reports the name the operator saved under, not the one we suggested', async () => {
    // The Save dialog lets them rename it. Reporting our suggestion produced a
    // self-contradictory notice — "Saved attendance-….xlsx to
    // /Users/teacher/Desktop/September meeting.xlsx" — naming a file that was
    // never created, which sends a teacher looking for something that is not
    // there and then exporting all over again.
    installBridge(
      vi.fn().mockResolvedValue({
        status: 'saved',
        path: '/Users/teacher/Desktop/September meeting.xlsx',
        bytes: 4096,
      }),
    );

    const delivered = await deliverWorkbook(aWorkbook());

    expect(delivered.filename).toBe('September meeting.xlsx');
    expect(delivered.uri).toBe('/Users/teacher/Desktop/September meeting.xlsx');
  });

  it('throws ExportCancelledError when the Save dialog is closed', async () => {
    installBridge(vi.fn().mockResolvedValue({ status: 'cancelled' }));

    // A distinct type, because the callers have to be able to tell this apart
    // from a failure: nothing went wrong and there is nothing to retry.
    await expect(deliverWorkbook(aWorkbook())).rejects.toBeInstanceOf(
      ExportCancelledError,
    );
  });

  it('throws the shell’s reason when the write fails', async () => {
    installBridge(
      vi.fn().mockResolvedValue({
        status: 'failed',
        message: 'Read-only file system',
      }),
    );

    const failure = deliverWorkbook(aWorkbook());
    await expect(failure).rejects.toThrow('Read-only file system');
    // A failed write is emphatically not a cancellation.
    await expect(failure).rejects.not.toBeInstanceOf(ExportCancelledError);
  });

  it('ignores a window property that is not the real bridge', async () => {
    // Something else on `window.attendanceDesktop` must fall through to the
    // browser download rather than being called as if it were the shell.
    (window as unknown as Record<string, unknown>).attendanceDesktop = {
      platform: 'not-electron',
    };

    const delivered = await deliverWorkbook(aWorkbook());

    expect(delivered.delivery).toBe('download');
    expect(browserDownload).toHaveBeenCalledTimes(1);
  });
});
