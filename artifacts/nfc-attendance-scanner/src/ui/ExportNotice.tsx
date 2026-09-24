import { AlertTriangle, FileSpreadsheet, Info } from 'lucide-react';

import type { DeliveredExport } from '@/lib/workbook-delivery';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * What the last export attempt did, or null before one has been made.
 *
 * `cancelled` separates "the operator closed the Save dialog" from "the export
 * broke". Both leave the attendance where it was, but only one of them is
 * something to worry about, and telling a teacher an export *failed* when they
 * simply changed their mind would send them looking for a problem that is not
 * there. It is optional so the two callers that cannot be cancelled — a
 * browser download, a device write — keep working unchanged.
 */
export type ExportResult =
  | ({
      ok: true;
      /**
       * The file was delivered but the activity row was not written. Said in
       * the success notice rather than reported as a failure: the export is
       * done, and "failed" would send a teacher hunting for a file that exists.
       */
      logFailed?: boolean;
    } & DeliveredExport)
  | { ok: false; cancelled?: boolean }
  | null;

/**
 * Says whether the workbook was actually handed over, and how.
 *
 * The three routes can promise different things, so they must not say the same
 * thing. A native export is written to disk before this renders, so it can
 * state plainly that the file exists and where; a desktop save can go further
 * and name the exact path the operator chose. A browser download is a
 * synthetic `<a download>` click that reports nothing back — a host that
 * ignores it looks exactly like a file that saved — so that wording stops at
 * "handed over" and tells the operator to go and check.
 *
 * Naming the file is the point in all three cases: it is what they will look
 * for.
 */
export function ExportNotice({ result }: { result: ExportResult }) {
  const { active } = useTheme();

  if (!result) return null;

  if (!result.ok && result.cancelled) {
    return (
      <p
        className="mt-3 flex items-start gap-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted)/.25)] px-3 py-2.5 text-xs leading-5 text-[hsl(var(--muted-foreground))]"
        role="status"
        data-testid="text-export-cancelled"
      >
        <Info aria-hidden="true" size={14} className="mt-0.5 shrink-0" />
        <span>
          <strong className="font-semibold">Export cancelled.</strong> No file
          was written, and the attendance is still on this device. Export again
          whenever you are ready.
        </span>
      </p>
    );
  }

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
      className="mt-3 flex flex-wrap items-start gap-2 rounded-xl border border-[hsl(var(--accent)/.45)] bg-[hsl(var(--accent)/.08)] px-3 py-2.5 text-xs leading-5 text-[hsl(var(--accent))]"
      role="status"
      data-testid="text-export-saved"
    >
      <FileSpreadsheet aria-hidden="true" size={14} className="mt-0.5 shrink-0" />
      {result.delivery === 'saved' ? (
        <span>
          Saved <strong className="font-semibold">{result.filename}</strong>
          {result.uri ? (
            <>
              {' '}
              to <span className="font-mono">{result.uri}</span>
            </>
          ) : null}
          . The file is written and confirmed on disk.
        </span>
      ) : result.delivery === 'file' ? (
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
      {/* The one rule about destinations, on every route: this file holds
          minors' names, and the standing rule is that school data never lands
          on a personal account. */}
      <span className="basis-full pl-[22px]">
        {active.copy.exportSchoolAccountNotice?.trim() ||
          'Send this file only to a school account.'}
        {result.logFailed ? (
          <>
            {' '}
            <span data-testid="text-export-log-failed">
              The activity log entry could not be written.
            </span>
          </>
        ) : null}
      </span>
    </p>
  );
}
