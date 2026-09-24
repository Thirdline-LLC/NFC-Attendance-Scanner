import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronRight, Layers } from 'lucide-react';
import type {
  AttendanceBody,
  BodyFieldDef,
  BodyTypeDef,
  ClassWithPeriods,
  CreateClassWithPeriodsInput,
} from '@/data/attendance-store';
import {
  bodyDepth,
  childCountLabel,
  depthWarning,
  flattenBodyTree,
  isArchived,
  wouldCycle,
  type BodyTreeRow,
} from '@/data/body-hierarchy';
import {
  fieldDefsFor,
  mergeTypeSuggestions,
  missingRequiredFields,
  sameLabel,
} from '@/data/body-vocabulary';
import { useTheme } from '@/theme/ThemeProvider';
import { useModalFocusTrap } from '@/ui/use-modal-focus-trap';
import { ClassSetupForm, ClassTemplateFollowUp } from '@/ui/ClassSetupForm';

type BodySwitcherDialogProps = {
  bodies: AttendanceBody[];
  activeBodyId?: number;
  isWorking: boolean;
  error: string | null;
  /** The admin's saved type-label vocabulary (08b) — datalist suggestions. */
  typeDefs: BodyTypeDef[];
  /** Which custom fields apply to which type label (08b). */
  fieldDefs: BodyFieldDef[];
  /** Points the device at an existing non-archived body. */
  onSelect: (bodyId: number) => void;
  /** Creates a root (`parentId` null) or a child, then the page attaches to it. */
  onCreate: (input: {
    name: string;
    typeLabel: string;
    parentId: number | null;
    customFields: Record<string, string>;
  }) => void;
  onRename: (input: {
    bodyId: number;
    name: string;
    typeLabel: string;
    customFields: Record<string, string>;
  }) => void;
  onReparent: (input: { bodyId: number; parentId: number | null }) => void;
  /** Design 09 §1: a class and its periods in one write. */
  onCreateClass: (input: Required<CreateClassWithPeriodsInput>) => void;
  /**
   * Set once a class was just created: the dialog swaps to the "Add students
   * to each period" step for it. Done / Skip for now closes via `onCancel`.
   */
  classSetup?: ClassWithPeriods | null;
  onArchive: (bodyId: number) => void;
  onRestore: (bodyId: number) => void;
  /** Writes `customFields` for an existing body (08b). */
  onSaveCustomFields: (input: { bodyId: number; customFields: Record<string, string> }) => void;
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
  typeDefs,
  fieldDefs,
  onSelect,
  onCreate,
  onRename,
  onReparent,
  onCreateClass,
  classSetup = null,
  onArchive,
  onRestore,
  onSaveCustomFields,
  onCancel,
}: BodySwitcherDialogProps) {
  const { active } = useTheme();
  const themePresetLabels = (active.bodyTypePresets ?? []).map((preset) => preset.label);
  const suggestions = useMemo(
    () => mergeTypeSuggestions(typeDefs, themePresetLabels),
    [typeDefs, themePresetLabels],
  );
  const [name, setName] = useState('');
  const [typeLabel, setTypeLabel] = useState('');
  const [parentId, setParentId] = useState('');
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, string>>({});
  const [query, setQuery] = useState('');
  const [createMode, setCreateMode] = useState<'single' | 'class'>('single');
  const [structureId, setStructureId] = useState('');
  const [structureName, setStructureName] = useState('');
  const [structureType, setStructureType] = useState('');
  const [structureParent, setStructureParent] = useState('');
  const [structureFieldValues, setStructureFieldValues] = useState<Record<string, string>>({});
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<Element | null>(null);
  useModalFocusTrap(dialogRef);

  const createFieldDefs = fieldDefsFor(typeLabel, fieldDefs);
  const missingCreateFields = missingRequiredFields(typeLabel, fieldDefs, customFieldValues);
  const structureFieldDefs = fieldDefsFor(structureType, fieldDefs);
  const missingStructureFields = missingRequiredFields(
    structureType,
    fieldDefs,
    structureFieldValues,
  );

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
  const canCreate =
    !isWorking &&
    name.trim().length > 0 &&
    typeLabel.trim().length > 0 &&
    missingCreateFields.length === 0;

  const structureBody = structureId ? rowById.get(Number(structureId))?.body : undefined;
  const reparentTargets = rows.filter((row) => {
    if (row.body.id === undefined || !structureBody?.id) return false;
    if (isArchived(row.body)) return false;
    return !wouldCycle(bodies, structureBody.id, row.body.id);
  });
  // The store only enforces required fields on a type label that actually
  // changes (see `renameBody`) — a name-only edit must stay saveable even
  // when a field def added after this body was created is missing.
  const structureTypeChanging = structureBody
    ? !sameLabel(structureType, structureBody.typeLabel)
    : false;
  // `renameBody` takes this draft's `structureFieldValues` along with the
  // rename and validates the merged result, so a required value typed here
  // is enough on its own — no separate "Save custom fields" click needed
  // first. The button still blocks the click that is certain to fail.
  const blocksRename = structureTypeChanging && missingStructureFields.length > 0;

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
    const fullBody = value ? bodies.find((candidate) => candidate.id === Number(value)) : undefined;
    setStructureName(body?.name ?? '');
    setStructureType(body?.typeLabel ?? '');
    setStructureParent(body?.parentId == null ? '' : String(body.parentId));
    setStructureFieldValues({ ...(fullBody?.customFields ?? {}) });
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
        <datalist id="body-type-suggestions">
          {suggestions.map((label) => (
            <option key={label} value={label} />
          ))}
        </datalist>
        {classSetup ? (
          <ClassTemplateFollowUp
            parent={classSetup.parent}
            periods={classSetup.periods}
            onDone={onCancel}
          />
        ) : (
        <>
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
          <BodyTreeList
            rows={visibleRows}
            // A search shows every match flat, so a hit inside a collapsed
            // group is never hidden behind its parent.
            grouped={query.trim().length === 0}
            activeBodyId={activeBodyId}
            isWorking={isWorking}
            onSelect={onSelect}
            onRestore={onRestore}
          />
        ) : (
          <p className="mt-4 text-sm text-[hsl(var(--muted-foreground))]" data-testid="text-body-search-empty">
            No body matches that search.
          </p>
        )}

        <section
          className="mt-5 grid gap-3 border-t border-[hsl(var(--border))] pt-4"
          aria-labelledby="body-add-title"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3
              id="body-add-title"
              className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[hsl(var(--muted-foreground))]"
            >
              Add a body
            </h3>
            <div
              role="group"
              aria-label="What to add"
              className="flex rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--background)/.5)] p-1"
            >
              {(
                [
                  ['single', 'Single body'],
                  ['class', 'Class with periods'],
                ] as const
              ).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={createMode === mode}
                  onClick={() => setCreateMode(mode)}
                  className={`min-h-11 rounded-full px-3.5 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] ${
                    createMode === mode
                      ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]'
                      : 'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]'
                  }`}
                  data-testid={`button-add-mode-${mode}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {createMode === 'single' ? (
          <form
            className="grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (!canCreate) return;
              onCreate({
                name: name.trim(),
                typeLabel: typeLabel.trim(),
                parentId: parentId === '' ? null : Number(parentId),
                customFields: customFieldValues,
              });
            }}
          >
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
            <CustomFieldInputs
              idPrefix="create"
              defs={createFieldDefs}
              values={customFieldValues}
              onChange={(label, value) =>
                setCustomFieldValues((prev) => ({ ...prev, [label]: value }))
              }
            />
            {missingCreateFields.length > 0 ? (
              <p className="text-xs text-[hsl(var(--muted-foreground))]" data-testid="text-create-fields-missing">
                {missingCreateFields.map((field) => field.label).join(', ')}{' '}
                {missingCreateFields.length === 1 ? 'is' : 'are'} required for this type.
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
          ) : (
            <ClassSetupForm
              isWorking={isWorking}
              fieldDefs={fieldDefs}
              typeSuggestionsId="body-type-suggestions"
              onCreate={onCreateClass}
            />
          )}
        </section>

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
                list="body-type-suggestions"
                value={structureType}
                onChange={(event) => setStructureType(event.target.value)}
                aria-label="Type label"
                className="w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background)/.6)] px-3 py-2.5 text-sm text-[hsl(var(--foreground))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
                data-testid="input-structure-type"
              />
              <button
                type="button"
                disabled={
                  isWorking || !structureName.trim() || !structureType.trim() || blocksRename
                }
                onClick={() =>
                  onRename({
                    bodyId: structureBody.id as number,
                    name: structureName.trim(),
                    typeLabel: structureType.trim(),
                    customFields: structureFieldValues,
                  })
                }
                className="rounded-xl border border-[hsl(var(--border))] px-4 py-2.5 text-sm font-semibold text-[hsl(var(--foreground))] hover:bg-[hsl(var(--secondary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] disabled:opacity-60"
                data-testid="button-structure-rename"
              >
                Save name and type label
              </button>
              {blocksRename ? (
                <p
                  className="text-xs text-[hsl(var(--muted-foreground))]"
                  data-testid="text-structure-rename-blocked"
                >
                  Fill in {missingStructureFields.map((field) => field.label).join(', ')} below
                  before changing the type to {structureType.trim()}.
                </p>
              ) : null}
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
              <CustomFieldInputs
                idPrefix="structure"
                defs={structureFieldDefs}
                values={structureFieldValues}
                onChange={(label, value) =>
                  setStructureFieldValues((prev) => ({ ...prev, [label]: value }))
                }
              />
              {structureFieldDefs.length > 0 ? (
                <>
                  {missingStructureFields.length > 0 ? (
                    <p
                      className="text-xs text-[hsl(var(--muted-foreground))]"
                      data-testid="text-structure-fields-missing"
                    >
                      {missingStructureFields.map((field) => field.label).join(', ')}{' '}
                      {missingStructureFields.length === 1 ? 'is' : 'are'} required for this
                      type.
                    </p>
                  ) : null}
                  <button
                    type="button"
                    disabled={isWorking || missingStructureFields.length > 0}
                    onClick={() =>
                      onSaveCustomFields({
                        bodyId: structureBody.id as number,
                        customFields: structureFieldValues,
                      })
                    }
                    className="rounded-xl border border-[hsl(var(--border))] px-4 py-2.5 text-sm font-semibold text-[hsl(var(--foreground))] hover:bg-[hsl(var(--secondary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] disabled:opacity-60"
                    data-testid="button-structure-save-fields"
                  >
                    Save custom fields
                  </button>
                </>
              ) : null}
            </>
          ) : null}
        </form>

        </>
        )}

        {error ? (
          <p
            className="mt-3 text-sm font-semibold text-[hsl(var(--destructive))]"
            role="alert"
            data-testid="text-body-error"
          >
            {error}
          </p>
        ) : null}

        {/* The template step has its own Skip for now / Done. */}
        {classSetup ? null : (
          <button
            type="button"
            onClick={onCancel}
            className="mt-4 w-full text-xs font-semibold text-[hsl(var(--muted-foreground))] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
            data-testid="button-body-cancel"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

type BodyTreeListProps = {
  rows: BodyTreeRow[];
  /** True: parents are collapsible groups. False: a flat list of matches. */
  grouped: boolean;
  activeBodyId?: number;
  isWorking: boolean;
  onSelect: (bodyId: number) => void;
  onRestore: (bodyId: number) => void;
};

/**
 * The 08a tree as collapsible groups (Design 09 §2). A parent row reads
 * `English 11 · 5 periods` and has its own disclosure button beside it;
 * children sit indented beneath in `sortOrder`. Every group starts open.
 * Which ones are closed is this component's state only — nothing is saved.
 */
function BodyTreeList({
  rows,
  grouped,
  activeBodyId,
  isWorking,
  onSelect,
  onRestore,
}: BodyTreeListProps) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<number>>(() => new Set());

  // Each row's direct children, read off the preorder walk: a row's parent
  // is the nearest earlier row one level up.
  const childrenOf = useMemo(() => {
    const map = new Map<number | null, BodyTreeRow[]>();
    const stack: BodyTreeRow[] = [];
    for (const row of rows) {
      while (stack.length >= row.depth) stack.pop();
      const parentId = stack.length > 0 ? (stack[stack.length - 1].body.id ?? null) : null;
      const list = map.get(parentId) ?? [];
      list.push(row);
      map.set(parentId, list);
      stack.push(row);
    }
    return map;
  }, [rows]);

  // Whether any root has a disclosure button, so leaf roots can keep their
  // names in the same column.
  const hasAnyGroup =
    grouped &&
    (childrenOf.get(null) ?? []).some(
      (row) => row.body.id !== undefined && (childrenOf.get(row.body.id)?.length ?? 0) > 0,
    );

  const toggle = (bodyId: number) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(bodyId)) next.delete(bodyId);
      else next.add(bodyId);
      return next;
    });

  const renderRow = (row: BodyTreeRow, children: BodyTreeRow[]) => {
    const body = row.body;
    const archived = isArchived(body);
    const active = body.id === activeBodyId;
    const isGroup = grouped && children.length > 0 && body.id !== undefined;
    const open = isGroup && !collapsed.has(body.id as number);
    const groupId = `body-children-${body.id}`;
    const indent = grouped ? 0 : (row.depth - 1) * 14;
    return (
      <div className="flex items-stretch gap-2">
        {isGroup ? (
          <button
            type="button"
            onClick={() => toggle(body.id as number)}
            aria-expanded={open}
            aria-controls={groupId}
            aria-label={`${open ? 'Collapse' : 'Expand'} ${body.name}`}
            className="flex w-11 shrink-0 items-center justify-center rounded-xl border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--secondary))] hover:text-[hsl(var(--foreground))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
            data-testid={`button-toggle-body-${body.id}`}
          >
            <ChevronRight
              aria-hidden="true"
              size={16}
              className={`transition-transform motion-reduce:transition-none ${open ? 'rotate-90' : ''}`}
            />
          </button>
        ) : grouped && row.depth === 1 && hasAnyGroup ? (
          // Keeps root names in one column whether or not the root has children.
          <span aria-hidden="true" className="w-11 shrink-0" />
        ) : null}
        <button
          type="button"
          onClick={() => body.id !== undefined && onSelect(body.id)}
          disabled={isWorking || active || archived || body.id === undefined}
          style={indent ? { paddingLeft: `${12 + indent}px` } : undefined}
          className="flex min-h-11 min-w-0 flex-1 items-center justify-between gap-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background)/.5)] py-2.5 pl-3 pr-3 text-left text-sm text-[hsl(var(--foreground))] transition hover:bg-[hsl(var(--secondary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] disabled:cursor-not-allowed disabled:opacity-70"
          data-testid={`button-body-${body.id}`}
        >
          <span className="min-w-0">
            <span className="block truncate">
              {body.name}{' '}
              {isGroup ? (
                <span
                  className="text-[hsl(var(--muted-foreground))]"
                  data-testid={`text-body-children-${body.id}`}
                >
                  · {childCountLabel(children.map((child) => child.body))}
                </span>
              ) : (
                <span className="text-[hsl(var(--muted-foreground))]">· {body.typeLabel}</span>
              )}
              {archived ? (
                <span className="text-[hsl(var(--muted-foreground))]"> · Archived</span>
              ) : null}
            </span>
            {isGroup ? (
              <span className="mt-0.5 block truncate text-xs text-[hsl(var(--muted-foreground))]">
                {body.typeLabel}
              </span>
            ) : row.depth > 1 && !grouped ? (
              /* Grouped, the indent already says where it sits; a flat
              search result needs the path to say it. */
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
            className="min-h-11 shrink-0 rounded-xl border border-[hsl(var(--border))] px-3 text-xs font-semibold text-[hsl(var(--foreground))] hover:bg-[hsl(var(--secondary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] disabled:opacity-60"
            data-testid={`button-restore-body-${body.id}`}
          >
            Restore
          </button>
        ) : null}
      </div>
    );
  };

  const renderBranch = (parentId: number | null, nested: boolean): ReactNode => {
    const branch = childrenOf.get(parentId) ?? [];
    return branch.map((row) => {
      const children = row.body.id === undefined ? [] : (childrenOf.get(row.body.id) ?? []);
      const isGroup = children.length > 0 && row.body.id !== undefined;
      return (
        <li key={row.body.id} className="grid gap-2">
          {renderRow(row, children)}
          {isGroup ? (
            <ul
              id={`body-children-${row.body.id}`}
              role="group"
              aria-label={`${row.body.name}: ${childCountLabel(children.map((child) => child.body))}`}
              hidden={collapsed.has(row.body.id as number)}
              className={`grid gap-2 border-l-2 border-[hsl(var(--primary)/.35)] pl-3 ${nested ? '' : 'ml-[1.375rem]'}`}
            >
              {renderBranch(row.body.id as number, true)}
            </ul>
          ) : null}
        </li>
      );
    });
  };

  if (!grouped) {
    return (
      <ul className="mt-4 grid gap-2" data-testid="list-bodies">
        {rows.map((row) => (
          <li key={row.body.id}>{renderRow(row, [])}</li>
        ))}
      </ul>
    );
  }

  return (
    <ul className="mt-4 grid gap-2" data-testid="list-bodies">
      {renderBranch(null, false)}
    </ul>
  );
}

/**
 * One text input per field def that applies to the type label currently in
 * play (08b) — the create form's `typeLabel` draft, or the structure
 * editor's. Renders nothing when the type has no field defs, so a body type
 * nobody has defined fields for looks exactly like it did in 08a.
 */
function CustomFieldInputs({
  idPrefix,
  defs,
  values,
  onChange,
}: {
  idPrefix: string;
  defs: BodyFieldDef[];
  values: Record<string, string>;
  onChange: (label: string, value: string) => void;
}) {
  if (defs.length === 0) return null;
  return (
    <div className="grid gap-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[hsl(var(--muted-foreground))]">
        Custom fields
      </p>
      {defs.map((def) => {
        // Keyed by label, not id: `values` (a body's `customFields`) is
        // itself keyed by label, so the DOM id a test or a screen reader
        // sees matches the key the save actually writes.
        const fieldId = `${idPrefix}-field-${def.label}`;
        return (
          <label key={fieldId} htmlFor={fieldId} className="block">
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[hsl(var(--muted-foreground))]">
              {def.label}
              {def.required ? ' *' : ''}
            </span>
            <input
              id={fieldId}
              type="text"
              value={values[def.label] ?? ''}
              onChange={(event) => onChange(def.label, event.target.value)}
              className="mt-1.5 w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background)/.6)] px-3 py-2.5 text-sm text-[hsl(var(--foreground))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
              data-testid={`input-${fieldId}`}
            />
          </label>
        );
      })}
    </div>
  );
}
