import { useEffect, useId, useRef, useState } from 'react';
import { Check, FileSpreadsheet, Minus, Plus } from 'lucide-react';
import type {
  AttendanceBody,
  BodyFieldDef,
  CreateClassWithPeriodsInput,
} from '@/data/attendance-store';
import { pluralizeTypeLabel } from '@/data/body-hierarchy';
import { missingRequiredFields } from '@/data/body-vocabulary';
import {
  DEFAULT_CLASS_TYPE_LABEL,
  DEFAULT_PERIOD_TYPE_LABEL,
  MAX_CLASS_PERIODS,
  MIN_CLASS_PERIODS,
  classSetupIssues,
  defaultPeriodName,
  hasClassSetupIssues,
} from '@/data/class-with-periods';
import { deliverRosterTemplateWorkbook } from '@/lib/roster-template';
import { ExportCancelledError } from '@/platform/desktop-bridge';

const INPUT_CLASS =
  'w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background)/.6)] px-3 py-2.5 text-sm text-[hsl(var(--foreground))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] aria-[invalid=true]:border-[hsl(var(--destructive)/.7)]';
const LABEL_CLASS =
  'text-[10px] font-semibold uppercase tracking-[0.16em] text-[hsl(var(--muted-foreground))]';
const FIELD_ERROR_CLASS = 'mt-1 text-xs font-semibold text-[hsl(var(--destructive))]';
const STEP_BUTTON_CLASS =
  'flex size-11 items-center justify-center rounded-xl border border-[hsl(var(--border))] text-[hsl(var(--foreground))] transition hover:bg-[hsl(var(--secondary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] disabled:cursor-not-allowed disabled:opacity-40';

function initialRows(count: number): string[] {
  return Array.from({ length: count }, (_, index) => defaultPeriodName(index));
}

type ClassSetupFormProps = {
  isWorking: boolean;
  /** Which custom fields apply to which type label (08b). */
  fieldDefs: BodyFieldDef[];
  /** The id of the dialog's shared type-label `<datalist>`. */
  typeSuggestionsId: string;
  onCreate: (input: Required<CreateClassWithPeriodsInput>) => void;
};

/**
 * Design 09 §1: a class and its periods in one step. The rows start as
 * "Period 1…N" and every one is editable, so a teacher can type their real
 * bell periods instead. The type labels are defaults, not a mode — "club" /
 * "team" works the same way. Create stays disabled until the store would
 * accept the draft (same rules, from `classSetupIssues`).
 */
export function ClassSetupForm({
  isWorking,
  fieldDefs,
  typeSuggestionsId,
  onCreate,
}: ClassSetupFormProps) {
  const [className, setClassName] = useState('');
  const [classNameTouched, setClassNameTouched] = useState(false);
  const [parentTypeLabel, setParentTypeLabel] = useState(DEFAULT_CLASS_TYPE_LABEL);
  const [childTypeLabel, setChildTypeLabel] = useState(DEFAULT_PERIOD_TYPE_LABEL);
  const [periodNames, setPeriodNames] = useState<string[]>(() => initialRows(5));
  const idBase = useId();

  const issues = classSetupIssues({ className, parentTypeLabel, childTypeLabel, periodNames });
  // This flow collects no custom fields, so a label that requires one
  // cannot be created here — say so before the teacher presses Create.
  const blockingFields = [parentTypeLabel, childTypeLabel].flatMap((label) =>
    label.trim()
      ? missingRequiredFields(label, fieldDefs, {}).map((field) => ({ label: label.trim(), field }))
      : [],
  );
  const canCreate = !isWorking && !hasClassSetupIssues(issues) && blockingFields.length === 0;

  const childWord = childTypeLabel.trim() || DEFAULT_PERIOD_TYPE_LABEL;
  const childPlural = pluralizeTypeLabel(childWord);
  const count = periodNames.length;

  // Fewer rows drops from the end only; more rows appends defaults. A name
  // the teacher already typed is never overwritten by the stepper.
  const setCount = (next: number) => {
    const clamped = Math.min(MAX_CLASS_PERIODS, Math.max(MIN_CLASS_PERIODS, next));
    setPeriodNames((current) =>
      clamped <= current.length
        ? current.slice(0, clamped)
        : [
            ...current,
            ...Array.from({ length: clamped - current.length }, (_, offset) =>
              defaultPeriodName(current.length + offset),
            ),
          ],
    );
  };

  const classNameError = classNameTouched ? issues.className : null;

  return (
    <form
      className="grid gap-4"
      data-testid="form-class-setup"
      onSubmit={(event) => {
        event.preventDefault();
        setClassNameTouched(true);
        if (!canCreate) return;
        onCreate({
          className: className.trim(),
          parentTypeLabel: parentTypeLabel.trim(),
          childTypeLabel: childTypeLabel.trim(),
          periodNames: periodNames.map((name) => name.trim()),
        });
      }}
    >
      <label htmlFor={`${idBase}-class-name`} className="block">
        <span className={LABEL_CLASS}>Class name</span>
        <input
          id={`${idBase}-class-name`}
          type="text"
          value={className}
          onChange={(event) => setClassName(event.target.value)}
          onBlur={() => setClassNameTouched(true)}
          placeholder="e.g. English 11"
          aria-invalid={classNameError ? true : undefined}
          aria-describedby={classNameError ? `${idBase}-class-name-error` : undefined}
          className={`mt-1.5 ${INPUT_CLASS}`}
          data-testid="input-class-name"
        />
        {classNameError ? (
          <span id={`${idBase}-class-name-error`} className={`block ${FIELD_ERROR_CLASS}`}>
            {classNameError}
          </span>
        ) : null}
      </label>

      <div className="flex items-center justify-between gap-3">
        <span id={`${idBase}-count-label`} className={LABEL_CLASS}>
          Number of {childPlural}
        </span>
        <div
          role="group"
          aria-labelledby={`${idBase}-count-label`}
          className="flex items-center gap-2"
        >
          <button
            type="button"
            onClick={() => setCount(count - 1)}
            disabled={count <= MIN_CLASS_PERIODS}
            aria-label={`One fewer ${childWord}`}
            className={STEP_BUTTON_CLASS}
            data-testid="button-period-count-down"
          >
            <Minus aria-hidden="true" size={16} />
          </button>
          <output
            aria-live="polite"
            className="w-8 text-center font-display text-lg font-semibold tabular-nums text-[hsl(var(--foreground))]"
            data-testid="text-period-count"
          >
            {count}
          </output>
          <button
            type="button"
            onClick={() => setCount(count + 1)}
            disabled={count >= MAX_CLASS_PERIODS}
            aria-label={`One more ${childWord}`}
            className={STEP_BUTTON_CLASS}
            data-testid="button-period-count-up"
          >
            <Plus aria-hidden="true" size={16} />
          </button>
        </div>
      </div>

      <fieldset className="grid gap-2">
        <legend className={`mb-2 ${LABEL_CLASS}`}>
          {childPlural.charAt(0).toUpperCase() + childPlural.slice(1)}, in bell order
        </legend>
        <ol className="grid gap-2">
          {periodNames.map((name, index) => {
            const rowError = issues.periods[index];
            const inputId = `${idBase}-period-${index}`;
            return (
              <li key={index} className="grid grid-cols-[2rem_1fr] items-start gap-2">
                <span
                  aria-hidden="true"
                  className="flex h-11 items-center justify-center font-display text-sm font-semibold tabular-nums text-[hsl(var(--muted-foreground))]"
                >
                  {index + 1}
                </span>
                <span>
                  <input
                    id={inputId}
                    type="text"
                    value={name}
                    onChange={(event) =>
                      setPeriodNames((current) =>
                        current.map((existing, at) => (at === index ? event.target.value : existing)),
                      )
                    }
                    aria-label={`Name of ${childWord} ${index + 1}`}
                    aria-invalid={rowError ? true : undefined}
                    aria-describedby={rowError ? `${inputId}-error` : undefined}
                    className={`min-h-11 ${INPUT_CLASS}`}
                    data-testid={`input-period-name-${index}`}
                  />
                  {rowError ? (
                    <span
                      id={`${inputId}-error`}
                      className={`block ${FIELD_ERROR_CLASS}`}
                      data-testid={`text-period-error-${index}`}
                    >
                      {rowError}
                    </span>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ol>
      </fieldset>

      <div className="grid grid-cols-2 gap-3">
        <label htmlFor={`${idBase}-parent-type`} className="block">
          <span className={LABEL_CLASS}>Class type label</span>
          <input
            id={`${idBase}-parent-type`}
            type="text"
            list={typeSuggestionsId}
            value={parentTypeLabel}
            onChange={(event) => setParentTypeLabel(event.target.value)}
            aria-invalid={issues.parentTypeLabel ? true : undefined}
            aria-describedby={issues.parentTypeLabel ? `${idBase}-parent-type-error` : undefined}
            className={`mt-1.5 ${INPUT_CLASS}`}
            data-testid="input-class-type-label"
          />
          {issues.parentTypeLabel ? (
            <span id={`${idBase}-parent-type-error`} className={`block ${FIELD_ERROR_CLASS}`}>
              {issues.parentTypeLabel}
            </span>
          ) : null}
        </label>
        <label htmlFor={`${idBase}-child-type`} className="block">
          <span className={LABEL_CLASS}>Row type label</span>
          <input
            id={`${idBase}-child-type`}
            type="text"
            list={typeSuggestionsId}
            value={childTypeLabel}
            onChange={(event) => setChildTypeLabel(event.target.value)}
            aria-invalid={issues.childTypeLabel ? true : undefined}
            aria-describedby={issues.childTypeLabel ? `${idBase}-child-type-error` : undefined}
            className={`mt-1.5 ${INPUT_CLASS}`}
            data-testid="input-period-type-label"
          />
          {issues.childTypeLabel ? (
            <span id={`${idBase}-child-type-error`} className={`block ${FIELD_ERROR_CLASS}`}>
              {issues.childTypeLabel}
            </span>
          ) : null}
        </label>
      </div>

      <ClassPreview
        className={className}
        parentTypeLabel={parentTypeLabel}
        childTypeLabel={childTypeLabel}
        periodNames={periodNames}
      />

      {blockingFields.length > 0 ? (
        <p className={FIELD_ERROR_CLASS} data-testid="text-class-fields-blocked">
          {blockingFields
            .map(({ label, field }) => `${field.label} is required for a ${label}`)
            .join('; ')}
          . This form can’t fill it in — use a different type label, or create each body on
          its own under Single body.
        </p>
      ) : null}

      <button
        type="submit"
        disabled={!canCreate}
        className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[hsl(var(--primary))] px-4 py-3 text-sm font-bold text-[hsl(var(--primary-foreground))] transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] disabled:cursor-not-allowed disabled:opacity-60"
        data-testid="button-class-create"
      >
        {isWorking ? 'Working…' : `Create class and ${count} ${count === 1 ? childWord : childPlural}`}
      </button>
    </form>
  );
}

/**
 * The class as it will appear in the picker: the class row, its periods
 * beneath on the same rule the tree uses, in the order entered.
 */
function ClassPreview({
  className,
  parentTypeLabel,
  childTypeLabel,
  periodNames,
}: {
  className: string;
  parentTypeLabel: string;
  childTypeLabel: string;
  periodNames: readonly string[];
}) {
  const muted = 'text-[hsl(var(--muted-foreground))]';
  return (
    <figure
      className="rounded-2xl border border-dashed border-[hsl(var(--primary)/.4)] bg-[hsl(var(--background)/.4)] p-3"
      data-testid="preview-class"
    >
      <figcaption className={`mb-2 text-xs ${muted}`}>Preview</figcaption>
      <p className="text-sm font-semibold text-[hsl(var(--foreground))]" data-testid="preview-class-name">
        {className.trim() || <span className={`font-normal italic ${muted}`}>Class name</span>}
        <span className={`font-normal ${muted}`}> · {parentTypeLabel.trim() || '—'}</span>
      </p>
      <ol
        className="mt-2 ml-1.5 grid gap-1 border-l-2 border-[hsl(var(--primary)/.35)] pl-3"
        data-testid="preview-class-periods"
      >
        {periodNames.map((name, index) => (
          <li key={index} className="text-sm text-[hsl(var(--foreground))]">
            {name.trim() || <span className={`italic ${muted}`}>Unnamed</span>}
            <span className={muted}> · {childTypeLabel.trim() || '—'}</span>
          </li>
        ))}
      </ol>
    </figure>
  );
}

type TemplateStatus =
  | { state: 'working' }
  | { state: 'done'; filename: string; delivery: 'download' | 'file' | 'saved' }
  | { state: 'cancelled' }
  | { state: 'failed' };

type ClassTemplateFollowUpProps = {
  parent: AttendanceBody;
  periods: AttendanceBody[];
  onDone: () => void;
  /** Injectable for tests; defaults to the Students page's own delivery. */
  deliverTemplate?: typeof deliverRosterTemplateWorkbook;
};

/**
 * The step after Create (Design 09 §1.7): one roster template per period,
 * each pre-filled with that period's name and type so the import on the
 * Students page matches it. Importing still happens there, one period at a
 * time, with that period chosen as the device's body.
 */
export function ClassTemplateFollowUp({
  parent,
  periods,
  onDone,
  deliverTemplate = deliverRosterTemplateWorkbook,
}: ClassTemplateFollowUpProps) {
  const [status, setStatus] = useState<Record<number, TemplateStatus>>({});
  const headingRef = useRef<HTMLHeadingElement>(null);
  const childWord = periods[0]?.typeLabel ?? DEFAULT_PERIOD_TYPE_LABEL;
  const childPlural = pluralizeTypeLabel(childWord);
  const anyDone = Object.values(status).some((entry) => entry.state === 'done');

  // The form this replaced is gone; land the keyboard on the new step.
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const download = async (period: AttendanceBody) => {
    const id = period.id as number;
    setStatus((current) => ({ ...current, [id]: { state: 'working' } }));
    try {
      const delivered = await deliverTemplate(period);
      setStatus((current) => ({
        ...current,
        [id]: { state: 'done', filename: delivered.filename, delivery: delivered.delivery },
      }));
    } catch (error) {
      setStatus((current) => ({
        ...current,
        [id]: { state: error instanceof ExportCancelledError ? 'cancelled' : 'failed' },
      }));
    }
  };

  return (
    <div data-testid="class-followup">
      <h2
        ref={headingRef}
        id="body-switcher-title"
        tabIndex={-1}
        className="font-display text-lg font-semibold tracking-[-0.02em] text-[hsl(var(--foreground))] focus-visible:outline-none"
      >
        Add students to each {childWord}
      </h2>
      <p className="mt-2 text-sm leading-snug text-[hsl(var(--muted-foreground))]">
        {parent.name} is set up with {periods.length}{' '}
        {periods.length === 1 ? childWord : childPlural}, and this device is now on{' '}
        {parent.name}. Each {childWord} keeps its own roster: download its template, fill it
        in, then import it on the Students page after picking that {childWord} in Change
        body.
      </p>

      <ul className="mt-4 grid gap-2" data-testid="list-class-templates">
        {periods.map((period) => {
          const id = period.id as number;
          const entry = status[id];
          return (
            <li
              key={id}
              className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background)/.5)] p-3"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="min-w-0 truncate text-sm font-semibold text-[hsl(var(--foreground))]">
                  {period.name}
                </span>
                <button
                  type="button"
                  onClick={() => void download(period)}
                  disabled={entry?.state === 'working'}
                  aria-label={`Download template for ${period.name}`}
                  className="flex min-h-11 shrink-0 items-center gap-2 rounded-full border border-[hsl(var(--primary)/.55)] bg-[hsl(var(--primary)/.12)] px-4 text-[11px] font-bold uppercase tracking-[0.14em] text-[hsl(var(--primary))] transition hover:bg-[hsl(var(--primary)/.2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] disabled:cursor-wait disabled:opacity-60"
                  data-testid={`button-class-template-${id}`}
                >
                  {entry?.state === 'done' ? (
                    <Check aria-hidden="true" size={14} />
                  ) : (
                    <FileSpreadsheet aria-hidden="true" size={14} />
                  )}
                  {entry?.state === 'working' ? 'Preparing…' : 'Download template'}
                </button>
              </div>
              <p
                role="status"
                className="text-xs leading-5 text-[hsl(var(--muted-foreground))] [&:not(:empty)]:mt-1.5"
                data-testid={`text-class-template-${id}`}
              >
                {entry?.state === 'done'
                  ? entry.delivery === 'download'
                    ? `Handed to the browser as ${entry.filename}. Check your downloads.`
                    : `Saved as ${entry.filename}.`
                  : entry?.state === 'cancelled'
                    ? 'Cancelled. No file was written.'
                    : entry?.state === 'failed'
                      ? 'This template could not be saved. Try again.'
                      : ''}
              </p>
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        onClick={onDone}
        className={
          anyDone
            ? 'mt-4 flex min-h-11 w-full items-center justify-center rounded-xl bg-[hsl(var(--primary))] px-4 py-3 text-sm font-bold text-[hsl(var(--primary-foreground))] transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]'
            : 'mt-4 flex min-h-11 w-full items-center justify-center rounded-xl border border-[hsl(var(--border))] px-4 py-3 text-sm font-semibold text-[hsl(var(--foreground))] transition hover:bg-[hsl(var(--secondary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]'
        }
        data-testid="button-class-followup-done"
      >
        {anyDone ? 'Done' : 'Skip for now'}
      </button>
    </div>
  );
}
