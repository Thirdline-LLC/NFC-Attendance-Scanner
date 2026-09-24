import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BodyHierarchyError,
  BodyVocabError,
  addBodyFieldDef,
  createClassWithPeriods,
  getActiveBody,
  getActiveBodyId,
  listActivity,
  listBodies,
  listBodyTypeDefs,
} from './attendance-store';
import { classSetupIssues, firstClassSetupIssue } from './class-with-periods';

const DATABASE_NAME = 'attendance-scanner-local';

const FIVE = ['Period 1', 'Period 3', 'Period 4', 'Period 6', 'Period 7'];

describe('createClassWithPeriods', () => {
  beforeEach(async () => {
    localStorage.clear();
    await Dexie.delete(DATABASE_NAME);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates the parent and one child per period, in the entered order', async () => {
    const before = await getActiveBody();
    const { parent, periods } = await createClassWithPeriods({
      className: '  English 11 ',
      periodNames: FIVE.map((name) => ` ${name} `),
    });

    expect(parent).toMatchObject({ name: 'English 11', typeLabel: 'class', parentId: null });
    expect(periods.map((period) => period.name)).toEqual(FIVE);
    expect(periods.every((period) => period.parentId === parent.id)).toBe(true);
    expect(periods.every((period) => period.typeLabel === 'period')).toBe(true);
    expect(periods.map((period) => period.sortOrder)).toEqual([0, 1, 2, 3, 4]);

    const stored = await listBodies();
    // Tree order: the default root, then the class, then its periods in order.
    expect(stored.map((body) => body.name)).toEqual(['Club', 'English 11', ...FIVE]);
    expect(stored.find((body) => body.id === parent.id)?.sortOrder).toBe(1);
    // Like createBody, the device stays where it was.
    expect(await getActiveBodyId()).toBe(before.id);
  });

  it('adds both type labels to the vocabulary, once each', async () => {
    await createClassWithPeriods({
      className: 'Robotics',
      parentTypeLabel: 'club',
      childTypeLabel: 'Build team',
      periodNames: ['Drive', 'Build'],
    });
    await createClassWithPeriods({
      className: 'Chess',
      parentTypeLabel: 'Club',
      childTypeLabel: 'build team',
      periodNames: ['A'],
    });

    const labels = (await listBodyTypeDefs()).map((def) => def.label);
    expect(labels.filter((label) => label.toLowerCase() === 'club')).toHaveLength(1);
    expect(labels).toContain('Build team');
    expect(labels.filter((label) => label.toLowerCase() === 'build team')).toHaveLength(1);
  });

  it('allows a class name another root already uses, as createBody does', async () => {
    await createClassWithPeriods({ className: 'English 11', periodNames: ['A'] });
    await createClassWithPeriods({ className: 'English 11', periodNames: ['A'] });
    expect((await listBodies()).filter((body) => body.name === 'English 11')).toHaveLength(2);
  });

  it.each([
    ['no periods', { className: 'English 11', periodNames: [] }],
    [
      'eleven periods',
      {
        className: 'English 11',
        periodNames: Array.from({ length: 11 }, (_, index) => `P${index + 1}`),
      },
    ],
    ['a blank class name', { className: '   ', periodNames: ['Period 1'] }],
    ['a blank period name', { className: 'English 11', periodNames: ['Period 1', '  '] }],
    [
      'duplicate period names (trimmed, any case)',
      { className: 'English 11', periodNames: ['Period 1', ' period 1'] },
    ],
    [
      'a blank type label',
      { className: 'English 11', childTypeLabel: ' ', periodNames: ['Period 1'] },
    ],
  ])('refuses %s and creates nothing', async (_label, input) => {
    await getActiveBody();
    const before = await listBodies();
    const vocabBefore = await listBodyTypeDefs();

    await expect(createClassWithPeriods(input)).rejects.toBeInstanceOf(BodyHierarchyError);

    expect(await listBodies()).toEqual(before);
    expect(await listBodyTypeDefs()).toEqual(vocabBefore);
  });

  it('refuses a type label with a required custom field, before any write', async () => {
    await addBodyFieldDef({ label: 'Room', appliesToTypeLabel: 'period', required: true });
    const before = await listBodies();

    await expect(
      createClassWithPeriods({ className: 'English 11', periodNames: ['Period 1'] }),
    ).rejects.toBeInstanceOf(BodyVocabError);
    expect(await listBodies()).toEqual(before);
  });

  it('rolls the whole class back when a write fails part-way', async () => {
    await getActiveBody();
    const before = await listBodies();
    const vocabBefore = await listBodyTypeDefs();

    // The third child's insert fails after the parent and two children are
    // in. Dexie gives every database a Table subclass whose parent prototype
    // is shared, so a spy on that one reaches the store's own tables.
    const probe = new Dexie('class-periods-probe');
    probe.version(1).stores({ rows: '++id' });
    const tableProto = Object.getPrototypeOf(Object.getPrototypeOf(probe.table('rows'))) as {
      add: (this: { name: string }, ...args: unknown[]) => unknown;
    };
    const realAdd = tableProto.add;
    let inserts = 0;
    vi.spyOn(tableProto, 'add').mockImplementation(function (
      this: { name: string },
      ...args: unknown[]
    ) {
      if (this.name === 'bodies') {
        inserts += 1;
        if (inserts === 4) return Dexie.Promise.reject(new Error('disk full'));
      }
      return realAdd.apply(this, args);
    });

    await expect(
      createClassWithPeriods({ className: 'English 11', periodNames: FIVE }),
    ).rejects.toThrow('disk full');
    vi.restoreAllMocks();

    expect(inserts).toBe(4);
    expect(await listBodies()).toEqual(before);
    expect(await listBodyTypeDefs()).toEqual(vocabBefore);
  });

  it('writes no activity row, so nothing about students can reach the log', async () => {
    await createClassWithPeriods({ className: 'English 11', periodNames: FIVE });
    expect(await listActivity()).toEqual([]);
  });
});

describe('classSetupIssues', () => {
  it('flags each bad row by position and leaves good rows alone', () => {
    const issues = classSetupIssues({
      className: 'English 11',
      parentTypeLabel: 'class',
      childTypeLabel: 'period',
      periodNames: ['Period 1', '', 'PERIOD 1', 'Period 4'],
    });
    expect(issues.periods).toEqual([
      null,
      'Give this row a name.',
      'Another row already has this name.',
      null,
    ]);
    expect(firstClassSetupIssue(issues)).toBe('Row 2: Give this row a name.');
  });

  it('is clean for a valid draft', () => {
    const issues = classSetupIssues({
      className: 'English 11',
      parentTypeLabel: 'class',
      childTypeLabel: 'period',
      periodNames: ['1', '3', '4'],
    });
    expect(firstClassSetupIssue(issues)).toBeNull();
  });
});
