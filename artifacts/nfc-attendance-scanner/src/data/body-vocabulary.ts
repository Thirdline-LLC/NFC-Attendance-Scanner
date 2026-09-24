/**
 * Pure helpers over the 08b vocabulary types (`BodyTypeDef`, `BodyFieldDef`).
 * No Dexie here — the store owns reads and writes; this owns the matching
 * and validation rules so they are the same rule everywhere they're used
 * (the create form, the structure editor, and the store's own write path).
 */

import type { BodyFieldDef, BodyTypeDef } from '@/data/attendance-store';

/** Trimmed, case-insensitive — the same rule a body's own `typeLabel` is
 * trimmed by, so `"Club"` and `"club "` are one vocabulary entry. */
function normalizeLabel(label: string): string {
  return label.trim().toLowerCase();
}

export function sameLabel(a: string, b: string): boolean {
  return normalizeLabel(a) === normalizeLabel(b);
}

/**
 * The field defs that apply to a body of this type label, in `sortOrder`.
 * Matched by trimmed, case-insensitive equality — `appliesToTypeLabel` and
 * `typeLabel` are both free text kept in step by the UI, not a foreign key,
 * so a casing drift between them must not silently drop a field.
 */
export function fieldDefsFor(
  typeLabel: string,
  defs: readonly BodyFieldDef[],
): BodyFieldDef[] {
  return defs
    .filter((def) => sameLabel(def.appliesToTypeLabel, typeLabel))
    .sort(compareBySortOrder);
}

/**
 * Which required fields (for this type label) `customFields` is missing or
 * has left blank. Empty array means the save may proceed.
 */
/**
 * `customFields` reduced to the keys the vocabulary actually defines for
 * this type label, trimmed, with blanks dropped. A value the UI collected
 * for one type draft (e.g. while `typeLabel` was still "team") must not
 * survive into a save under a different type ("club") just because the
 * component that held it was never cleared.
 */
export function sanitizeCustomFields(
  typeLabel: string,
  defs: readonly BodyFieldDef[],
  customFields: Record<string, string>,
): Record<string, string> {
  const allowed = new Set(fieldDefsFor(typeLabel, defs).map((def) => def.label));
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(customFields)) {
    if (!allowed.has(key)) continue;
    const trimmed = value.trim();
    if (trimmed) result[key] = trimmed;
  }
  return result;
}

export function missingRequiredFields(
  typeLabel: string,
  defs: readonly BodyFieldDef[],
  customFields: Record<string, string>,
): BodyFieldDef[] {
  return fieldDefsFor(typeLabel, defs).filter(
    (def) => def.required && !(customFields[def.label] ?? '').trim(),
  );
}

/** The next `sortOrder` for a new vocabulary entry (type label or field def). */
export function nextVocabSortOrder(
  existing: readonly { sortOrder?: number }[],
): number {
  let max = -1;
  for (const entry of existing) {
    const order = entry.sortOrder ?? -1;
    if (order > max) max = order;
  }
  return max + 1;
}

export function compareBySortOrder(
  a: { sortOrder?: number; id?: number },
  b: { sortOrder?: number; id?: number },
): number {
  const order = (a.sortOrder ?? Number.MAX_SAFE_INTEGER) - (b.sortOrder ?? Number.MAX_SAFE_INTEGER);
  if (order !== 0) return order;
  return (a.id ?? 0) - (b.id ?? 0);
}

/**
 * Suggestions for the type-label datalist: the admin's saved vocabulary
 * first, in `sortOrder`, then any theme preset not already in it. Theme
 * `bodyTypePresets` stay suggestions only — this never drops or reorders a
 * vocabulary entry to make room for one.
 */
export function mergeTypeSuggestions(
  vocab: readonly BodyTypeDef[],
  themePresetLabels: readonly string[],
): string[] {
  const sorted = [...vocab].sort(compareBySortOrder).map((def) => def.label);
  const seen = new Set(sorted.map(normalizeLabel));
  const extra = themePresetLabels.filter((label) => !seen.has(normalizeLabel(label)));
  return [...sorted, ...extra];
}
