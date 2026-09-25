import { describe, expect, it } from 'vitest';
import {
  periodSwitchOptions,
  periodSwitchTitle,
  type BodyNode,
} from './body-hierarchy';

const CREATED = '2026-09-01T12:00:00.000Z';

function body(
  id: number,
  name: string,
  parentId: number | null,
  extra: Partial<BodyNode> = {},
): BodyNode {
  return { id, name, typeLabel: parentId === null ? 'class' : 'period', createdAt: CREATED, parentId, sortOrder: id, ...extra };
}

// English 11 with three periods (one archived), a second class with its own
// periods (cousins of English 11's), a grandchild under Period 3, and an
// unrelated root.
const TREE: BodyNode[] = [
  body(1, 'English 11', null),
  body(2, 'Period 1', 1),
  body(3, 'Period 3', 1),
  body(4, 'Period 5', 1, { archivedAt: '2026-09-10T12:00:00.000Z' }),
  body(5, 'Period 6', 1),
  body(10, 'Chemistry', null),
  body(11, 'Period 2', 10),
  body(12, 'Period 4', 10),
  body(20, 'Lab group A', 3, { typeLabel: 'group' }),
  body(30, 'Robotics', null, { typeLabel: 'club' }),
];

const ids = (scope: ReturnType<typeof periodSwitchOptions>) =>
  scope?.options.map((option) => option.id) ?? null;

describe('periodSwitchOptions (Design 09 §3 visibility and scope)', () => {
  it('is hidden on a root body, so unrelated roots can never appear', () => {
    expect(periodSwitchOptions(1, TREE)).toBeNull();
    expect(periodSwitchOptions(30, TREE)).toBeNull();
  });

  it('is hidden for a body from before 08a, whose parentId is undefined', () => {
    const legacy: BodyNode = { id: 40, name: 'Club', typeLabel: 'club', createdAt: CREATED };
    expect(periodSwitchOptions(40, [...TREE, legacy])).toBeNull();
  });

  it('is hidden on an only child', () => {
    // Lab group A is Period 3's only child.
    expect(periodSwitchOptions(20, TREE)).toBeNull();
  });

  it('is hidden when the only sibling is archived', () => {
    const tree = [
      body(1, 'English 11', null),
      body(2, 'Period 1', 1),
      body(3, 'Period 3', 1, { archivedAt: '2026-09-10T12:00:00.000Z' }),
    ];
    expect(periodSwitchOptions(2, tree)).toBeNull();
  });

  it('lists the non-archived siblings, the current one included, in sibling order', () => {
    const scope = periodSwitchOptions(3, TREE);
    expect(scope?.parent.id).toBe(1);
    expect(ids(scope)).toEqual([2, 3, 5]);
  });

  it('never offers the parent, cousins, deeper descendants, other roots or archived bodies', () => {
    const offered = ids(periodSwitchOptions(3, TREE)) ?? [];
    // parent, archived sibling, cousins, grandchild, other roots
    for (const excluded of [1, 4, 10, 11, 12, 20, 30]) {
      expect(offered).not.toContain(excluded);
    }
  });

  it('is scoped to the active body’s own parent', () => {
    expect(ids(periodSwitchOptions(11, TREE))).toEqual([11, 12]);
  });

  it('follows sortOrder, not insertion order', () => {
    const tree = [
      body(1, 'English 11', null),
      body(2, 'Period 7', 1, { sortOrder: 2 }),
      body(3, 'Period 1', 1, { sortOrder: 0 }),
      body(4, 'Period 4', 1, { sortOrder: 1 }),
    ];
    expect(periodSwitchOptions(2, tree)?.options.map((option) => option.name)).toEqual([
      'Period 1',
      'Period 4',
      'Period 7',
    ]);
  });

  it('is hidden with no active body or an unknown id', () => {
    expect(periodSwitchOptions(undefined, TREE)).toBeNull();
    expect(periodSwitchOptions(999, TREE)).toBeNull();
  });
});

describe('periodSwitchTitle', () => {
  it('follows the children’s shared type label', () => {
    const scope = periodSwitchOptions(3, TREE);
    expect(periodSwitchTitle(scope!.parent, scope!.options)).toBe('Switch period');
    const teams = [body(1, 'Robotics', null), body(2, 'Build', 1, { typeLabel: 'Team' }), body(3, 'Drive', 1, { typeLabel: 'team' })];
    expect(periodSwitchTitle(teams[0], teams.slice(1))).toBe('Switch team');
  });

  it('falls back to naming the parent when the labels differ', () => {
    const mixed = [body(2, 'Period 1', 1), body(3, 'Lab', 1, { typeLabel: 'lab' })];
    expect(periodSwitchTitle(body(1, 'English 11', null), mixed)).toBe('Switch within English 11');
  });
});
