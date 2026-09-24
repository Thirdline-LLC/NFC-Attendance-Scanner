import { describe, expect, it } from 'vitest';
import {
  fieldDefsFor,
  mergeTypeSuggestions,
  missingRequiredFields,
  nextVocabSortOrder,
  sameLabel,
} from './body-vocabulary';
import type { BodyFieldDef, BodyTypeDef } from './attendance-store';

describe('sameLabel', () => {
  it('matches trimmed and case-insensitively', () => {
    expect(sameLabel('Club', ' club ')).toBe(true);
    expect(sameLabel('Club', 'Branch')).toBe(false);
  });
});

describe('fieldDefsFor', () => {
  const defs: BodyFieldDef[] = [
    { id: 1, label: 'Room', appliesToTypeLabel: 'Club', required: false, sortOrder: 1 },
    { id: 2, label: 'Advisor', appliesToTypeLabel: 'club', required: true, sortOrder: 0 },
    { id: 3, label: 'Budget code', appliesToTypeLabel: 'Branch', required: false, sortOrder: 0 },
  ];

  it('matches case-insensitively and returns in sortOrder', () => {
    expect(fieldDefsFor('Club', defs).map((def) => def.label)).toEqual([
      'Advisor',
      'Room',
    ]);
  });

  it('returns nothing for a type label with no field defs', () => {
    expect(fieldDefsFor('Section', defs)).toEqual([]);
  });
});

describe('missingRequiredFields', () => {
  const defs: BodyFieldDef[] = [
    { id: 1, label: 'Advisor', appliesToTypeLabel: 'Club', required: true, sortOrder: 0 },
    { id: 2, label: 'Room', appliesToTypeLabel: 'Club', required: false, sortOrder: 1 },
  ];

  it('flags a required field left blank or missing entirely', () => {
    expect(missingRequiredFields('Club', defs, {}).map((def) => def.label)).toEqual([
      'Advisor',
    ]);
    expect(
      missingRequiredFields('Club', defs, { Advisor: '   ' }).map((def) => def.label),
    ).toEqual(['Advisor']);
  });

  it('is satisfied once the required field has a value', () => {
    expect(
      missingRequiredFields('Club', defs, { Advisor: 'a@b.org' }),
    ).toEqual([]);
  });

  it('never flags an optional field', () => {
    expect(missingRequiredFields('Club', defs, { Advisor: 'a@b.org' })).toEqual([]);
  });
});

describe('nextVocabSortOrder', () => {
  it('is one past the highest existing sortOrder', () => {
    expect(nextVocabSortOrder([])).toBe(0);
    expect(nextVocabSortOrder([{ sortOrder: 0 }, { sortOrder: 3 }])).toBe(4);
  });
});

describe('mergeTypeSuggestions', () => {
  it('lists the vocabulary first, in sortOrder, then unseen theme presets', () => {
    const vocab: BodyTypeDef[] = [
      { id: 1, label: 'Branch', sortOrder: 1 },
      { id: 2, label: 'club', sortOrder: 0 },
    ];
    expect(mergeTypeSuggestions(vocab, ['Club', 'Section'])).toEqual([
      'club',
      'Branch',
      'Section',
    ]);
  });

  it('handles an empty vocabulary', () => {
    expect(mergeTypeSuggestions([], ['Club'])).toEqual(['Club']);
  });
});
