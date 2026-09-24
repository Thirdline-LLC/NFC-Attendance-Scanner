import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Layers } from 'lucide-react';
import type { AttendanceBody } from '@/data/attendance-store';
import {
  bodyDepth,
  depthWarning,
  flattenBodyTree,
  isArchived,
  wouldCycle,
  type BodyTreeRow,
} from '@/data/body-hierarchy';
import { useTheme } from '@/theme/ThemeProvider';
import { useModalFocusTrap } from '@/ui/use-modal-focus-trap';

type BodySwitcherDialogProps = {
  bodies: AttendanceBody[];
  activeBodyId?: number;
  isWorking: boolean;
  error: string | null;
  /** Points the device at an existing non-archived body. */
  onSelect: (bodyId: number) => void;
  /** Creates a root (`parentId` null) or a child, then the page attaches to it. */
  onCreate: (input: { name: string; typeLabel: string; parentId: number | null }) => void;
  onRename: (input: { bodyId: number; name: string; typeLabel: string }) => void;
  onReparent: (input: { bodyId: number; parentId: number | null }) => void;
  onArchive: (bodyId: number) => void;
  onRestore: (bodyId: number) => void;
  onCancel: () => void;
};

/**
 * Reassignment and structure edits (D-T2). Picking a body only moves
 * `activeBodyId`. Creating, renaming, reparenting, or archiving does not
 * touch any roster or tap history. The scanner screen has no control that
 * reaches this dialog — the desk stays on the body it opened with.
 *
 * Type labels are free text. Theme `bodyTypePresets` are suggestions in the
 * datalist, not a closed set of modes.
 */
export function BodySwitcherDialog({
  bodies,
  activeBodyId,
  isWorking,
  error,
  onSelect,
  onCreate,
  onRename,
  onReparent,
  onArchive,
  onRestore,
  onCancel,
}: BodySwitcherDialogProps) {
  const { active } = useTheme();
  const suggestions = (active.bodyTypePresets ?? []).map((preset) => preset.label);
  const [name, setName] = useState('');
  const [typeLabel, setTypeLabel] = useState('');
  const [parentId, setParentId] = useState('');
  const [query, setQuery] = useState('');
  const [structureId, setStructureId] = useState('');
  const [structureName, setStructureName] = useState('');
  const [structureType, setStructureType] = useState('');
  const [structureParent, setStructureParent] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<Element | null>(null);
  useModalFocusTrap(dialogRef);

  const rows = useMemo(() => flattenBodyTree(bodies), [bodies]);
  const rowById = useMemo(() => {
    const map = new Map<number, BodyTreeRow>();
    for (const row of rows) {
      if (row.body.id !== undefined) map.set(row.body.id, row);
    }
    return map;
  }, [rows]);

  const visibleRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) => {
      const haystack = `${row.body.name} ${row.body.typeLabel} ${row.path}`.toLowerCase();
      return haystack.includes(needle);
    });
  }, [query, rows]);

  const creatableParents = rows.filter((row) => row.body.id !== undefined && !isArchived(row.body));
  const nextDepth =
    parentId === '' ? 1 : bodyDepth(Number(parentId), bodies) + 1;
  const createDepthWarning = depthWarning(nextDepth);
  const canCreate = !isWorking && name.trim().length > 0 && typeLabel.trim().length > 0;

  const structureBody = structureId ? rowById.get(Number(structureId))?.body : undefined;
  const reparentTargets = rows.filter((row) => {
    if (row.body.id === undefined || !structureBody?.id) return false;
    if (isArchived(row.body)) return false;
    return !wouldCycle(bodies, structureBody.id, row.body.id);
  });

  useEffect(() => {
    previouslyFocused.current = document.activeElement;
    return () => {
      const previous = previouslyFocused.current;
      if (previous instanceof HTMLElement && document.contains(previous)) {
        previous.focus();
      }
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onCancel();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  const chooseStructure = (value: string) => {
    setStructureId(value);
    const body = value ? rowById.get(Number(value))?.body : undefined;
    setStructureName(body?.name ?? '');
    setStructureType(body?.typeLabel ?? '');
    setStructureParent(body?.parentId == null ? '' : String(body.parentId));
  };

  return (
    <div
      ref={dialogRef}
      className="fixed inset-0 z-40 flex overflow-y-auto overscroll-contain bg-[hsl(var(--background)/.86)] px-5 py-8 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="body-switcher-title"
      data-testid="dialog-body-switcher"
    >
      <div className="m-auto w-full max-w-md rounded-[1.35rem] border border-[hsl(var(--primary)/.45)] bg-[hsl(var(--card))] p-5 shadow-[0_24px_90px_hsl(211_55%_5%/.5)] sm:p-6">
        <div className="flex items-start gap-2.5">
          <Layers aria-hidden="true" className="mt-0.5 shrink-0 text-[hsl(var(--primary))]" size={18} />
          <div className="min-w-0">
            <h2
              id="body-switcher-title"
              className="font-display text-lg font-semibold tracking-[-0.02em] text-[hsl(var(--foreground))]"
            >
              Change body
            </h2>
            <p className="mt-2 text-sm leading-snug text-[hsl(var(--muted-foreground))]">
              Every body keeps its own roster and history. Switching only
              changes which one this device scans for — nothing is deleted.
              The check-in screen stays on the body you pick here.
            </p>
          </div>
        </div>

        <label htmlFor="body-search" className="mt-4 block">
          <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[hsl(var(--muted-foreground))]">
            Search
          </span>
          <input
            id="body-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Name, type label, or path"
            className="mt-1.5 w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background)/.6)] px-3 py-2.5 text-sm text-[hsl(var(--foreground))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
            data-testid="input-body-search"
          />
        </label>

        {visibleRows.length > 0 ? (
          <ul className="mt-4 grid gap-2" data-testid="list-bodies">
            {visibleRows.map((row) => {
              const body = row.body;
              const archived = isArchived(body);
              const active = body.id === activeBodyId;
              return (
                <li key={body.id} className="flex items-stretch gap-2">
                  <button
                    type="button"
                    onClick={() => body.id !== undefined && onSelect(body.id)}
                    disabled={isWorking || active || archived || body.id === undefined}
                    style={{ paddingLeft: `${12 + (row.depth - 1) * 14}px` }}
                    className="flex min-w-0 flex-1 items-center justify-between gap-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background)/.5)] py-2.5 pr-3 text-left text-sm text-[hsl(var(--foreground))] transition hover:bg-[hsl(var(--secondary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] disabled:cursor-not-allowed disabled:opacity-70"
                    data-testid={`button-body-${body.id}`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate">
                        {body.name}{' '}
                        <span className="text-[hsl(var(--muted-foreground))]">· {body.typeLabel}</span>
                        {archived ? (
                          <span className="text-[hsl(var(--muted-foreground))]"> · Archived</span>
                        ) : null}
                      </span>
                      {row.depth > 1 ? (
                        <span className="mt-0.5 block truncate text-xs text-[hsl(var(--muted-foreground))]">
                          {row.path}
                        </span>
                      ) : null}
                    </span>
                    {active ? (
                      <Check aria-hidden="true" size={15} className="shrink-0 text-[hsl(var(--primary))]" />
                    ) : null}
                  </button>
                  {archived && body.id !== undefined ? (
                    <button
                      type="button"
                      onClick={() => onRestore(body.id as number)}
                      disabled={isWorking}
                      className="shrink-0 rounded-xl border border-[hsl(var(--border))] px-3 text-xs font-semibold text-[hsl(var(--foreground))] hover:bg-[hsl(var(--secondary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] disabled:opacity-60"
                      data-testid={`button-restore-body-${body.id}`}
                    >
                      Restore
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-4 text-sm text-[hsl(var(--muted-foreground))]" data-testid="text-body-search-empty">
            No body matches that search.
          </p>
        )}

        <form
          className="mt-5 grid gap-3 border-t border-[hsl(var(--border))] pt-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!canCreate) return;
            onCreate({
              name: name.trim(),
              typeLabel: typeLabel.trim(),
              parentId: parentId === '' ? null : Number(parentId),
            });
          }}
        >
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[hsl(var(--muted-foreground))]">
            Or create a body
          </p>
          <label htmlFor="body-name" className="block">
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[hsl(var(--muted-foreground))]">
              Name
            </span>
            <input
              id="body-name"
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="mt-1.5 w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background)/.6)] px-3 py-2.5 text-sm text-[hsl(var(--foreground))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
              data-testid="input-body-name"
            />
          </label>
          <label htmlFor="body-type" className="block">
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[hsl(var(--muted-foreground))]">
              Type label
            </span>
            <input
              id="body-type"
              type="text"
              list="body-type-suggestions"
              value={typeLabel}
              onChange={(event) => setTypeLabel(event.target.value)}
              placeholder="Any label you use"
              className="mt-1.5 w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background)/.6)] px-3 py-2.5 text-sm text-[hsl(var(--foreground))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
              data-testid="input-body-type"
            />
            <datalist id="body-type-suggestions">
              {suggestions.map((label) => (
                <option key={label} value={label} />
              ))}
            </datalist>
          </label>
          <label htmlFor="body-parent" className="block">
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[hsl(var(--muted-foreground))]">
              Under
            </span>
            <select
              id="body-parent"
              value={parentId}
              onChange={(event) => setParentId(event.target.value)}
              className="mt-1.5 w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background)/.6)] px-3 py-2.5 text-sm text-[hsl(var(--foreground))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
              data-testid="select-body-parent"
            >
              <option value="">No parent (a new root)</option>
              {creatableParents.map((row) => (
                <option key={row.body.id} value={row.body.id}>
                  {row.path}
                </option>
              ))}
            </select>
          </label>
          {createDepthWarning ? (
            <p className="text-xs text-[hsl(var(--muted-foreground))]" data-testid="text-body-depth-warning">
              {createDepthWarning}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={!canCreate}
            className="mt-1 flex items-center justify-center gap-2 rounded-xl bg-[hsl(var(--primary))] px-4 py-3 text-sm font-bold text-[hsl(var(--primary-foreground))] transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] disabled:cursor-not-allowed disabled:opacity-60"
            data-testid="button-body-create"
          >
            {isWorking ? 'Working…' : 'Create and switch'}
          </button>
        </form>

        <form
          className="mt-5 grid gap-3 border-t border-[hsl(var(--border))] pt-4"
          onSubmit={(event) => event.preventDefault()}
        >
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[hsl(var(--muted-foreground))]">
            Rename, move, or archive
          </p>
          <label htmlFor="structure-body" className="block">
            <span className="sr-only">Body to edit</span>
            <select
              id="structure-body"
              value={structureId}
              onChange={(event) => chooseStructure(event.target.value)}
              className="w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background)/.6)] px-3 py-2.5 text-sm text-[hsl(var(--foreground))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
              data-testid="select-structure-body"
            >
              <option value="">Choose a body</option>
              {rows.map((row) =>
                row.body.id === undefined ? null : (
                  <option key={row.body.id} value={row.body.id}>
                    {row.path}
                    {isArchived(row.body) ? ' (archived)' : ''}
                  </option>
                ),
              )}
            </select>
          </label>
          {structureBody?.id !== undefined ? (
            <>
              <input
                type="text"
                value={structureName}
                onChange={(event) => setStructureName(event.target.value)}
                aria-label="Body name"
                className="w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background)/.6)] px-3 py-2.5 text-sm text-[hsl(var(--foreground))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
                data-testid="input-structure-name"
              />
              <input
                type="text"
                value={structureType}
                onChange={(event) => setStructureType(event.target.value)}
                aria-label="Type label"
                className="w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background)/.6)] px-3 py-2.5 text-sm text-[hsl(var(--foreground))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
                data-testid="input-structure-type"
              />
              <button
                type="button"
                disabled={isWorking || !structureName.trim() || !structureType.trim()}
                onClick={() =>
                  onRename({
                    bodyId: structureBody.id as number,
                    name: structureName.trim(),
                    typeLabel: structureType.trim(),
                  })
                }
                className="rounded-xl border border-[hsl(var(--border))] px-4 py-2.5 text-sm font-semibold text-[hsl(var(--foreground))] hover:bg-[hsl(var(--secondary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] disabled:opacity-60"
                data-testid="button-structure-rename"
              >
                Save name and type label
              </button>
              <label htmlFor="structure-parent" className="block">
                <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[hsl(var(--muted-foreground))]">
                  Move under
                </span>
                <select
                  id="structure-parent"
                  value={structureParent}
                  onChange={(event) => setStructureParent(event.target.value)}
                  className="mt-1.5 w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background)/.6)] px-3 py-2.5 text-sm text-[hsl(var(--foreground))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
                  data-testid="select-structure-parent"
                >
                  <option value="">No parent (root)</option>
                  {reparentTargets.map((row) => (
                    <option key={row.body.id} value={row.body.id}>
                      {row.path}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                disabled={isWorking}
                onClick={() =>
                  onReparent({
                    bodyId: structureBody.id as number,
                    parentId: structureParent === '' ? null : Number(structureParent),
                  })
                }
                className="rounded-xl border border-[hsl(var(--border))] px-4 py-2.5 text-sm font-semibold text-[hsl(var(--foreground))] hover:bg-[hsl(var(--secondary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] disabled:opacity-60"
                data-testid="button-structure-reparent"
              >
                Move
              </button>
              <button
                type="button"
                disabled={isWorking || structureBody.id === activeBodyId || isArchived(structureBody)}
                onClick={() => onArchive(structureBody.id as number)}
                className="rounded-xl border border-[hsl(var(--destructive)/.6)] px-4 py-2.5 text-sm font-semibold text-[hsl(var(--destructive))] hover:bg-[hsl(var(--destructive)/.12)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] disabled:opacity-60"
                data-testid="button-structure-archive"
              >
                Archive
              </button>
            </>
          ) : null}
        </form>

        {error ? (
          <p
            className="mt-3 text-sm font-semibold text-[hsl(var(--destructive))]"
            role="alert"
            data-testid="text-body-error"
          >
            {error}
          </p>
        ) : null}

        <button
          type="button"
          onClick={onCancel}
          className="mt-4 w-full text-xs font-semibold text-[hsl(var(--muted-foreground))] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
          data-testid="button-body-cancel"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
