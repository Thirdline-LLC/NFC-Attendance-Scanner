import { useId, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Pencil,
  Search,
  UserPlus,
  UserRoundSearch,
  Users,
  X,
} from 'lucide-react';
import type { Person } from '@/data/attendance-store';
import { maskCardUid, normalizeUid } from '@/lib/scan-format';
import { normalizeNamePart } from '@/lib/student-email';
import { EnrollmentForm } from '@/ui/EnrollmentForm';

/** The fields a student's row can change; the card UID is deliberately absent. */
export type PersonChanges = Pick<
  Person,
  'firstName' | 'lastName' | 'gradYear' | 'email'
>;

type RosterManagerProps = {
  persons: Person[];
  /**
   * Resolves true once the change is in IndexedDB, false when the container
   * could not write it — in which case it also raises `saveError`.
   */
  onSave: (personId: number, changes: PersonChanges) => Promise<boolean>;
  isSaving: boolean;
  /** Shown inside the open editor as the form's "Could not save locally" notice. */
  saveError: boolean;
  initialQuery?: string;
};

/** The four characters a search may match; the screen shows them masked. */
function cardTail(cardUid: string): string {
  return cardUid.slice(-4);
}

/**
 * Last name, then first name, ignoring case and accents. Rosters arrive in
 * enrollment order, which means nothing to someone scanning for a name.
 */
function compareByName(a: Person, b: Person): number {
  return (
    a.lastName.localeCompare(b.lastName, 'en', { sensitivity: 'base' }) ||
    a.firstName.localeCompare(b.firstName, 'en', { sensitivity: 'base' })
  );
}

/**
 * The query as name fragments, each folded the way an email local part is, so
 * "elodie" finds Élodie and "obrien" finds O'Brien. Null when the query cannot
 * be a name: digits never occur in one, so a fragment carrying a digit is an
 * email or card fragment and is left to those matchers — otherwise a card tail
 * like "E5F6" would also pull in everyone with an "ef" in their name.
 */
function nameFragments(query: string): string[] | null {
  const words = query.split(/\s+/).filter((word) => word !== '');
  if (words.length === 0 || words.some((word) => /\d/.test(word))) return null;

  const fragments = words.map(normalizeNamePart);
  return fragments.some((fragment) => fragment === '') ? null : fragments;
}

function matchesQuery(person: Person, query: string): boolean {
  const fragments = nameFragments(query);
  if (fragments) {
    const first = normalizeNamePart(person.firstName);
    const last = normalizeNamePart(person.lastName);
    // Every fragment has to land on one of the names, so "jane sm" finds Jane
    // Smith while "esm", a run across the boundary between them, does not.
    if (
      fragments.every(
        (fragment) => first.includes(fragment) || last.includes(fragment),
      )
    ) {
      return true;
    }
  }

  if (person.email.toLowerCase().includes(query.toLowerCase())) return true;

  // The tail is all anyone can read off a masked card, so any piece of it is
  // enough. A whole UID matches too: with the search field focused, tapping a
  // card on the reader types it straight in.
  const uidQuery = normalizeUid(query);
  return (
    /^[0-9A-F]+$/.test(uidQuery) &&
    (cardTail(person.cardUid).includes(uidQuery) ||
      person.cardUid.endsWith(uidQuery))
  );
}

function countLabel(shown: number, total: number, filtering: boolean): string {
  const noun = total === 1 ? 'student' : 'students';
  return filtering ? `${shown} of ${total} ${noun}` : `${total} ${noun}`;
}

export function RosterManager({
  persons,
  onSave,
  isSaving,
  saveError,
  initialQuery = '',
}: RosterManagerProps) {
  const headingId = useId();
  const searchId = useId();
  const [query, setQuery] = useState(initialQuery);
  const [editingId, setEditingId] = useState<number | null>(null);

  const sorted = useMemo(() => [...persons].sort(compareByName), [persons]);
  const trimmedQuery = query.trim();
  const isFiltering = trimmedQuery !== '';
  const visible = useMemo(
    () =>
      isFiltering
        ? // A row being edited stays put whatever the query, so a search typed
          // mid-edit cannot unmount the form and discard what was entered.
          sorted.filter(
            (person) =>
              person.id === editingId || matchesQuery(person, trimmedQuery),
          )
        : sorted,
    [sorted, trimmedQuery, isFiltering, editingId],
  );

  const toggleEditing = (personId: number) => {
    setEditingId((current) => (current === personId ? null : personId));
  };

  const saveRow = async (personId: number, changes: PersonChanges) => {
    const saved = await onSave(personId, changes);
    // Another row may have been opened while the write was in flight; only the
    // editor that asked for this save should close on its success.
    if (saved) {
      setEditingId((current) => (current === personId ? null : current));
    }
  };

  return (
    <section
      className="rounded-[1.7rem] border border-[hsl(var(--border))] bg-[hsl(var(--card)/.88)] p-5 shadow-[0_24px_70px_hsl(211_55%_5%/.28)] sm:p-7"
      aria-labelledby={headingId}
      data-testid="roster-manager"
    >
      <header className="flex items-start gap-3">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl border border-[hsl(var(--primary)/.5)] bg-[hsl(var(--primary)/.1)] text-[hsl(var(--primary))]">
          <Users aria-hidden="true" size={22} strokeWidth={2.2} />
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.19em] text-[hsl(var(--muted-foreground))]">
            Local roster
          </p>
          <h2
            id={headingId}
            className="mt-0.5 font-display text-xl font-semibold tracking-[-0.025em] text-[hsl(var(--foreground))] sm:text-2xl"
          >
            Manage students
          </h2>
          <p className="mt-1.5 text-sm leading-5 text-[hsl(var(--muted-foreground))]">
            Correct a name, class year or email here. The card a student
            enrolled with stays theirs.
          </p>
        </div>
      </header>

      <div className="mt-6 grid gap-1.5 text-xs font-semibold text-[hsl(var(--muted-foreground))]">
        <label htmlFor={searchId}>Search students</label>
        <div className="relative">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]"
            size={16}
          />
          <input
            id={searchId}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Name, email, or the last 4 of a card"
            className="w-full appearance-none rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] py-3 pl-10 pr-11 text-base font-normal text-[hsl(var(--foreground))] outline-none transition focus:border-[hsl(var(--primary))] focus:ring-2 focus:ring-[hsl(var(--primary)/.2)] sm:text-sm [&::-webkit-search-cancel-button]:appearance-none"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            data-testid="input-roster-search"
          />
          {query !== '' ? (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-lg text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--secondary))] hover:text-[hsl(var(--foreground))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
              data-testid="button-roster-clear"
            >
              <X aria-hidden="true" size={16} />
            </button>
          ) : null}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p
          className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[hsl(var(--muted-foreground))]"
          aria-live="polite"
          data-testid="text-roster-count"
        >
          {countLabel(visible.length, persons.length, isFiltering)}
        </p>
        {/* With no editor open there is nowhere else for a failed write to
            show, so it is noted here rather than lost. */}
        {saveError && editingId === null ? (
          <p
            className="flex items-center gap-1.5 text-xs font-semibold text-[hsl(var(--destructive))]"
            role="status"
          >
            <AlertTriangle aria-hidden="true" size={14} />
            Last change could not be saved locally
          </p>
        ) : null}
      </div>

      {persons.length === 0 ? (
        <EmptyNotice
          icon={<UserPlus aria-hidden="true" size={26} strokeWidth={1.8} />}
          title="No students enrolled yet"
          detail="Switch the scanner to Enroll and tap a card to add the first one."
          testId="text-roster-empty"
        />
      ) : visible.length === 0 ? (
        <EmptyNotice
          icon={
            <UserRoundSearch aria-hidden="true" size={26} strokeWidth={1.8} />
          }
          title={`No students match “${trimmedQuery}”`}
          detail="Try a first or last name, an email, or the last 4 characters of a card."
          testId="text-roster-no-match"
        />
      ) : (
        <div className="mt-3 overflow-hidden rounded-2xl border border-[hsl(var(--border)/.75)] bg-[hsl(var(--background)/.45)]">
          {/* Below the `sm` breakpoint each row lays itself out as a stacked
              card; the header row is then visually hidden but stays in the
              tree so the cells keep their column names for screen readers. */}
          <table
            className="block w-full border-collapse text-sm sm:table"
            data-testid="table-roster"
          >
            <thead className="sr-only sm:not-sr-only sm:table-header-group">
              <tr className="sm:table-row">
                <HeaderCell>First name</HeaderCell>
                <HeaderCell>Last name</HeaderCell>
                <HeaderCell>Class of</HeaderCell>
                <HeaderCell>Email</HeaderCell>
                <HeaderCell>Card</HeaderCell>
                <HeaderCell>
                  <span className="sr-only">Actions</span>
                </HeaderCell>
              </tr>
            </thead>
            <tbody className="block sm:table-row-group">
              {visible.map((person) => (
                <RosterRow
                  key={person.id ?? person.cardUid}
                  person={person}
                  roster={persons}
                  isEditing={
                    person.id !== undefined && person.id === editingId
                  }
                  isSaving={isSaving}
                  saveError={saveError}
                  onToggle={toggleEditing}
                  onSave={saveRow}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function HeaderCell({ children }: { children: React.ReactNode }) {
  return (
    <th
      scope="col"
      className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-[0.16em] text-[hsl(var(--muted-foreground))]"
    >
      {children}
    </th>
  );
}

type RosterRowProps = {
  person: Person;
  roster: Person[];
  isEditing: boolean;
  isSaving: boolean;
  saveError: boolean;
  onToggle: (personId: number) => void;
  onSave: (personId: number, changes: PersonChanges) => Promise<void>;
};

function RosterRow({
  person,
  roster,
  isEditing,
  isSaving,
  saveError,
  onToggle,
  onSave,
}: RosterRowProps) {
  const editorId = useId();
  // Rows come from Dexie, which always assigns an id; the guard only keeps the
  // shared `Person` type honest, and a row without one is simply read-only.
  const personId = person.id;
  const rowTone = isEditing
    ? 'bg-[hsl(var(--primary)/.07)]'
    : 'hover:bg-[hsl(var(--secondary)/.35)]';

  return (
    <>
      <tr
        className={`flex flex-wrap items-center gap-x-1.5 gap-y-1 border-t border-[hsl(var(--border)/.6)] px-4 py-3 transition-colors first:border-t-0 sm:table-row sm:p-0 ${rowTone}`}
        data-testid={`row-person-${personId ?? 'unsaved'}`}
      >
        <td className="font-semibold text-[hsl(var(--foreground))] sm:whitespace-nowrap sm:px-4 sm:py-3">
          {person.firstName}
        </td>
        <td className="font-semibold text-[hsl(var(--foreground))] sm:whitespace-nowrap sm:px-4 sm:py-3">
          {person.lastName}
        </td>
        <td className="order-1 basis-full text-[hsl(var(--muted-foreground))] sm:order-none sm:basis-auto sm:whitespace-nowrap sm:px-4 sm:py-3 sm:text-[hsl(var(--foreground))]">
          <span className="sm:hidden">Class of </span>
          {person.gradYear}
        </td>
        <td className="order-2 basis-full text-[hsl(var(--muted-foreground))] [overflow-wrap:anywhere] sm:order-none sm:basis-auto sm:px-4 sm:py-3 sm:text-[hsl(var(--foreground))]">
          {person.email}
        </td>
        <td className="ml-auto font-mono text-xs font-bold tracking-[0.16em] text-[hsl(var(--foreground))] sm:ml-0 sm:whitespace-nowrap sm:px-4 sm:py-3 sm:text-sm">
          <span data-testid={`text-card-tail-${personId ?? 'unsaved'}`}>
            {maskCardUid(person.cardUid)}
          </span>
        </td>
        <td className="order-3 mt-1 basis-full sm:order-none sm:mt-0 sm:basis-auto sm:whitespace-nowrap sm:px-4 sm:py-3 sm:text-right">
          {personId !== undefined ? (
            <button
              type="button"
              onClick={() => onToggle(personId)}
              // Every row's button reads "Edit", so the name says whose.
              aria-label={`Edit ${person.firstName} ${person.lastName}`}
              aria-expanded={isEditing}
              aria-controls={isEditing ? editorId : undefined}
              className={`flex w-full items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] sm:w-auto ${
                isEditing
                  ? 'border-[hsl(var(--primary)/.7)] bg-[hsl(var(--primary)/.12)] text-[hsl(var(--primary))]'
                  : 'border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--secondary))] hover:text-[hsl(var(--foreground))]'
              }`}
              data-testid={`button-edit-person-${personId}`}
            >
              <Pencil aria-hidden="true" size={14} />
              Edit
            </button>
          ) : null}
        </td>
      </tr>
      {isEditing && personId !== undefined ? (
        <tr
          id={editorId}
          className="block bg-[hsl(var(--primary)/.07)] sm:table-row"
          data-testid={`row-editor-${personId}`}
        >
          <td colSpan={6} className="block px-3 pb-4 sm:table-cell sm:px-4">
            <EnrollmentForm
              candidate={{ uid: person.cardUid, person }}
              roster={roster}
              isSaving={isSaving}
              storageError={saveError}
              onSave={(changes) => onSave(personId, changes)}
              onCancel={() => onToggle(personId)}
            />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function EmptyNotice({
  icon,
  title,
  detail,
  testId,
}: {
  icon: React.ReactNode;
  title: string;
  detail: string;
  testId: string;
}) {
  return (
    <div
      className="mt-3 flex flex-col items-center gap-3 rounded-2xl border border-dashed border-[hsl(var(--primary)/.34)] bg-[hsl(var(--background)/.45)] px-5 py-10 text-center"
      data-testid={testId}
    >
      <div className="flex size-12 items-center justify-center rounded-2xl bg-[hsl(var(--primary)/.1)] text-[hsl(var(--primary))]">
        {icon}
      </div>
      <p className="font-display text-lg font-semibold tracking-[-0.02em] text-[hsl(var(--foreground))]">
        {title}
      </p>
      <p className="max-w-sm text-sm leading-5 text-[hsl(var(--muted-foreground))]">
        {detail}
      </p>
    </div>
  );
}
