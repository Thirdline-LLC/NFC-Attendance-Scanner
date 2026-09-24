import { useEffect, useRef, useState } from 'react';
import { ListPlus } from 'lucide-react';
import type { BodyFieldDef, BodyTypeDef } from '@/data/attendance-store';
import { useModalFocusTrap } from '@/ui/use-modal-focus-trap';

type BodyVocabularyDialogProps = {
  typeDefs: BodyTypeDef[];
  fieldDefs: BodyFieldDef[];
  isWorking: boolean;
  error: string | null;
  onAddType: (label: string) => void;
  onRenameType: (input: { id: number; label: string }) => void;
  onDeleteType: (id: number) => void;
  onAddField: (input: { label: string; appliesToTypeLabel: string; required: boolean }) => void;
  onUpdateField: (input: {
    id: number;
    label: string;
    appliesToTypeLabel: string;
    required: boolean;
  }) => void;
  onDeleteField: (id: number) => void;
  onCancel: () => void;
};

const inputClass =
  'w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background)/.6)] px-3 py-2.5 text-sm text-[hsl(var(--foreground))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]';
const labelClass =
  'text-[10px] font-semibold uppercase tracking-[0.16em] text-[hsl(var(--muted-foreground))]';
const secondaryButtonClass =
  'rounded-xl border border-[hsl(var(--border))] px-3 py-2 text-xs font-semibold text-[hsl(var(--foreground))] hover:bg-[hsl(var(--secondary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] disabled:opacity-60';
const destructiveButtonClass =
  'rounded-xl border border-[hsl(var(--destructive)/.6)] px-3 py-2 text-xs font-semibold text-[hsl(var(--destructive))] hover:bg-[hsl(var(--destructive)/.12)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] disabled:opacity-60';

/**
 * PIN-gated admin screen for the 08b vocabulary: the saved type labels
 * (`BodyTypeDef`) and which custom fields apply to which one (`BodyFieldDef`).
 * Reachable only from the dashboard, the same security boundary as body
 * structure edits in `BodySwitcherDialog` — no new role.
 *
 * Editing here never rewrites a body directly except by name: renaming a
 * type def cascades onto every body and field def that used the old label
 * (see `renameBodyTypeDef`), so a rename here does not silently disconnect
 * anything already using that label.
 */
export function BodyVocabularyDialog({
  typeDefs,
  fieldDefs,
  isWorking,
  error,
  onAddType,
  onRenameType,
  onDeleteType,
  onAddField,
  onUpdateField,
  onDeleteField,
  onCancel,
}: BodyVocabularyDialogProps) {
  const [newType, setNewType] = useState('');
  const [typeDrafts, setTypeDrafts] = useState<Record<number, string>>({});

  const [newFieldLabel, setNewFieldLabel] = useState('');
  const [newFieldType, setNewFieldType] = useState('');
  const [newFieldRequired, setNewFieldRequired] = useState(false);
  const [fieldDrafts, setFieldDrafts] = useState<
    Record<number, { label: string; appliesToTypeLabel: string; required: boolean }>
  >({});

  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<Element | null>(null);
  useModalFocusTrap(dialogRef);

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

  const typeDraft = (def: BodyTypeDef): string => typeDrafts[def.id as number] ?? def.label;
  const fieldDraft = (def: BodyFieldDef) =>
    fieldDrafts[def.id as number] ?? {
      label: def.label,
      appliesToTypeLabel: def.appliesToTypeLabel,
      required: def.required,
    };

  return (
    <div
      ref={dialogRef}
      className="fixed inset-0 z-40 flex overflow-y-auto overscroll-contain bg-[hsl(var(--background)/.86)] px-5 py-8 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="body-vocabulary-title"
      data-testid="dialog-body-vocabulary"
    >
      <div className="m-auto w-full max-w-md rounded-[1.35rem] border border-[hsl(var(--primary)/.45)] bg-[hsl(var(--card))] p-5 shadow-[0_24px_90px_hsl(211_55%_5%/.5)] sm:p-6">
        <div className="flex items-start gap-2.5">
          <ListPlus aria-hidden="true" className="mt-0.5 shrink-0 text-[hsl(var(--primary))]" size={18} />
          <div className="min-w-0">
            <h2
              id="body-vocabulary-title"
              className="font-display text-lg font-semibold tracking-[-0.02em] text-[hsl(var(--foreground))]"
            >
              Body vocabulary
            </h2>
            <p className="mt-2 text-sm leading-snug text-[hsl(var(--muted-foreground))]">
              Body type is still free text everywhere it's typed — this list
              is only what shows up as a suggestion, and which custom fields
              go with each one.
            </p>
          </div>
        </div>

        <section className="mt-5 border-t border-[hsl(var(--border))] pt-4">
          <p className={labelClass}>Body types</p>
          {typeDefs.length === 0 ? (
            <p
              className="mt-2 text-sm text-[hsl(var(--muted-foreground))]"
              data-testid="text-body-types-empty"
            >
              Nothing saved yet. Creating or renaming a body adds its label
              here automatically.
            </p>
          ) : (
            <ul className="mt-3 grid gap-2" data-testid="list-body-types">
              {typeDefs.map((def) => (
                <li key={def.id} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={typeDraft(def)}
                    onChange={(event) =>
                      setTypeDrafts((prev) => ({
                        ...prev,
                        [def.id as number]: event.target.value,
                      }))
                    }
                    aria-label={`Body type ${def.label}`}
                    className={`${inputClass} min-w-0 flex-1`}
                    data-testid={`input-body-type-${def.id}`}
                  />
                  <button
                    type="button"
                    disabled={isWorking || !typeDraft(def).trim()}
                    onClick={() =>
                      onRenameType({ id: def.id as number, label: typeDraft(def).trim() })
                    }
                    className={secondaryButtonClass}
                    data-testid={`button-body-type-save-${def.id}`}
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    disabled={isWorking}
                    onClick={() => onDeleteType(def.id as number)}
                    className={destructiveButtonClass}
                    data-testid={`button-body-type-delete-${def.id}`}
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          )}
          <form
            className="mt-3 flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (!newType.trim()) return;
              onAddType(newType.trim());
              setNewType('');
            }}
          >
            <label className="min-w-0 flex-1 block">
              <span className="sr-only">New body type</span>
              <input
                type="text"
                value={newType}
                onChange={(event) => setNewType(event.target.value)}
                placeholder="Add a body type"
                className={inputClass}
                data-testid="input-body-type-new"
              />
            </label>
            <button
              type="submit"
              disabled={isWorking || !newType.trim()}
              className={secondaryButtonClass}
              data-testid="button-body-type-add"
            >
              Add
            </button>
          </form>
        </section>

        <section className="mt-5 border-t border-[hsl(var(--border))] pt-4">
          <p className={labelClass}>Custom fields</p>
          {fieldDefs.length === 0 ? (
            <p
              className="mt-2 text-sm text-[hsl(var(--muted-foreground))]"
              data-testid="text-body-fields-empty"
            >
              No custom fields defined. A field applies to every body whose
              type label matches, and required fields are enforced when
              editing a body of that type.
            </p>
          ) : (
            <ul className="mt-3 grid gap-2" data-testid="list-body-fields">
              {fieldDefs.map((def) => {
                const draft = fieldDraft(def);
                const setDraft = (
                  next: Partial<{ label: string; appliesToTypeLabel: string; required: boolean }>,
                ) =>
                  setFieldDrafts((prev) => ({
                    ...prev,
                    [def.id as number]: { ...draft, ...next },
                  }));
                return (
                  <li
                    key={def.id}
                    className="grid gap-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background)/.5)] p-3"
                    data-testid={`row-body-field-${def.id}`}
                  >
                    <input
                      type="text"
                      value={draft.label}
                      onChange={(event) => setDraft({ label: event.target.value })}
                      aria-label={`Field label ${def.label}`}
                      className={inputClass}
                      data-testid={`input-body-field-label-${def.id}`}
                    />
                    <input
                      type="text"
                      list="body-vocabulary-type-suggestions"
                      value={draft.appliesToTypeLabel}
                      onChange={(event) => setDraft({ appliesToTypeLabel: event.target.value })}
                      aria-label={`Applies to type label, currently ${def.appliesToTypeLabel}`}
                      className={inputClass}
                      data-testid={`input-body-field-type-${def.id}`}
                    />
                    <label className="flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))]">
                      <input
                        type="checkbox"
                        checked={draft.required}
                        onChange={(event) => setDraft({ required: event.target.checked })}
                        data-testid={`checkbox-body-field-required-${def.id}`}
                      />
                      Required
                    </label>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={
                          isWorking || !draft.label.trim() || !draft.appliesToTypeLabel.trim()
                        }
                        onClick={() =>
                          onUpdateField({
                            id: def.id as number,
                            label: draft.label.trim(),
                            appliesToTypeLabel: draft.appliesToTypeLabel.trim(),
                            required: draft.required,
                          })
                        }
                        className={secondaryButtonClass}
                        data-testid={`button-body-field-save-${def.id}`}
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        disabled={isWorking}
                        onClick={() => onDeleteField(def.id as number)}
                        className={destructiveButtonClass}
                        data-testid={`button-body-field-delete-${def.id}`}
                      >
                        Delete
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <form
            className="mt-3 grid gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (!newFieldLabel.trim() || !newFieldType.trim()) return;
              onAddField({
                label: newFieldLabel.trim(),
                appliesToTypeLabel: newFieldType.trim(),
                required: newFieldRequired,
              });
              setNewFieldLabel('');
              setNewFieldType('');
              setNewFieldRequired(false);
            }}
          >
            <label className="block">
              <span className={labelClass}>Field label</span>
              <input
                type="text"
                value={newFieldLabel}
                onChange={(event) => setNewFieldLabel(event.target.value)}
                className={`mt-1.5 ${inputClass}`}
                data-testid="input-body-field-new-label"
              />
            </label>
            <label className="block">
              <span className={labelClass}>Applies to body type</span>
              <input
                type="text"
                list="body-vocabulary-type-suggestions"
                value={newFieldType}
                onChange={(event) => setNewFieldType(event.target.value)}
                className={`mt-1.5 ${inputClass}`}
                data-testid="input-body-field-new-type"
              />
              <datalist id="body-vocabulary-type-suggestions">
                {typeDefs.map((def) => (
                  <option key={def.id} value={def.label} />
                ))}
              </datalist>
            </label>
            <label className="flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))]">
              <input
                type="checkbox"
                checked={newFieldRequired}
                onChange={(event) => setNewFieldRequired(event.target.checked)}
                data-testid="checkbox-body-field-new-required"
              />
              Required
            </label>
            <button
              type="submit"
              disabled={isWorking || !newFieldLabel.trim() || !newFieldType.trim()}
              className={secondaryButtonClass}
              data-testid="button-body-field-add"
            >
              Add field
            </button>
          </form>
        </section>

        {error ? (
          <p
            className="mt-3 text-sm font-semibold text-[hsl(var(--destructive))]"
            role="alert"
            data-testid="text-body-vocabulary-error"
          >
            {error}
          </p>
        ) : null}

        <button
          type="button"
          onClick={onCancel}
          className="mt-4 w-full text-xs font-semibold text-[hsl(var(--muted-foreground))] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
          data-testid="button-body-vocabulary-close"
        >
          Close
        </button>
      </div>
    </div>
  );
}
