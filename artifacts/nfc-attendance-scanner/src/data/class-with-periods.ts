/**
 * Design 09 §1 — the "Class with periods" preset. Pure rules shared by the
 * store (`createClassWithPeriods`) and the setup form, so the button the
 * teacher sees disabled and the write the store refuses agree on every case.
 *
 * Nothing here is a product mode: "class" and "period" are only the default
 * type labels, and a club admin can use the same flow as "Robotics" with
 * "team" children. The result is ordinary 08a parent/child bodies.
 */

import { sameLabel } from '@/data/body-vocabulary';

export const MIN_CLASS_PERIODS = 1;
export const MAX_CLASS_PERIODS = 10;
export const DEFAULT_CLASS_TYPE_LABEL = 'class';
export const DEFAULT_PERIOD_TYPE_LABEL = 'period';

/** `Period 1` … — the name a new row starts with. */
export function defaultPeriodName(index: number): string {
  return `Period ${index + 1}`;
}

export type ClassSetupDraft = {
  className: string;
  parentTypeLabel: string;
  childTypeLabel: string;
  periodNames: readonly string[];
};

/** One message per field, `null` when that field is fine. */
export type ClassSetupIssues = {
  className: string | null;
  parentTypeLabel: string | null;
  childTypeLabel: string | null;
  periodCount: string | null;
  /** Same length and order as `periodNames`. */
  periods: (string | null)[];
};

/**
 * Checks a draft the way the store will. Names are compared trimmed and
 * case-insensitively, so "Period 1" and "period 1 " are the same row — two
 * children a teacher could not tell apart in the picker.
 */
export function classSetupIssues(draft: ClassSetupDraft): ClassSetupIssues {
  const count = draft.periodNames.length;
  const periods = draft.periodNames.map((name, index) => {
    if (!name.trim()) return 'Give this row a name.';
    const earlier = draft.periodNames
      .slice(0, index)
      .some((other) => other.trim() && sameLabel(other, name));
    return earlier ? 'Another row already has this name.' : null;
  });
  return {
    className: draft.className.trim() ? null : 'Give the class a name.',
    parentTypeLabel: draft.parentTypeLabel.trim() ? null : 'Needs a type label.',
    childTypeLabel: draft.childTypeLabel.trim() ? null : 'Needs a type label.',
    periodCount:
      count < MIN_CLASS_PERIODS || count > MAX_CLASS_PERIODS
        ? `Choose ${MIN_CLASS_PERIODS} to ${MAX_CLASS_PERIODS} rows.`
        : null,
    periods,
  };
}

/** The first problem, worded to stand alone (for a thrown error). */
export function firstClassSetupIssue(issues: ClassSetupIssues): string | null {
  if (issues.className) return issues.className;
  if (issues.parentTypeLabel) return `The class ${issues.parentTypeLabel.toLowerCase()}`;
  if (issues.childTypeLabel) return `Each row ${issues.childTypeLabel.toLowerCase()}`;
  if (issues.periodCount) return issues.periodCount;
  const index = issues.periods.findIndex((issue) => issue !== null);
  if (index >= 0) return `Row ${index + 1}: ${issues.periods[index]}`;
  return null;
}

export function hasClassSetupIssues(issues: ClassSetupIssues): boolean {
  return firstClassSetupIssue(issues) !== null;
}
