import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';

import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

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
