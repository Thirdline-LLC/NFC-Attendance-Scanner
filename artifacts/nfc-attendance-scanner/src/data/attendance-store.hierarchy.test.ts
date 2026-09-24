import Dexie from 'dexie';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  addPerson,
  archiveBody,
  createBody,
  getActiveBody,
  getActiveBodyId,
  listActivity,
  listBodies,
  listPersons,
  listTapRecords,
  recordSessionTap,
  renameBody,
  reparentBody,
  setActiveBody,
  writeSetting,
} from './attendance-store';

const DATABASE_NAME = 'attendance-scanner-local';

describe('body hierarchy', () => {
  beforeEach(async () => {
    localStorage.clear();
    await Dexie.delete(DATABASE_NAME);
  });

  it('creates a child under a parent and a root beside it, in sortOrder', async () => {
    const root = await getActiveBody();
    const child = await createBody({
      name: 'Finance',
      typeLabel: 'Branch',
      parentId: root.id,
    });
    const otherRoot = await createBody({ name: 'Later', typeLabel: 'Program' });

    expect(child.parentId).toBe(root.id);
    expect(otherRoot.parentId).toBeNull();
    expect((await listBodies()).map((body) => body.name)).toEqual([
      'Club',
      'Finance',
      'Later',
    ]);
    expect(await getActiveBodyId()).toBe(root.id);
  });

  it('refuses a reparent that would cycle and leaves the tree unchanged', async () => {
    const root = await getActiveBody();
    const child = await createBody({
      name: 'Finance',
      typeLabel: 'Branch',
      parentId: root.id,
    });
    const grand = await createBody({
      name: 'Ledger',
      typeLabel: 'Branch',
      parentId: child.id,
    });

    await expect(reparentBody(root.id as number, grand.id as number)).rejects.toThrow(
      /ancestor/,
    );
    await expect(reparentBody(child.id as number, child.id as number)).rejects.toThrow(
      /ancestor/,
    );

    const after = await listBodies();
    expect(after.find((body) => body.id === root.id)?.parentId ?? null).toBeNull();
    expect(after.find((body) => body.id === child.id)?.parentId).toBe(root.id);
    expect(after.find((body) => body.id === grand.id)?.parentId).toBe(child.id);
    expect(await listActivity()).toEqual([]);
  });

  it('reparents and renames without moving roster rows or taps', async () => {
    const root = await getActiveBody();
    const child = await createBody({
      name: 'Finance',
      typeLabel: 'Branch',
      parentId: root.id,
    });
    await setActiveBody(child.id as number);
    const rosa = await addPerson({
      cardUid: '04A1B2C3D4E5F6',
      firstName: 'Rosa',
      lastName: 'Alvarez',
      gradYear: 2027,
      email: 'ralvarez27@stjohnschs.org',
      enrolledAt: '2025-09-02T13:00:00.000Z',
    });
    await recordSessionTap({
      sessionId: 'session-child',
      uid: rosa.cardUid as string,
      scannedAt: '2025-09-10T22:31:00.000Z',
      personId: rosa.id,
    });

    await renameBody(child.id as number, { name: 'Finance Desk', typeLabel: 'Section' });
    await reparentBody(child.id as number, null);

    const moved = (await listBodies()).find((body) => body.id === child.id);
    expect(moved).toMatchObject({
      name: 'Finance Desk',
      typeLabel: 'Section',
      parentId: null,
    });
    expect((await listPersons()).map((person) => person.lastName)).toEqual(['Alvarez']);
    expect(await listTapRecords()).toHaveLength(1);
    expect((await listActivity()).some((entry) => entry.kind === 'body-reparent')).toBe(true);
  });

  it('refuses to activate an archived body and refuses to archive the active one', async () => {
    const root = await getActiveBody();
    const other = await createBody({ name: 'Shelf', typeLabel: 'Group' });

    await expect(archiveBody(root.id as number)).rejects.toThrow(/active body/);
    expect(await getActiveBodyId()).toBe(root.id);

    await archiveBody(other.id as number);
    await expect(setActiveBody(other.id as number)).rejects.toThrow(/[Aa]rchived/);
    expect(await getActiveBodyId()).toBe(root.id);
    expect((await listActivity()).some((entry) => entry.kind === 'body-archive')).toBe(true);

    await writeSetting('active-body-id', String(other.id));
    expect(await getActiveBodyId()).toBe(root.id);
  });
});
