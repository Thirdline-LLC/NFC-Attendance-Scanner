import { AlertTriangle, FileSpreadsheet } from 'lucide-react';

/** What the last export attempt did, or null before one has been made. */
export type ExportResult =
  | { ok: true; filename: string }
  | { ok: false }
  | null;

/**
 * Says whether the workbook was actually handed over.
 *
 * `XLSX.writeFile` builds a Blob behind a synthetic download click, and a
 * click that goes nowhere throws nothing — so without this, a browser that
 * declines the download looks exactly like a successful save. That is the
 * failure mode `docs/capacitor-native.md` warns about inside a WebView, and
 * the export is the system of record: the operator has to be able to tell.
 *
 * Naming the file is the point. It is what they will go looking for, and
 * seeing it is the only confirmation the page can honestly give — the browser
 * decides where it lands, and never tells us.
 */
export function ExportNotice({ result }: { result: ExportResult }) {
  if (!result) return null;

  if (!result.ok) {
    return (
      <p
        className="mt-3 flex items-start gap-2 rounded-xl border border-[hsl(var(--destructive)/.45)] bg-[hsl(var(--destructive)/.08)] px-3 py-2.5 text-xs leading-5 text-[hsl(var(--destructive))]"
        role="alert"
        data-testid="text-export-failed"
      >
        <AlertTriangle aria-hidden="true" size={14} className="mt-0.5 shrink-0" />
        <span>
          <strong className="font-semibold">The export did not run.</strong>{' '}
          Nothing was saved. Try again, and if it keeps failing the attendance
          is still on this device — do not clear the app.
        </span>
      </p>
    );
  }

  return (
    <p
      className="mt-3 flex items-start gap-2 rounded-xl border border-[hsl(var(--accent)/.45)] bg-[hsl(var(--accent)/.08)] px-3 py-2.5 text-xs leading-5 text-[hsl(var(--accent))]"
      role="status"
      data-testid="text-export-saved"
    >
      <FileSpreadsheet aria-hidden="true" size={14} className="mt-0.5 shrink-0" />
      <span>
        Handed <strong className="font-semibold">{result.filename}</strong> to
        the browser. Check your downloads — if it is not there, the download was
        blocked and the attendance has not left this device.
      </span>
    </p>
  );
}
