import Dexie from 'dexie';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  addPerson,
  bindCardToPerson,
  countSessionAttendance,
  createBody,
  deletePerson,
  findPersonByUid,
  getActiveBody,
  getActiveBodyId,
  listBodies,
  listPersons,
  listSessionTapRecords,
  listTapRecords,
  previewPersonRemoval,
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

  it('deleting a person in one body never removes or counts another body’s tap of the same physical card', async () => {
    const CARD = '04A1B2C3D4E5F6';
    const clubA = await getActiveBody();
    const rosa = await addPerson({
      cardUid: CARD,
      firstName: 'Rosa',
      lastName: 'Alvarez',
      gradYear: 2027,
      email: 'ralvarez27@stjohnschs.org',
      enrolledAt: '2025-09-02T13:00:00.000Z',
    });
    await recordSessionTap({
      sessionId: 'session-club-a',
      uid: CARD,
      scannedAt: '2025-09-10T22:31:00.000Z',
      personId: rosa.id,
    });

    // The same physical card shows up at club B's kiosk as an unrecognised
    // tap — nobody there has enrolled it.
    const clubB = await createBody({ name: 'Debate Club', typeLabel: 'club' });
    await setActiveBody(clubB.id as number);
    await recordSessionTap({
      sessionId: 'session-club-b',
      uid: CARD,
      scannedAt: '2025-09-11T15:00:00.000Z',
      personId: null,
    });
    expect(await listTapRecords()).toHaveLength(1);

    await setActiveBody(clubA.id as number);
    // The preview must not count club B's tap of the same card as one of
    // Rosa's — she only has the one, in club A.
    expect(await previewPersonRemoval(rosa.id as number)).toEqual({
      tapCount: 1,
      sessionCount: 1,
    });

    await deletePerson(rosa.id as number);

    await setActiveBody(clubB.id as number);
    expect(await listTapRecords()).toHaveLength(1);
  });

  it('does not mix session attendance across bodies that reuse the same session id', async () => {
    const CARD = '04A1B2C3D4E5F6';
    const SHARED_SESSION = 'shared-session';
    const clubA = await getActiveBody();
    const rosa = await addPerson({
      cardUid: CARD,
      firstName: 'Rosa',
      lastName: 'Alvarez',
      gradYear: 2027,
      email: 'ralvarez27@stjohnschs.org',
      enrolledAt: '2025-09-02T13:00:00.000Z',
    });
    await recordSessionTap({
      sessionId: SHARED_SESSION,
      uid: CARD,
      scannedAt: '2025-09-10T22:31:00.000Z',
      personId: rosa.id,
    });

    const clubB = await createBody({ name: 'Debate Club', typeLabel: 'club' });
    await setActiveBody(clubB.id as number);
    // Same physical card, same literal session id — the device never
    // rotates it on switch — enrolled to a different student in club B. Club
    // B has not seen this card in this session yet, so its tap should count,
    // not be treated as a repeat of club A's.
    const kai = await addPerson({
      cardUid: CARD,
      firstName: 'Kai',
      lastName: 'Nakamura',
      gradYear: 2028,
      email: 'knakamura28@stjohnschs.org',
      enrolledAt: '2025-09-02T13:05:00.000Z',
    });
    const tap = await recordSessionTap({
      sessionId: SHARED_SESSION,
      uid: CARD,
      scannedAt: '2025-09-11T15:00:00.000Z',
      personId: kai.id,
    });
    expect(tap.priorCounted).toBe(false);
    expect(tap.tap.counted).toBe(true);
    expect(await countSessionAttendance(SHARED_SESSION)).toBe(1);
    expect(await listSessionTapRecords(SHARED_SESSION)).toHaveLength(1);

    await setActiveBody(clubA.id as number);
    expect(await countSessionAttendance(SHARED_SESSION)).toBe(1);
    expect(await listSessionTapRecords(SHARED_SESSION)).toHaveLength(1);
  });

  it('lets the same physical card be enrolled and bound in two different bodies independently', async () => {
    const CARD = '04A1B2C3D4E5F6';
    const clubA = await getActiveBody();
    await addPerson({
      cardUid: CARD,
      firstName: 'Rosa',
      lastName: 'Alvarez',
      gradYear: 2027,
      email: 'ralvarez27@stjohnschs.org',
      enrolledAt: '2025-09-02T13:00:00.000Z',
    });

    const clubB = await createBody({ name: 'Debate Club', typeLabel: 'club' });
    await setActiveBody(clubB.id as number);
    const kai = await addPerson({
      firstName: 'Kai',
      lastName: 'Nakamura',
      gradYear: 2028,
      email: 'knakamura28@stjohnschs.org',
      enrolledAt: '2025-09-02T13:05:00.000Z',
    });
    await recordSessionTap({
      sessionId: 'session-club-b',
      uid: CARD,
      scannedAt: '2025-09-11T15:00:00.000Z',
      personId: null,
    });

    // Binding club B's own unbound student to a card club A already uses
    // must not throw, and must not reveal club A's roster.
    const binding = await bindCardToPerson({
      personId: kai.id as number,
      cardUid: CARD,
      sessionId: 'session-club-b',
    });
    expect(binding.person.lastName).toBe('Nakamura');

    await setActiveBody(clubA.id as number);
    expect((await findPersonByUid(CARD))?.lastName).toBe('Alvarez');
  });

  it('does not create duplicate bodies when several first-use calls race on a fresh database', async () => {
    const results = await Promise.all([
      getActiveBodyId(),
      getActiveBodyId(),
      getActiveBodyId(),
      getActiveBodyId(),
      getActiveBodyId(),
    ]);

    expect(await listBodies()).toHaveLength(1);
    expect(new Set(results).size).toBe(1);
  });
});
