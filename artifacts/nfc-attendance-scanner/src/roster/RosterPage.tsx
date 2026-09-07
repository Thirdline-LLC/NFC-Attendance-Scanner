import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, RotateCcw, Users } from 'lucide-react';
import {
  DuplicateEmailError,
  listPersons,
  updatePerson,
  type Person,
} from '@/data/attendance-store';
import { RosterManager, type PersonChanges } from '@/ui/RosterManager';

/**
 * The container behind `RosterManager`: it owns the roster read, the write and
 * the two failures a write can have. The list itself stays presentational so it
 * can be tested without a store.
 */
export function RosterPage() {
  const [persons, setPersons] = useState<Person[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  // A rejected duplicate names the student who already holds the address, which
  // is the only way to resolve it; every other failure is just "it did not
  // save" and is shown by the open editor instead.
  const [duplicateMessage, setDuplicateMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadFailed(false);
    try {
      setPersons(await listPersons());
    } catch {
      setLoadFailed(true);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = useCallback(
    async (personId: number, changes: PersonChanges): Promise<boolean> => {
      setIsSaving(true);
      setSaveError(false);
      setDuplicateMessage(null);
      try {
        const updated = await updatePerson(personId, changes);
        // Patched in place instead of re-reading: only this row changed, and a
        // reload would re-sort the table under the hand that just saved.
        setPersons((current) =>
          current.map((person) => (person.id === personId ? updated : person)),
        );
        return true;
      } catch (error) {
        if (error instanceof DuplicateEmailError) {
          setDuplicateMessage(error.message);
        } else {
          setSaveError(true);
        }
        // False keeps the editor open with what was typed still in it.
        return false;
      } finally {
        setIsSaving(false);
      }
    },
    [],
  );

  return (
    <main
      className="grain relative min-h-[100dvh] overflow-hidden bg-[hsl(var(--background))]"
      data-testid="roster-page"
    >
      <div className="pointer-events-none absolute -left-40 -top-48 size-[34rem] rounded-full bg-[hsl(var(--accent)/.055)] blur-3xl" />
      <div className="pointer-events-none absolute -bottom-56 -right-32 size-[34rem] rounded-full bg-[hsl(var(--primary)/.05)] blur-3xl" />

      <div className="relative mx-auto flex w-full max-w-5xl flex-col gap-5 px-5 py-5 sm:px-8 sm:py-7">
        <header
          className="station-enter flex flex-wrap items-center justify-between gap-3"
          data-testid="header-roster"
        >
          <Link
            to="/"
            className="flex items-center gap-2 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--card)/.68)] px-3 py-2 text-[11px] font-bold uppercase tracking-[0.14em] text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--secondary))] hover:text-[hsl(var(--foreground))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
            data-testid="link-scanner"
          >
            <ArrowLeft aria-hidden="true" size={14} />
            Back to scanner
          </Link>
          <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.19em] text-[hsl(var(--muted-foreground))]">
            <Users aria-hidden="true" size={14} className="text-[hsl(var(--accent))]" />
            Students on this device
          </p>
        </header>

        {duplicateMessage ? (
          <p
            className="station-enter flex items-start gap-2.5 rounded-2xl border border-[hsl(var(--destructive)/.5)] bg-[hsl(var(--destructive)/.09)] px-4 py-3 text-sm text-[hsl(var(--destructive))]"
            role="alert"
            data-testid="text-roster-save-error"
          >
            <AlertTriangle aria-hidden="true" className="mt-0.5 shrink-0" size={16} />
            <span>
              <strong className="font-semibold">That email is taken.</strong>{' '}
              {duplicateMessage}
            </span>
          </p>
        ) : null}

        {loadFailed ? (
          <section
            className="station-enter rounded-[1.7rem] border border-[hsl(var(--destructive)/.5)] bg-[hsl(var(--card)/.88)] p-5 sm:p-7"
            role="alert"
            data-testid="text-roster-load-error"
          >
            <div className="flex items-start gap-3 text-[hsl(var(--destructive))]">
              <AlertTriangle aria-hidden="true" size={22} strokeWidth={2.2} className="mt-0.5 shrink-0" />
              <div className="min-w-0">
                <h2 className="font-display text-lg font-semibold tracking-[-0.02em] text-[hsl(var(--foreground))]">
                  Could not read the roster
                </h2>
                <p className="mt-1.5 text-sm leading-5 text-[hsl(var(--muted-foreground))]">
                  This device’s storage did not answer. Nothing has been
                  deleted — the roster is still on the device.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void load()}
              disabled={isLoading}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg border border-[hsl(var(--destructive)/.6)] px-3 py-2 text-xs font-bold uppercase tracking-[0.14em] text-[hsl(var(--destructive))] transition hover:bg-[hsl(var(--destructive)/.12)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] disabled:cursor-not-allowed disabled:opacity-60 sm:w-fit"
              data-testid="button-roster-retry"
            >
              <RotateCcw aria-hidden="true" size={14} />
              Retry
            </button>
          </section>
        ) : isLoading ? (
          <p
            className="station-enter rounded-[1.7rem] border border-dashed border-[hsl(var(--primary)/.34)] bg-[hsl(var(--card)/.5)] px-5 py-10 text-center text-sm text-[hsl(var(--muted-foreground))]"
            aria-busy="true"
            data-testid="text-roster-loading"
          >
            Reading the roster from this device…
          </p>
        ) : (
          <div className="station-enter" style={{ animationDelay: '80ms' }}>
            <RosterManager
              persons={persons}
              onSave={handleSave}
              isSaving={isSaving}
              saveError={saveError}
            />
          </div>
        )}
      </div>
    </main>
  );
}
