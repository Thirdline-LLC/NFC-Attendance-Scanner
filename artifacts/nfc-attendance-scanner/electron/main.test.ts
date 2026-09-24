import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Handler-level coverage for `attendance:save-workbook`, the desktop IPC
 * `deliverWorkbook` sends the roster/template/attendance bytes to.
 * `validation.test.ts` covers `parseSaveRequest` and `saveDialogFilter` in
 * isolation; this file proves `main.ts` actually wires them together —
 * `saveDialogOptions` picks the right Save-dialog filter from the filename,
 * and a malformed request never reaches the dialog at all.
 *
 * `main.ts` imports Electron directly and runs `app.setName` and friends at
 * module load, so it cannot be imported without a fake `electron`. The fake
 * below covers exactly what `main.ts` touches at import time and inside
 * `attendance:save-workbook`; nothing else in the module is exercised here.
 */

// `dialogMock` and `ipcHandlers` are read both inside the `vi.mock('electron', ...)`
// factory (hoisted above this file's imports) and later in the tests below, so
// they are created through `vi.hoisted` rather than a plain module-level const.
const { dialogMock, ipcHandlers } = vi.hoisted(() => ({
  dialogMock: { showSaveDialog: vi.fn() },
  ipcHandlers: new Map<string, (...args: unknown[]) => unknown>(),
}));

vi.mock('electron', () => {
  const app = {
    setName: vi.fn(),
    setPath: vi.fn(),
    getPath: vi.fn((key: string) =>
      key === 'documents' ? '/Users/teacher/Documents' : '/Users/teacher/AppData',
    ),
    isPackaged: true,
    whenReady: vi.fn(() => Promise.resolve()),
    on: vi.fn(),
    quit: vi.fn(),
  };
  const windowInstance = {
    once: vi.fn(),
    show: vi.fn(),
    webContents: { on: vi.fn(), setWindowOpenHandler: vi.fn() },
    loadURL: vi.fn().mockResolvedValue(undefined),
  };
  // A regular function, not an arrow function: `main.ts` calls `new
  // BrowserWindow(...)`, and only a real function can be invoked as a
  // constructor. Returning an object from it is what lets `new` yield
  // `windowInstance` instead of the (irrelevant) `this` the mock created.
  const BrowserWindow = Object.assign(
    vi.fn(function BrowserWindowMock() {
      return windowInstance;
    }),
    { fromWebContents: vi.fn(() => null), getAllWindows: vi.fn(() => []) },
  );
  const ipcMain = {
    handle: vi.fn((channel: string, fn: (...args: unknown[]) => unknown) => {
      ipcHandlers.set(channel, fn);
    }),
  };
  const protocol = { registerSchemesAsPrivileged: vi.fn(), handle: vi.fn() };
  const shell = { showItemInFolder: vi.fn(), openExternal: vi.fn() };
  const session = {
    defaultSession: {
      webRequest: { onHeadersReceived: vi.fn() },
      setPermissionRequestHandler: vi.fn(),
    },
  };

  return { app, BrowserWindow, dialog: dialogMock, ipcMain, protocol, shell, session };
});

vi.mock('node:fs/promises', () => ({
  default: {
    writeFile: vi.fn(),
    stat: vi.fn(),
    readFile: vi.fn(),
  },
}));

// Pulled in by main.ts for the update/in-place-install IPCs, unrelated to the
// save-workbook handler under test here — stubbed so importing main.ts does
// not require the real Electron-independent (but still unrelated) modules.
vi.mock('@workspace/update', () => ({
  runInPlaceInstall: vi.fn(),
  verifySha256: vi.fn(),
}));
vi.mock('./in-place-host', () => ({
  createInPlaceHost: vi.fn(),
  fetchReleaseAssetBytes: vi.fn(),
}));

import fs from 'node:fs/promises';

const writeFile = vi.mocked(fs.writeFile);
const stat = vi.mocked(fs.stat);

/** Well-formed base64: length a multiple of four, alphabet respected. Opens with the zip header, as every xlsx does. */
const VALID_BASE64 = 'UEsDBBQAAAAIAA==';

/** Plain CSV text (the template's header row), base64-encoded. */
const CSV_BASE64 = 'Zmlyc3RfbmFtZSxsYXN0X25hbWUsZ3JhZF95ZWFyLGVtYWlsLGJvZHlfbmFtZSxib2R5X3R5cGUK';

function saveWorkbook(payload: unknown) {
  const handler = ipcHandlers.get('attendance:save-workbook');
  if (!handler) throw new Error('attendance:save-workbook was never registered');
  return handler({ sender: {} }, payload);
}

beforeAll(async () => {
  await import('./main');
  // `app.whenReady().then(...)` registers the ipcMain handlers a microtask
  // after import; wait for that rather than assuming import order flushes it.
  await vi.waitFor(() => {
    if (!ipcHandlers.has('attendance:save-workbook')) {
      throw new Error('handlers not registered yet');
    }
  });
});

beforeEach(() => {
  dialogMock.showSaveDialog.mockReset();
  writeFile.mockReset().mockResolvedValue(undefined);
  stat.mockReset().mockResolvedValue({ size: 4096 } as Awaited<ReturnType<typeof fs.stat>>);
});

describe('the attendance:save-workbook handler', () => {
  it('accepts a roster template xlsx request and offers the Excel filter', async () => {
    dialogMock.showSaveDialog.mockResolvedValue({
      canceled: false,
      filePath: '/Users/teacher/Desktop/tapin-roster-template-robotics-club.xlsx',
    });

    const result = await saveWorkbook({
      filename: 'tapin-roster-template-robotics-club.xlsx',
      base64: VALID_BASE64,
    });

    expect(dialogMock.showSaveDialog).toHaveBeenCalledTimes(1);
    const [options] = dialogMock.showSaveDialog.mock.calls[0];
    expect(options.filters).toEqual([{ name: 'Excel workbook', extensions: ['xlsx'] }]);
    expect(result).toMatchObject({ status: 'saved' });
  });

  it('accepts a roster template csv request and offers the CSV filter', async () => {
    dialogMock.showSaveDialog.mockResolvedValue({
      canceled: false,
      filePath: '/Users/teacher/Desktop/tapin-roster-template-robotics-club.csv',
    });

    const result = await saveWorkbook({
      filename: 'tapin-roster-template-robotics-club.csv',
      base64: CSV_BASE64,
    });

    const [options] = dialogMock.showSaveDialog.mock.calls[0];
    expect(options.filters).toEqual([{ name: 'CSV file', extensions: ['csv'] }]);
    expect(result).toMatchObject({ status: 'saved' });
  });

  it('accepts a roster export request and offers the Excel filter', async () => {
    dialogMock.showSaveDialog.mockResolvedValue({
      canceled: false,
      filePath: '/Users/teacher/Desktop/roster-2026-09-15-20260915T210000Z.xlsx',
    });

    const result = await saveWorkbook({
      filename: 'roster-2026-09-15-20260915T210000Z.xlsx',
      base64: VALID_BASE64,
    });

    const [options] = dialogMock.showSaveDialog.mock.calls[0];
    expect(options.filters).toEqual([{ name: 'Excel workbook', extensions: ['xlsx'] }]);
    expect(result).toMatchObject({ status: 'saved' });
  });

  it('still offers the Excel filter for the attendance export', async () => {
    dialogMock.showSaveDialog.mockResolvedValue({
      canceled: false,
      filePath: '/Users/teacher/Desktop/attendance-2026-09-15-20260915T170000Z.xlsx',
    });

    await saveWorkbook({
      filename: 'attendance-2026-09-15-20260915T170000Z.xlsx',
      base64: VALID_BASE64,
    });

    const [options] = dialogMock.showSaveDialog.mock.calls[0];
    expect(options.filters).toEqual([{ name: 'Excel workbook', extensions: ['xlsx'] }]);
  });

  it('rejects a malformed request before ever opening the Save dialog', async () => {
    const result = await saveWorkbook({
      filename: '../../etc/passwd',
      base64: VALID_BASE64,
    });

    expect(dialogMock.showSaveDialog).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: 'failed',
      message: 'The export request was malformed.',
    });
  });

  it('rejects an unrecognised template slug before opening the Save dialog', async () => {
    const result = await saveWorkbook({
      filename: `tapin-roster-template-${'a'.repeat(65)}.xlsx`,
      base64: VALID_BASE64,
    });

    expect(dialogMock.showSaveDialog).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: 'failed',
      message: 'The export request was malformed.',
    });
  });
});

describe('the attendance:save-workbook handler: contents must match the extension', () => {
  it('rejects an .xlsx whose bytes are not a zip, before the Save dialog opens', async () => {
    const result = await saveWorkbook({
      filename: 'tapin-roster-template-robotics-club.xlsx',
      base64: CSV_BASE64,
    });

    expect(dialogMock.showSaveDialog).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: 'failed',
      message: "The file's contents do not match its file type.",
    });
  });

  it('rejects a .csv carrying zip (xlsx) bytes, before the Save dialog opens', async () => {
    const result = await saveWorkbook({
      filename: 'tapin-roster-template-robotics-club.csv',
      base64: VALID_BASE64,
    });

    expect(dialogMock.showSaveDialog).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: 'failed',
      message: "The file's contents do not match its file type.",
    });
  });

  it('rejects an attendance export whose bytes are not a zip', async () => {
    const result = await saveWorkbook({
      filename: 'attendance-2026-09-15-20260915T170000Z.xlsx',
      base64: CSV_BASE64,
    });

    expect(dialogMock.showSaveDialog).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'failed' });
  });

  it('writes exactly the decoded bytes once the contents match', async () => {
    dialogMock.showSaveDialog.mockResolvedValue({
      canceled: false,
      filePath: '/Users/teacher/Desktop/tapin-roster-template-robotics-club.csv',
    });

    await saveWorkbook({
      filename: 'tapin-roster-template-robotics-club.csv',
      base64: CSV_BASE64,
    });

    expect(writeFile).toHaveBeenCalledTimes(1);
    const [, written] = writeFile.mock.calls[0];
    expect(Buffer.from(written as Buffer).equals(Buffer.from(CSV_BASE64, 'base64'))).toBe(true);
  });
});

describe('the attendance:save-workbook handler: Save dialog title', () => {
  it.each([
    ['tapin-roster-template-robotics-club.xlsx', VALID_BASE64, 'Save roster template'],
    ['tapin-roster-template-robotics-club.csv', CSV_BASE64, 'Save roster template'],
    ['roster-2026-09-15-20260915T210000Z.xlsx', VALID_BASE64, 'Save roster export'],
    ['attendance-2026-09-15-20260915T170000Z.xlsx', VALID_BASE64, 'Save attendance export'],
  ])('titles the dialog for %s as "%s"', async (filename, base64, title) => {
    dialogMock.showSaveDialog.mockResolvedValue({ canceled: true, filePath: undefined });

    await saveWorkbook({ filename, base64 });

    const [options] = dialogMock.showSaveDialog.mock.calls[0];
    expect(options.title).toBe(title);
  });
});
