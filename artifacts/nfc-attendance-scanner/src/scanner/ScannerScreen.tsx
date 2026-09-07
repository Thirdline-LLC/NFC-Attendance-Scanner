import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  BarChart3,
  Database,
  Download,
  LockKeyhole,
  Radio,
  RotateCcw,
  ShieldCheck,
  UserPlus,
  UserRoundCheck,
  Users,
} from 'lucide-react';
import { exportAttendanceWorkbook } from '@/lib/attendance-export';
import { type ExportResult } from '@/ui/ExportNotice';
import {
  useAttendanceSession,
  type ScannerMode,
} from '@/scanner/use-attendance-session';
import { EnrollmentForm } from '@/ui/EnrollmentForm';
import { FeedbackPanel } from '@/ui/FeedbackPanel';
import { NewSessionDialog } from '@/ui/NewSessionDialog';
import { SessionSummary } from '@/ui/SessionSummary';

// Matches the mode pills and the status chip beside them, so the header reads
// as one row of controls rather than links bolted onto it.
const NAV_PILL_CLASS =
  'flex items-center gap-1.5 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--card)/.68)] px-3 py-2 text-[11px] font-bold uppercase tracking-[0.14em] text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--secondary))] hover:text-[hsl(var(--foreground))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]';

export function ScannerScreen() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [rawInput, setRawInput] = useState('');
  const [hasFocus, setHasFocus] = useState(true);
  const [mode, setMode] = useState<ScannerMode>('checkin');
  const [captureEnabled, setCaptureEnabled] = useState(true);
  // Rotating the session id is destructive from the desk's point of view, so
  // every entry point routes through one confirmation instead of firing.
  const [isConfirmingNewSession, setIsConfirmingNewSession] = useState(false);
  const [exportResult, setExportResult] = useState<ExportResult>(null);
  const {
    count,
    feedback,
    lastUid,
    lastPerson,
    lastScannedAt,
    enrollmentCandidate,
    sessionSummary,
    metrics,
    persons,
    taps,
    isLoading,
    isSaving,
    storageError,
    storageStatus,
    saveErrorMessage,
    retryStorage,
    handleScan,
    enrollPerson,
    cancelEnrollment,
    endSession,
    dismissSummary,
    startNewSession,
  } = useAttendanceSession(mode);
  const captureEnabledRef = useRef(captureEnabled);
  captureEnabledRef.current = captureEnabled;
  // A retry puts the store back in 'checking', which would otherwise yank the
  // explanation and the button out from under the hand that just pressed it.
  // Remembering the failure keeps the panel up until a read actually succeeds,
  // so Retry can be disabled during the reload instead of disappearing.
  const [sawStorageUnavailable, setSawStorageUnavailable] = useState(false);

  const focusScanner = useCallback(() => {
    if (!captureEnabledRef.current) return;
    inputRef.current?.focus();
    setHasFocus(true);
  }, []);

  useEffect(() => {
    setCaptureEnabled(
      !enrollmentCandidate && !sessionSummary && !isConfirmingNewSession,
    );
  }, [enrollmentCandidate, sessionSummary, isConfirmingNewSession]);

  useEffect(() => {
    if (storageStatus === 'unavailable') setSawStorageUnavailable(true);
    else if (storageStatus === 'ready') setSawStorageUnavailable(false);
  }, [storageStatus]);

  const showStorageAlert =
    storageStatus === 'unavailable' ||
    (sawStorageUnavailable && storageStatus === 'checking');

  /**
   * Three states, because there are three: listening, not listening but one
   * tap away from it, and deliberately off while something on screen is being
   * answered. The third used to read "tap to resume", which resumed nothing —
   * `refocusFromStrayPress` returns early with capture disabled — so it sent
   * the volunteer tapping at a screen that could not react. It now names what
   * would actually bring the reader back.
   */
  const scannerChip = !captureEnabled
    ? {
        label: enrollmentCandidate
          ? 'Scanner off — finish enrolling'
          : 'Scanner off — close this dialog',
        tone: 'border-[hsl(var(--border))] bg-[hsl(var(--card)/.68)] text-[hsl(var(--muted-foreground))]',
        dot: 'bg-[hsl(var(--muted-foreground))]',
      }
    : hasFocus
      ? {
          label: 'Scanner active',
          tone: 'border-[hsl(var(--border))] bg-[hsl(var(--card)/.68)] text-[hsl(var(--muted-foreground))]',
          dot: 'bg-[hsl(var(--accent))]',
        }
      : {
          label: 'Scanner paused — tap to resume',
          tone: 'border-[hsl(var(--destructive)/.55)] bg-[hsl(var(--destructive)/.1)] text-[hsl(var(--destructive))]',
          dot: 'bg-[hsl(var(--destructive))]',
        };

  useEffect(() => {
    if (!captureEnabled) return;
    focusScanner();
    const handleWindowFocus = () => focusScanner();
    window.addEventListener('focus', handleWindowFocus);
    return () => window.removeEventListener('focus', handleWindowFocus);
  }, [captureEnabled, focusScanner]);

  const submitScan = useCallback(() => {
    if (!rawInput) return;
    void handleScan(rawInput);
    setRawInput('');
  }, [rawInput, handleScan]);

  // This session only, which is what the desk wants at the end of a meeting.
  // Everything ever recorded on the device — earlier sessions, and the taps a
  // v3 upgrade stamped 'legacy' — is exported from the dashboard instead.
  const handleExport = useCallback(async () => {
    try {
      setExportResult({ ok: true, ...(await exportAttendanceWorkbook(taps, persons)) });
    } catch {
      setExportResult({ ok: false });
    }
  }, [persons, taps]);

  const handleEnrollPerson = useCallback(
    async (details: {
      firstName: string;
      lastName: string;
      gradYear: number;
      email: string;
    }) => {
      await enrollPerson(details);
      window.setTimeout(() => {
        if (captureEnabledRef.current) inputRef.current?.focus();
      }, 0);
    },
    [enrollPerson],
  );

  const handleCancelEnrollment = useCallback(() => {
    cancelEnrollment();
    window.setTimeout(() => {
      if (captureEnabledRef.current) inputRef.current?.focus();
    }, 0);
  }, [cancelEnrollment]);

  const handleConfirmNewSession = useCallback(async () => {
    setIsConfirmingNewSession(false);
    await startNewSession();
    window.setTimeout(() => {
      if (captureEnabledRef.current) inputRef.current?.focus();
    }, 0);
  }, [startNewSession]);

  const handleCancelNewSession = useCallback(() => {
    setIsConfirmingNewSession(false);
    window.setTimeout(() => {
      if (captureEnabledRef.current) inputRef.current?.focus();
    }, 0);
  }, []);

  const handleDismissSummary = useCallback(() => {
    dismissSummary();
    window.setTimeout(() => {
      if (captureEnabledRef.current) inputRef.current?.focus();
    }, 0);
  }, [dismissSummary]);

  /**
   * A press that lands on the station itself — the background, the count, the
   * header — used to blur the reader input, after which every scan went
   * nowhere while the header still claimed to be listening. Capture phase, so
   * it runs before anything in the subtree, and only for a target that is not
   * a control of its own: buttons and links must keep the focus they are
   * about to take. The deferred second focus is the one that sticks in a real
   * browser, where the press moves focus *after* this handler returns.
   */
  const refocusFromStrayPress = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (!captureEnabledRef.current) return;
      const target = event.target as Element | null;
      if (
        target?.closest(
          'a, button, input, select, textarea, [contenteditable="true"], [tabindex]',
        )
      ) {
        return;
      }
      focusScanner();
      window.setTimeout(focusScanner, 0);
    },
    [focusScanner],
  );

  return (
    <main
      className="grain relative min-h-[100dvh] overflow-hidden bg-[hsl(var(--background))]"
      onPointerDownCapture={refocusFromStrayPress}
      data-testid="scanner-station"
    >
      <div className="pointer-events-none absolute -left-40 -top-48 size-[34rem] rounded-full bg-[hsl(var(--accent)/.055)] blur-3xl" />
      <div className="pointer-events-none absolute -bottom-56 -right-32 size-[34rem] rounded-full bg-[hsl(var(--primary)/.05)] blur-3xl" />

      <input
        ref={inputRef}
        className="scanner-input"
        value={rawInput}
        onChange={(event) => setRawInput(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            submitScan();
          }
        }}
        onFocus={() => setHasFocus(true)}
        onBlur={() => setHasFocus(false)}
        aria-label="Hidden scanner input"
        data-testid="input-scanner-hidden"
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
      />

      <div className="relative mx-auto flex min-h-[100dvh] w-full max-w-[1440px] flex-col px-5 py-5 sm:px-8 sm:py-7 lg:px-12 lg:py-8">
        <header className="station-enter flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between" data-testid="header-scanner">
          <div className="flex items-center gap-3">
            <div className="flex size-11 items-center justify-center rounded-2xl border border-[hsl(var(--primary)/.5)] bg-[hsl(var(--primary)/.1)] text-[hsl(var(--primary))]">
              <Radio aria-hidden="true" size={22} strokeWidth={2.2} />
            </div>
            <div>
              <h1 className="font-display text-lg font-semibold tracking-[-0.025em] text-[hsl(var(--foreground))] sm:text-xl">
                Attendance Scanner
              </h1>
              <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.19em] text-[hsl(var(--muted-foreground))]">
                Front desk station
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--card)/.68)] p-1">
              <ModeButton
                active={mode === 'checkin'}
                icon={<UserRoundCheck size={14} />}
                label="Check-in"
                onClick={() => {
                  setMode('checkin');
                  focusScanner();
                }}
              />
              <ModeButton
                active={mode === 'enroll'}
                icon={<UserPlus size={14} />}
                label="Enroll"
                onClick={() => {
                  setMode('enroll');
                  focusScanner();
                }}
              />
            </div>
            <Link
              to="/roster"
              className={NAV_PILL_CLASS}
              data-testid="link-roster"
            >
              <Users aria-hidden="true" size={14} />
              Students
            </Link>
            <Link
              to="/dashboard"
              className={NAV_PILL_CLASS}
              data-testid="link-dashboard"
            >
              <BarChart3 aria-hidden="true" size={14} />
              Dashboard
            </Link>
            {/* The truth about whether a tap would be read, not a decoration:
                the reader only sees a card while the hidden input has focus. */}
            <div
              className={`flex items-center gap-2 rounded-full border px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] ${scannerChip.tone}`}
              aria-live="polite"
              data-testid="text-scanner-focus"
            >
              <span className="relative flex size-2">
                {captureEnabled && hasFocus && (
                  <span className="signal-breathe absolute inline-flex size-full rounded-full bg-[hsl(var(--accent))]" />
                )}
                <span
                  className={`relative inline-flex size-2 rounded-full ${scannerChip.dot}`}
                />
              </span>
              {scannerChip.label}
            </div>
          </div>
        </header>

        <div className="my-auto grid gap-5 py-10 lg:grid-cols-[minmax(0,1fr)_minmax(390px,0.86fr)] lg:items-center lg:gap-14 lg:py-14">
          <section className="station-enter max-w-3xl" style={{ animationDelay: '80ms' }}>
            <p className="mb-4 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.24em] text-[hsl(var(--accent))]">
              <ShieldCheck aria-hidden="true" size={16} />
              {mode === 'checkin' ? 'Today’s attendance' : 'Local enrollment'}
            </p>
            <div className="flex items-end gap-3 sm:gap-5">
              <p className="font-display text-[clamp(8rem,25vw,19rem)] font-semibold leading-[0.78] tracking-[-0.095em] text-[hsl(var(--foreground))]" data-testid="text-attendance-count">
                {isLoading ? (
                  <span className="inline-block h-[0.72em] w-[1.15em] animate-pulse rounded-2xl bg-[hsl(var(--muted)/.8)]" />
                ) : (
                  count
                )}
              </p>
              <p className="mb-[0.15em] max-w-24 pb-1 text-sm font-medium leading-5 text-[hsl(var(--muted-foreground))] sm:mb-[0.2em] sm:text-base">
                checked in
                <span className="mt-1 block h-px w-10 bg-[hsl(var(--primary))]" />
              </p>
            </div>
            <p className="mt-8 max-w-md text-base leading-7 text-[hsl(var(--muted-foreground))] sm:text-lg">
              {mode === 'checkin'
                ? 'Keep this station open and let each tap do the work. Attendance stays on this device.'
                : 'Enroll cards locally once, then switch back to Check-in for attendance.'}
            </p>
          </section>

          <section
            className={`station-enter rounded-[1.7rem] border bg-[hsl(var(--card)/.88)] p-2 shadow-[0_24px_70px_hsl(211_55%_5%/.28)] transition-[border-color,box-shadow] duration-300 ${hasFocus ? 'focus-ring border-[hsl(var(--primary)/.6)]' : 'border-[hsl(var(--border))]'}`}
            style={{ animationDelay: '160ms' }}
            onClick={() => {
              if (captureEnabledRef.current) focusScanner();
            }}
            data-testid="card-scanner-reader"
          >
            <div className="rounded-[1.35rem] border border-[hsl(var(--border)/.75)] px-5 py-6 sm:px-7 sm:py-8">
              <div className="flex items-center justify-between">
                {storageStatus === 'checking' ? (
                  <p
                    className="text-xs font-semibold uppercase tracking-[0.2em] text-[hsl(var(--muted-foreground)/.72)]"
                    data-testid="text-storage-checking"
                  >
                    Checking local storage…
                  </p>
                ) : (
                  <p className="text-xs font-bold uppercase tracking-[0.2em] text-[hsl(var(--muted-foreground))]">
                    {mode === 'checkin' ? 'Tap to check in' : 'Tap to enroll'}
                  </p>
                )}
                <div className="flex size-10 items-center justify-center rounded-xl bg-[hsl(var(--primary)/.1)] text-[hsl(var(--primary))]">
                  <Radio aria-hidden="true" size={19} />
                </div>
              </div>
              {showStorageAlert ? (
                <div
                  role="alert"
                  className="my-7 rounded-2xl border border-[hsl(var(--destructive)/.6)] bg-[hsl(var(--destructive)/.1)] p-4 sm:my-8 sm:p-5"
                  data-testid="panel-storage-unavailable"
                >
                  <div className="flex items-start gap-3 text-[hsl(var(--destructive))]">
                    <AlertTriangle aria-hidden="true" size={22} strokeWidth={2.2} className="mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <p className="font-display text-base font-semibold leading-tight tracking-[-0.02em] text-[hsl(var(--foreground))] sm:text-lg">
                        This device isn’t letting the app save
                      </p>
                      <p className="mt-1.5 text-sm leading-5 text-[hsl(var(--muted-foreground))]">
                        Private browsing, blocked site data, or a full disk can do
                        it. Scans are not being recorded until it is fixed.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void retryStorage()}
                    disabled={storageStatus === 'checking'}
                    className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg border border-[hsl(var(--destructive)/.6)] px-3 py-2 text-xs font-bold uppercase tracking-[0.14em] text-[hsl(var(--destructive))] transition hover:bg-[hsl(var(--destructive)/.12)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] disabled:cursor-not-allowed disabled:opacity-60 sm:w-fit"
                    data-testid="button-retry-storage"
                  >
                    <RotateCcw aria-hidden="true" size={14} />
                    Retry
                  </button>
                </div>
              ) : (
                <div className="relative my-7 flex min-h-28 items-center justify-center overflow-hidden rounded-2xl border border-dashed border-[hsl(var(--primary)/.34)] bg-[hsl(var(--background)/.45)] sm:my-8 sm:min-h-32">
                  <div className="absolute size-24 rounded-full border border-[hsl(var(--primary)/.22)] signal-breathe" />
                  <div className="absolute size-12 rounded-full border border-[hsl(var(--primary)/.38)]" />
                  <Radio className="relative text-[hsl(var(--primary))]" aria-hidden="true" size={31} strokeWidth={1.5} />
                </div>
              )}
              {enrollmentCandidate ? (
                <EnrollmentForm
                  key={enrollmentCandidate.uid}
                  candidate={enrollmentCandidate}
                  roster={persons}
                  isSaving={isSaving}
                  storageError={storageError}
                  saveErrorMessage={saveErrorMessage}
                  onSave={handleEnrollPerson}
                  onCancel={handleCancelEnrollment}
                />
              ) : (
                <FeedbackPanel
                  feedback={feedback}
                  mode={mode}
                  lastUid={lastUid}
                  lastPerson={lastPerson}
                  lastScannedAt={lastScannedAt}
                  isSaving={isSaving}
                />
              )}
            </div>
          </section>
        </div>

        <footer className="station-enter flex flex-col gap-4 border-t border-[hsl(var(--border)/.75)] pt-5 text-xs sm:flex-row sm:items-center sm:justify-between" style={{ animationDelay: '240ms' }}>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[hsl(var(--muted-foreground))]">
            <span className="flex items-center gap-2">
              <LockKeyhole aria-hidden="true" size={14} className="text-[hsl(var(--accent))]" />
              Local only
            </span>
            <span className="flex items-center gap-2">
              <Database aria-hidden="true" size={14} />
              {persons.length} enrolled locally
            </span>
            {/* Two different problems, two different words: nothing can be
                saved at all, versus one write that did not land. */}
            {storageError && (
              <span className="text-[hsl(var(--destructive))]" data-testid="text-storage-footer">
                {storageStatus === 'unavailable'
                  ? 'Storage unavailable'
                  : 'Last save failed'}
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={endSession}
              className="flex w-fit items-center gap-2 rounded-lg border border-[hsl(var(--border))] px-3 py-2 font-semibold text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--secondary))] hover:text-[hsl(var(--foreground))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
              data-testid="button-end-session"
            >
              <Download aria-hidden="true" size={14} />
              End Session
            </button>
            {import.meta.env.DEV && (
              <button
                type="button"
                onClick={() => setIsConfirmingNewSession(true)}
                className="flex w-fit items-center gap-2 rounded-lg px-2 py-1.5 font-semibold text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--secondary))] hover:text-[hsl(var(--foreground))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
                data-testid="button-reset-session"
              >
                <RotateCcw aria-hidden="true" size={14} />
                Reset Test Session
              </button>
            )}
          </div>
        </footer>
      </div>

      {sessionSummary && (
        <SessionSummary
          summary={sessionSummary}
          onExport={() => void handleExport()}
          exportResult={exportResult}
          onStartNewSession={() => setIsConfirmingNewSession(true)}
          onDismiss={handleDismissSummary}
          isCovered={isConfirmingNewSession}
        />
      )}

      {isConfirmingNewSession && (
        <NewSessionDialog
          exportResult={exportResult}
          metrics={metrics}
          onExport={() => void handleExport()}
          onConfirm={() => void handleConfirmNewSession()}
          onCancel={handleCancelNewSession}
        />
      )}
    </main>
  );
}

function ModeButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-bold transition ${active ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]' : 'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]'}`}
      aria-pressed={active}
    >
      {icon}
      {label}
    </button>
  );
}
