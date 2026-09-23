import Dexie from 'dexie';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  addPerson,
  createBody,
  getActiveBody,
  getActiveBodyId,
  listBodies,
  listPersons,
  listTapRecords,
  recordSessionTap,
  setActiveBody,
} from './attendance-store';

const DATABASE_NAME = 'attendance-scanner-local';

describe('attendance bodies', () => {
  beforeEach(async () => {
    localStorage.clear();
    await Dexie.delete(DATABASE_NAME);
  });

  it('creates a default body and attaches to it on first use of a bare database', async () => {
    const body = await getActiveBody();

    expect(body.name).toBe('Club');
    expect(body.typeLabel).toBe('club');
    expect(await listBodies()).toEqual([body]);
    expect(await getActiveBodyId()).toBe(body.id);
  });

  it('createBody adds a body without switching the device to it', async () => {
    const original = await getActiveBody();

    const created = await createBody({ name: 'Robotics Club', typeLabel: 'club' });

    expect(await listBodies()).toHaveLength(2);
    expect(await getActiveBodyId()).toBe(original.id);
    expect(created.name).toBe('Robotics Club');
  });

  it('setActiveBody points the device at a different body', async () => {
    const created = await createBody({ name: 'Chess Club', typeLabel: 'club' });

    await setActiveBody(created.id as number);

    expect((await getActiveBody()).id).toBe(created.id);
  });

  it('setActiveBody refuses an id that does not belong to any body', async () => {
    await expect(setActiveBody(999)).rejects.toThrow(
      'No attendance body has id 999.',
    );
  });

  it('switching the active body does not delete or alter the previous body’s roster and taps', async () => {
    const clubA = await getActiveBody();
    const rosa = await addPerson({
      cardUid: '04A1B2C3D4E5F6',
      firstName: 'Rosa',
      lastName: 'Alvarez',
      gradYear: 2027,
      email: 'ralvarez27@stjohnschs.org',
      enrolledAt: '2025-09-02T13:00:00.000Z',
    });
    await recordSessionTap({
      sessionId: 'session-club-a',
      uid: rosa.cardUid as string,
      scannedAt: '2025-09-10T22:31:00.000Z',
      personId: rosa.id,
    });

    const clubB = await createBody({ name: 'Debate Club', typeLabel: 'club' });
    await setActiveBody(clubB.id as number);

    // The new active body starts with an empty roster and history — it never
    // inherits club A's data.
    expect(await listPersons()).toEqual([]);
    expect(await listTapRecords()).toEqual([]);

    await addPerson({
      cardUid: '04FFEEDDCCBBAA',
      firstName: 'Kai',
      lastName: 'Nakamura',
      gradYear: 2028,
      email: 'knakamura28@stjohnschs.org',
      enrolledAt: '2025-09-02T13:05:00.000Z',
    });

    // Switching back, club A's roster and tap are exactly as they were —
    // reassignment moved the attachment, not the data (D-T2).
    await setActiveBody(clubA.id as number);
    expect((await listPersons()).map((person) => person.lastName)).toEqual([
      'Alvarez',
    ]);
    expect(await listTapRecords()).toHaveLength(1);
  });
});
