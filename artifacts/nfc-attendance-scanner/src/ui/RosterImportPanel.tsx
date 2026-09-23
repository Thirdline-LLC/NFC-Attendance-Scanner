import { useId, useRef, useState } from 'react';
import {
  AlertTriangle,
  Download,
  FileSpreadsheet,
  Upload,
} from 'lucide-react';

import type { AttendanceBody, RosterImportCounts } from '@/data/attendance-store';
import type { RejectedRosterRow } from '@/lib/roster-workbook';
import { ExportNotice, type ExportResult } from '@/ui/ExportNotice';

/** What one finished import did, as counts and reasons — never as students. */
export type RosterImportResult =
  | {
      ok: true;
      counts: RosterImportCounts;
      rejected: RejectedRosterRow[];
      /** Rows whose card column was filled in and therefore read but ignored. */
      cardsIgnored: number;
      /** The import landed but its activity-log row did not. */
      logFailed?: boolean;
    }
  | { ok: false; message: string }
  | null;

type RosterImportPanelProps = {
  /** Resolves once the chosen file has been read and applied, or refused. */
  onImport: (file: File) => Promise<void>;
  isImporting: boolean;
  result: RosterImportResult;
  onExport: () => void;
  isExporting: boolean;
  exportResult: ExportResult;
  studentCount: number;
  /** The active body, shown in a banner so the teacher knows what they are importing into. */
  activeBody?: AttendanceBody | null;
};

/** The most reasons worth printing; past this the sheet is the problem. */
const MAX_REASONS = 8;

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/**
 * Pre-enrollment: the roster workbook in and out.
 *
 * A teacher exports the roster to get a file with the right headers, fills a
 * class into it with the card column left empty, and imports it. Every row
 * becomes a student with no card, and each card is attached later by tapping
 * it at the kiosk. That is the whole point of leaving the column empty, and
 * the copy says so, because a column headed "Card" that cannot set a card is
 * otherwise a trap.
 *
 * The summary is counts and row numbers only. An import touches every student
 * in a school, so a report naming them would be the largest disclosure in the
 * app, printed on a screen in a corridor.
 */
export function RosterImportPanel({
  onImport,
  isImporting,
  result,
  onExport,
  isExporting,
  exportResult,
  studentCount,
  activeBody,
}: RosterImportPanelProps) {
  const headingId = useId();
  const fileId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');

  const chooseFile = async (file: File | undefined) => {
    if (!file) return;
    setFileName(file.name);
    await onImport(file);
    // Cleared so choosing the same file again — after fixing it in the
    // spreadsheet — still fires a change event.
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <section
      className="rounded-[1.7rem] border border-[hsl(var(--border))] bg-[hsl(var(--card)/.88)] p-5 shadow-[0_24px_70px_hsl(211_55%_5%/.28)] sm:p-7"
      aria-labelledby={headingId}
      data-testid="roster-import"
    >
      <header className="flex items-start gap-3">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl border border-[hsl(var(--accent)/.5)] bg-[hsl(var(--accent)/.1)] text-[hsl(var(--accent))]">
          <FileSpreadsheet aria-hidden="true" size={22} strokeWidth={2.2} />
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.19em] text-[hsl(var(--muted-foreground))]">
            Roster workbook
          </p>
          <h2
            id={headingId}
            className="mt-0.5 font-display text-xl font-semibold tracking-[-0.025em] text-[hsl(var(--foreground))] sm:text-2xl"
          >
            Pre-enroll from a spreadsheet
          </h2>
          <p className="mt-1.5 text-sm leading-5 text-[hsl(var(--muted-foreground))]">
            Import a <code className="font-mono text-xs">.csv</code>,{' '}
            <code className="font-mono text-xs">.xlsx</code>, or{' '}
            <code className="font-mono text-xs">.nfc-pack</code> with columns{' '}
            <code className="font-mono text-xs">
              first_name, last_name, grad_year, email
            </code>
            . Leave the card column empty: students arrive without a card, and
            each card is linked at the scanner the first time it is tapped. A
            student who already taps with a card keeps it — an import never
            changes a card.
          </p>
        </div>
      </header>

      {activeBody ? (
        <p
          className="mt-4 rounded-xl border border-[hsl(var(--accent)/.35)] bg-[hsl(var(--accent)/.06)] px-3 py-2 text-xs text-[hsl(var(--muted-foreground))]"
          data-testid="text-active-body-banner"
        >
          Importing into{' '}
          <strong className="font-semibold text-[hsl(var(--foreground))]">
            {activeBody.name}
          </strong>{' '}
          <span className="opacity-70">({activeBody.typeLabel})</span>
        </p>
      ) : null}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <label
          htmlFor={fileId}
          className="flex cursor-pointer items-center gap-2 rounded-xl bg-[hsl(var(--primary))] px-4 py-3 text-sm font-bold text-[hsl(var(--primary-foreground))] transition hover:brightness-105 focus-within:outline-none focus-within:ring-2 focus-within:ring-[hsl(var(--ring))] aria-disabled:cursor-wait aria-disabled:opacity-60"
          aria-disabled={isImporting}
        >
          <Upload aria-hidden="true" size={15} />
          {isImporting ? 'Reading the file…' : 'Choose a roster file'}
        </label>
        <input
          ref={inputRef}
          id={fileId}
          type="file"
          accept=".csv,.xlsx,.nfc-pack,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
          disabled={isImporting}
          onChange={(event) => void chooseFile(event.target.files?.[0])}
          className="sr-only"
          data-testid="input-roster-file"
        />
        <button
          type="button"
          onClick={onExport}
          disabled={isExporting}
          className="flex items-center gap-2 rounded-xl border border-[hsl(var(--border))] px-4 py-3 text-sm font-bold text-[hsl(var(--foreground))] transition hover:bg-[hsl(var(--secondary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] disabled:cursor-wait disabled:opacity-60"
          data-testid="button-export-roster"
        >
          <Download aria-hidden="true" size={15} />
          {isExporting
            ? 'Building the file…'
            : `Export roster (${plural(studentCount, 'student')})`}
        </button>
        {fileName && !isImporting ? (
          <p
            className="text-xs text-[hsl(var(--muted-foreground))]"
            data-testid="text-roster-file-name"
          >
            {fileName}
          </p>
        ) : null}
      </div>

      <ExportNotice result={exportResult} />

      {result?.ok === false ? (
        <p
          className="mt-4 flex items-start gap-2.5 rounded-xl border border-[hsl(var(--destructive)/.5)] bg-[hsl(var(--destructive)/.09)] px-3 py-2.5 text-sm text-[hsl(var(--destructive))]"
          role="alert"
          data-testid="text-import-failed"
        >
          <AlertTriangle aria-hidden="true" className="mt-0.5 shrink-0" size={16} />
          <span>
            <strong className="font-semibold">Nothing was imported.</strong>{' '}
            {result.message}
          </span>
        </p>
      ) : null}

      {result?.ok ? (
        <div
          className="mt-4 rounded-xl border border-[hsl(var(--accent)/.45)] bg-[hsl(var(--accent)/.08)] px-4 py-3 text-sm leading-6 text-[hsl(var(--foreground))]"
          role="status"
          data-testid="text-import-summary"
        >
          <p className="font-semibold text-[hsl(var(--accent))]">
            {plural(result.counts.added, 'student')} added,{' '}
            {result.counts.updated} updated, {result.counts.skipped} already up
            to date, {result.rejected.length} refused.
          </p>
          {result.counts.added > 0 ? (
            <p className="mt-1 text-[hsl(var(--muted-foreground))]">
              The new students have no card yet. Tap each card at the scanner
              and pick its owner to link it.
            </p>
          ) : null}
          {result.cardsIgnored > 0 ? (
            <p
              className="mt-1 text-[hsl(var(--muted-foreground))]"
              data-testid="text-import-cards-ignored"
            >
              {plural(result.cardsIgnored, 'row')} had something in the card
              column. Cards are only ever linked by tapping, so those were read
              and left alone.
            </p>
          ) : null}
          {result.logFailed ? (
            <p
              className="mt-1 text-[hsl(var(--muted-foreground))]"
              data-testid="text-import-log-failed"
            >
              The activity log entry could not be written.
            </p>
          ) : null}
          {result.rejected.length > 0 ? (
            <ul
              className="mt-2 list-disc space-y-0.5 pl-5 text-[hsl(var(--destructive))]"
              data-testid="list-import-rejected"
            >
              {result.rejected.slice(0, MAX_REASONS).map((row) => (
                <li key={row.row}>
                  Row {row.row}: {row.reason}
                </li>
              ))}
              {result.rejected.length > MAX_REASONS ? (
                <li>
                  …and {result.rejected.length - MAX_REASONS} more. Fix the
                  sheet and import it again — re-importing changes nothing that
                  is already correct.
                </li>
              ) : null}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
