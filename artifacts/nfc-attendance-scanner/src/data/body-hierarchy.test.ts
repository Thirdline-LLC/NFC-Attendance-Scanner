import { describe, expect, it } from 'vitest';
import {
  SOFT_BODY_DEPTH,
  childCountLabel,
  depthWarning,
  flattenBodyTree,
  formatBodySubtitle,
  pluralizeTypeLabel,
  subtreeBodyIds,
  wouldCycle,
  type BodyNode,
} from './body-hierarchy';

function node(
  id: number,
  name: string,
  parentId: number | null,
  sortOrder: number,
  typeLabel = 'group',
): BodyNode {
  return {
    id,
    name,
    typeLabel,
    parentId,
    sortOrder,
    createdAt: `2026-01-0${id}T00:00:00.000Z`,
  };
}

describe('body tree', () => {
  const bodies = [
    node(1, 'Later root', null, 1),
    node(2, 'First root', null, 0),
    node(3, 'Second child', 2, 1, 'branch'),
    node(4, 'First child', 2, 0, 'branch'),
  ];

  it('lists the tree with siblings in sortOrder', () => {
    expect(flattenBodyTree(bodies).map((row) => row.body.name)).toEqual([
      'First root',
      'First child',
      'Second child',
      'Later root',
    ]);
    expect(flattenBodyTree(bodies).map((row) => row.depth)).toEqual([1, 2, 2, 1]);
  });

  it('builds a subtitle from the path for a nested body and name · typeLabel for a root', () => {
    const child = bodies[2];
    expect(formatBodySubtitle(bodies[1], bodies)).toBe('First root · group');
    expect(formatBodySubtitle(child, bodies)).toBe('First root › Second child · branch');
  });

  it('collects a subtree in tree order', () => {
    expect(subtreeBodyIds(2, bodies)).toEqual([2, 4, 3]);
    expect(subtreeBodyIds(1, bodies)).toEqual([1]);
  });

  it('does not treat a same-named body in another branch as a descendant', () => {
    const twins = [
      node(1, 'Club', null, 0),
      node(2, 'Team', 1, 0),
      node(3, 'Club', null, 1),
      node(4, 'Team', 3, 0),
    ];
    expect(subtreeBodyIds(1, twins)).toEqual([1, 2]);
  });

  it('rejects a cycle and allows a move to root', () => {
    expect(wouldCycle(bodies, 2, 4)).toBe(true);
    expect(wouldCycle(bodies, 2, 2)).toBe(true);
    expect(wouldCycle(bodies, 3, 2)).toBe(false);
    expect(wouldCycle(bodies, 4, null)).toBe(false);
  });

  it('warns past the soft depth and does not invent a hard cap', () => {
    expect(depthWarning(SOFT_BODY_DEPTH)).toBeNull();
    expect(depthWarning(SOFT_BODY_DEPTH + 1)).toMatch(/still work/);
  });
});

describe('childCountLabel', () => {
  const child = (id: number, typeLabel: string, archivedAt: string | null = null): BodyNode => ({
    id,
    name: `Row ${id}`,
    typeLabel,
    createdAt: '2026-09-01T00:00:00.000Z',
    parentId: 1,
    archivedAt,
  });

  it('counts non-archived children and names them by their shared label', () => {
    const children = [1, 2, 3, 4, 5].map((id) => child(id, 'period'));
    expect(childCountLabel(children)).toBe('5 periods');
    expect(childCountLabel([...children, child(6, 'period', '2026-09-02T00:00:00.000Z')])).toBe(
      '5 periods',
    );
    expect(childCountLabel([child(1, 'period')])).toBe('1 period');
  });

  it('falls back to "children" when the labels differ or there are none left', () => {
    expect(childCountLabel([child(1, 'period'), child(2, 'team')])).toBe('2 children');
    expect(childCountLabel([child(1, 'period', '2026-09-02T00:00:00.000Z')])).toBe('0 children');
  });

  it('treats labels that differ only in case as one', () => {
    expect(childCountLabel([child(1, 'Period'), child(2, 'period ')])).toBe('2 Periods');
  });

  it('pluralizes simply', () => {
    expect(pluralizeTypeLabel('class')).toBe('classes');
    expect(pluralizeTypeLabel('activity')).toBe('activities');
    expect(pluralizeTypeLabel('day')).toBe('days');
    expect(pluralizeTypeLabel('section')).toBe('sections');
  });
});
