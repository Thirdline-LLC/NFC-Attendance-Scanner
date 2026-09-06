import { useCallback, useEffect, useRef, useState } from 'react';
import { Database, LockKeyhole, Radio, RotateCcw, ShieldCheck } from 'lucide-react';
import { FeedbackPanel } from '@/ui/FeedbackPanel';
import { useScannerSession } from '@/scanner/use-scanner-session';

export function ScannerScreen() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [rawInput, setRawInput] = useState('');
  const [hasFocus, setHasFocus] = useState(true);
  const {
    count,
    feedback,
    lastUid,
    isLoading,
    isSaving,
    storageError,
    registerScan,
    resetSession,
  } = useScannerSession();

  const focusScanner = useCallback(() => {
    inputRef.current?.focus();
    setHasFocus(true);
  }, []);

  useEffect(() => {
    focusScanner();
    const handleWindowFocus = () => focusScanner();
    window.addEventListener('focus', handleWindowFocus);
    return () => window.removeEventListener('focus', handleWindowFocus);
  }, [focusScanner]);

  const submitScan = useCallback(() => {
    if (!rawInput) return;
    void registerScan(rawInput);
    setRawInput('');
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [rawInput, registerScan]);

  return (
    <main
      className="grain relative min-h-[100dvh] overflow-hidden bg-[hsl(var(--background))]"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) focusScanner();
      }}
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
        <header className="station-enter flex items-center justify-between gap-4" data-testid="header-scanner">
          <div className="flex items-center gap-3">
            <div className="flex size-11 items-center justify-center rounded-2xl border border-[hsl(var(--primary)/.5)] bg-[hsl(var(--primary)/.1)] text-[hsl(var(--primary))]">
              <Radio aria-hidden="true" size={22} strokeWidth={2.2} />
            </div>
            <div>
              <h1 className="font-display text-lg font-semibold tracking-[-0.025em] text-[hsl(var(--foreground))] sm:text-xl">Attendance Scanner</h1>
              <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.19em] text-[hsl(var(--muted-foreground))]">Front desk station</p>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--card)/.68)] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[hsl(var(--muted-foreground))]">
            <span className="relative flex size-2">
              <span className="signal-breathe absolute inline-flex size-full rounded-full bg-[hsl(var(--accent))]" />
              <span className="relative inline-flex size-2 rounded-full bg-[hsl(var(--accent))]" />
            </span>
            Scanner active
          </div>
        </header>

        <div className="my-auto grid gap-5 py-12 lg:grid-cols-[minmax(0,1fr)_minmax(360px,0.86fr)] lg:items-center lg:gap-14 lg:py-16">
          <section className="station-enter max-w-3xl" style={{ animationDelay: '80ms' }}>
            <p className="mb-4 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.24em] text-[hsl(var(--accent))]">
              <ShieldCheck aria-hidden="true" size={16} />
              Today’s attendance
            </p>
            <div className="flex items-end gap-3 sm:gap-5">
              <p className="font-display text-[clamp(8rem,25vw,19rem)] font-semibold leading-[0.78] tracking-[-0.095em] text-[hsl(var(--foreground))]" data-testid="text-attendance-count">
                {isLoading ? <span className="inline-block h-[0.72em] w-[1.15em] animate-pulse rounded-2xl bg-[hsl(var(--muted)/.8)]" /> : count}
              </p>
              <p className="mb-[0.15em] max-w-24 pb-1 text-sm font-medium leading-5 text-[hsl(var(--muted-foreground))] sm:mb-[0.2em] sm:text-base">
                checked in
                <span className="mt-1 block h-px w-10 bg-[hsl(var(--primary))]" />
              </p>
            </div>
            <p className="mt-8 max-w-md text-base leading-7 text-[hsl(var(--muted-foreground))] sm:text-lg">
              Keep this station open and let each tap do the work. Attendance stays on this device.
            </p>
          </section>

          <section
            className={`station-enter rounded-[1.7rem] border bg-[hsl(var(--card)/.88)] p-2 shadow-[0_24px_70px_hsl(211_55%_5%/.28)] transition-[border-color,box-shadow] duration-300 ${hasFocus ? 'focus-ring border-[hsl(var(--primary)/.6)]' : 'border-[hsl(var(--border))]'}`}
            style={{ animationDelay: '160ms' }}
            onClick={focusScanner}
            data-testid="card-scanner-reader"
          >
            <div className="rounded-[1.35rem] border border-[hsl(var(--border)/.75)] px-5 py-6 sm:px-7 sm:py-8">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-[hsl(var(--muted-foreground))]">Tap to check in</p>
                <div className="flex size-10 items-center justify-center rounded-xl bg-[hsl(var(--primary)/.1)] text-[hsl(var(--primary))]">
                  <Radio aria-hidden="true" size={19} />
                </div>
              </div>
              <div className="relative my-8 flex min-h-36 items-center justify-center overflow-hidden rounded-2xl border border-dashed border-[hsl(var(--primary)/.34)] bg-[hsl(var(--background)/.45)] sm:my-10 sm:min-h-44">
                <div className="absolute size-24 rounded-full border border-[hsl(var(--primary)/.22)] signal-breathe" />
                <div className="absolute size-12 rounded-full border border-[hsl(var(--primary)/.38)]" />
                <Radio className="relative text-[hsl(var(--primary))]" aria-hidden="true" size={31} strokeWidth={1.5} />
              </div>
              <FeedbackPanel feedback={feedback} lastUid={lastUid} isSaving={isSaving} />
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
              Saved in this browser
            </span>
            {storageError && <span className="text-[hsl(var(--destructive))]">Storage unavailable</span>}
          </div>
          {import.meta.env.DEV && (
            <button
              type="button"
              onClick={() => void resetSession()}
              className="flex w-fit items-center gap-2 rounded-lg px-2 py-1.5 font-semibold text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--secondary))] hover:text-[hsl(var(--foreground))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
              data-testid="button-reset-session"
            >
              <RotateCcw aria-hidden="true" size={14} />
              Reset Test Session
            </button>
          )}
        </footer>
      </div>
    </main>
  );
}