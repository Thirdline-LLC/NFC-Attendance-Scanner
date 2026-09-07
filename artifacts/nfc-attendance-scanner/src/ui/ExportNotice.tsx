import { AlertTriangle, FileSpreadsheet } from 'lucide-react';

import type { DeliveredExport } from '@/lib/workbook-delivery';

/** What the last export attempt did, or null before one has been made. */
export type ExportResult =
  | ({ ok: true } & DeliveredExport)
  | { ok: false }
  | null;

/**
 * Says whether the workbook was actually handed over, and how.
 *
 * The two routes can promise different things, so they must not say the same
 * thing. A native export is written to disk before this renders, so it can
 * state plainly that the file exists and where. A browser download is a
 * synthetic `<a download>` click that reports nothing back — a host that
 * ignores it looks exactly like a file that saved — so that wording stops at
 * "handed over" and tells the operator to go and check.
 *
 * Naming the file is the point in both cases: it is what they will look for.
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
      {result.delivery === 'file' ? (
        <span>
          Saved <strong className="font-semibold">{result.filename}</strong> to
          this device&rsquo;s Documents. Send it somewhere off the device before
          the next session.
        </span>
      ) : (
        <span>
          Handed <strong className="font-semibold">{result.filename}</strong> to
          the browser. Check your downloads — if it is not there, the download
          was blocked and the attendance has not left this device.
        </span>
      )}
    </p>
  );
}
