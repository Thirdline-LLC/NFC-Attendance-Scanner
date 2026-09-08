import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import * as XLSX from 'xlsx';

import type { AttendanceWorkbook } from '@/lib/attendance-export';
import {
  ExportCancelledError,
  getDesktopBridge,
} from '@/platform/desktop-bridge';

/**
 * How the workbook reached the operator.
 *
 * - `download` — handed to the browser, which decides where it goes. Nothing
 *   confirms it landed; see the caveat on `deliverWorkbook`.
 * - `file` — written to the device and offered to the share sheet. The write
 *   is confirmed, so this is the only path that can promise the file exists.
 * - `saved` — written to a location the operator chose in a native Save
 *   dialog, and confirmed on disk by the desktop shell. Confirmed like `file`,
 *   but it can also say exactly where the file is.
 */
export type ExportDelivery = 'download' | 'file' | 'saved';

export type DeliveredExport = {
  filename: string;
  delivery: ExportDelivery;
  /** Where the file actually landed. Native and desktop only; a download cannot say. */
  uri?: string;
};

const MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * The last segment of a saved path.
 *
 * The desktop Save dialog lets the operator rename the file, so the name we
 * suggested and the name on disk are not the same string. Both separators are
 * handled because the path is whatever the host handed back, not something
 * this module constructed.
 */
function basename(filePath: string): string {
  const segments = filePath.split(/[\\/]/);
  return segments[segments.length - 1] || filePath;
}

/** The bytes, base64-encoded, which is what both bridges carry. */
function encodeWorkbook(workbook: XLSX.WorkBook): string {
  return XLSX.write(workbook, {
    bookType: 'xlsx',
    type: 'base64',
    compression: true,
  });
}

/**
 * Hands a built workbook to whatever platform the app is running on.
 *
 * Three routes, and they promise deliberately different things:
 *
 * In a browser, `XLSX.writeFile` makes a Blob, points a synthetic `<a download>`
 * at it and clicks it. That reports nothing back — no callback, no promise, no
 * throw — so a host that ignores the click is indistinguishable here from a
 * file that saved. It is why this branch cannot promise anything stronger than
 * "handed over".
 *
 * On a device the bytes are written with the Filesystem plugin instead, to the
 * app's Documents directory, and the resulting file is offered to the share
 * sheet so it can leave the device. The write is awaited, so a failure here is
 * a real failure and is thrown.
 *
 * In the desktop app the operator picks the destination in a native Save
 * dialog and the main process confirms the file's size before answering, so
 * this branch can name the path. Closing that dialog throws
 * `ExportCancelledError`, which callers must not present as a failure: nothing
 * went wrong and there is nothing to retry.
 *
 * A cancelled *share* is a different thing and is deliberately NOT a failure:
 * the file is already on disk by then, and telling the operator their export
 * failed because they dismissed a sheet would be false — and would push them
 * to export again.
 */
export async function deliverWorkbook({
  filename,
  workbook,
}: AttendanceWorkbook): Promise<DeliveredExport> {
  // Checked before Capacitor: the desktop bridge is the more specific shell,
  // and `Capacitor.isNativePlatform()` is false inside Electron anyway.
  const desktop = getDesktopBridge();

  if (desktop) {
    const result = await desktop.saveWorkbook({
      filename,
      base64: encodeWorkbook(workbook),
    });

    if (result.status === 'cancelled') throw new ExportCancelledError();
    if (result.status === 'failed') throw new Error(result.message);

    // The name that came back, not the one we asked for. Naming the file is
    // the whole point of the success notice -- it is what the operator will go
    // looking for -- and a notice reading "Saved attendance-2026-09-15….xlsx
    // to /Users/teacher/Desktop/September meeting.xlsx" names a file that was
    // never created.
    return {
      filename: basename(result.path),
      delivery: 'saved',
      uri: result.path,
    };
  }

  if (!Capacitor.isNativePlatform()) {
    XLSX.writeFile(workbook, filename, {
      bookType: 'xlsx',
      compression: true,
    });
    return { filename, delivery: 'download' };
  }

  // `base64` because that is what Filesystem.writeFile takes for binary data;
  // going through a string avoids a Blob the WebView bridge cannot carry.
  const { uri } = await Filesystem.writeFile({
    path: filename,
    data: encodeWorkbook(workbook),
    directory: Directory.Documents,
    recursive: true,
  });

  try {
    if ((await Share.canShare()).value) {
      await Share.share({
        title: 'Attendance export',
        // `text` is what a mail or messaging target prefills; the file is the
        // payload either way.
        text: `Attendance export ${filename}`,
        files: [uri],
      });
    }
  } catch {
    // Dismissing the sheet rejects. The file is already written, and the
    // notice names where it is, so there is nothing to report and nothing to
    // retry.
  }

  return { filename, delivery: 'file', uri };
}
