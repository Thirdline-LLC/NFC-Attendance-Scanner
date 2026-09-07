import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import * as XLSX from 'xlsx';

import type { AttendanceWorkbook } from '@/lib/attendance-export';

/**
 * How the workbook reached the operator.
 *
 * - `download` — handed to the browser, which decides where it goes. Nothing
 *   confirms it landed; see the caveat on `deliverWorkbook`.
 * - `file` — written to the device and offered to the share sheet. The write
 *   is confirmed, so this is the only path that can promise the file exists.
 */
export type ExportDelivery = 'download' | 'file';

export type DeliveredExport = {
  filename: string;
  delivery: ExportDelivery;
  /** Where the file actually landed. Native only; a download cannot say. */
  uri?: string;
};

const MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Hands a built workbook to whatever platform the app is running on.
 *
 * In a browser, `XLSX.writeFile` makes a Blob, points a synthetic `<a download>`
 * at it and clicks it. That reports nothing back — no callback, no promise, no
 * throw — so a host that ignores the click is indistinguishable here from a
 * file that saved. That is exactly what a WKWebView is suspected of doing, and
 * it is why this branch cannot promise anything stronger than "handed over".
 *
 * On a device the bytes are written with the Filesystem plugin instead, to the
 * app's Documents directory, and the resulting file is offered to the share
 * sheet so it can leave the device. The write is awaited, so a failure here is
 * a real failure and is thrown.
 *
 * A cancelled share is deliberately NOT a failure: the file is already on disk
 * by then, and telling the operator their export failed because they dismissed
 * a sheet would be false — and would push them to export again.
 */
export async function deliverWorkbook({
  filename,
  workbook,
}: AttendanceWorkbook): Promise<DeliveredExport> {
  if (!Capacitor.isNativePlatform()) {
    XLSX.writeFile(workbook, filename, {
      bookType: 'xlsx',
      compression: true,
    });
    return { filename, delivery: 'download' };
  }

  // `base64` because that is what Filesystem.writeFile takes for binary data;
  // going through a string avoids a Blob the WebView bridge cannot carry.
  const data = XLSX.write(workbook, {
    bookType: 'xlsx',
    type: 'base64',
    compression: true,
  });

  const { uri } = await Filesystem.writeFile({
    path: filename,
    data,
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
