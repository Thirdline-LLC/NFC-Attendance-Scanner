import Dexie from 'dexie';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  addPerson,
  applyRosterImport,
  bindCardToPerson,
  CardAlreadyBoundError,
  CardTakenError,
  countSessionAttendance,
  isUnbound,
  listPersons,
  listSessionTapRecords,
  listUnboundPersons,
  recordSessionTap,
  type RosterEntry,
} from './attendance-store';

const DATABASE_NAME = 'attendance-scanner-local';

// Every fixture here is invented. The card UIDs are deliberately unlike any
// real card and are never asserted in full outside this file's own setup.
const JORDAN_CARD = '04A1B2C3D4E5F6';
const STRAY_CARD = '04DEADBEEF1234';
const SESSION = 'session-under-test';

const jordanRow: RosterEntry = {
  firstName: 'Jordan',
  lastName: 'Lee',
  gradYear: 2027,
  email: 'jlee27@stjohnschs.org',
};

const priyaRow: RosterEntry = {
  firstName: 'Priya',
  lastName: 'Nair',
  gradYear: 2028,
  email: 'pnair28@stjohnschs.org',
};

beforeEach(async () => {
  localStorage.clear();
  await Dexie.delete(DATABASE_NAME);
});

describe('applyRosterImport', () => {
  it('creates students who have no card', async () => {
    const counts = await applyRosterImport([jordanRow, priyaRow]);

    expect(counts).toEqual({ added: 2, updated: 0, skipped: 0 });
    const stored = await listPersons();
    expect(stored.map((person) => person.email)).toEqual([
      jordanRow.email,
      priyaRow.email,
    ]);
    expect(stored.every(isUnbound)).toBe(true);
    expect(await listUnboundPersons()).toHaveLength(2);
  });

  it('changes nothing when the same file is imported again', async () => {
    await applyRosterImport([jordanRow, priyaRow]);
    const before = await listPersons();

    const counts = await applyRosterImport([jordanRow, priyaRow]);

    expect(counts).toEqual({ added: 0, updated: 0, skipped: 2 });
    expect(await listPersons()).toEqual(before);
  });

  it('matches an address whatever its case and spacing', async () => {
    await applyRosterImport([jordanRow]);

    const counts = await applyRosterImport([
      { ...jordanRow, email: '  JLee27@StJohnsCHS.org  ' },
    ]);

    expect(counts).toEqual({ added: 0, updated: 0, skipped: 1 });
    expect(await listPersons()).toHaveLength(1);
  });

  it('updates the details a later file corrects', async () => {
    await applyRosterImport([jordanRow]);

    const counts = await applyRosterImport([
      { ...jordanRow, lastName: 'Lee-Fischer', gradYear: 2028 },
    ]);

    expect(counts).toEqual({ added: 0, updated: 1, skipped: 0 });
    const [stored] = await listPersons();
    expect(stored.lastName).toBe('Lee-Fischer');
    expect(stored.gradYear).toBe(2028);
  });

  it('leaves a bound card alone when the file lists that student with none', async () => {
    const bound = await addPerson({
      cardUid: JORDAN_CARD,
      ...jordanRow,
      enrolledAt: '2026-09-01T12:00:00.000Z',
    });

    // The pre-enrollment shape: the same student, no card in the row.
    await applyRosterImport([{ ...jordanRow, firstName: 'Jordy' }]);

    const [stored] = await listPersons();
    expect(stored.id).toBe(bound.id);
    expect(stored.firstName).toBe('Jordy');
    // The card is hardware the student still carries. An import that lists
    // them without one must not retire it.
    expect(stored.cardUid).toBe(JORDAN_CARD);
  });

  it('leaves the roster untouched when a row cannot be written', async () => {
    await applyRosterImport([jordanRow]);
    const before = await listPersons();

    await expect(
      applyRosterImport([
        priyaRow,
        // No email at all: `add` rejects it, and the whole transaction with it.
        { ...priyaRow, email: undefined as unknown as string },
      ]),
    ).rejects.toThrow();

    // Priya's row would have landed first if this were not one transaction.
    expect(await listPersons()).toEqual(before);
  });
});

describe('bindCardToPerson', () => {
  /** A pre-enrolled student plus the unknown-card tap they just made. */
  async function tapAnUnknownCard() {
    await applyRosterImport([jordanRow, priyaRow]);
    const [jordan] = await listUnboundPersons();
    await recordSessionTap({
      sessionId: SESSION,
      uid: JORDAN_CARD,
      scannedAt: '2026-09-15T20:00:00.000Z',
      personId: null,
    });
    return jordan;
  }

  it('gives the card to the student and counts the tap they already made', async () => {
    const jordan = await tapAnUnknownCard();
    expect(await countSessionAttendance(SESSION)).toBe(0);

    const binding = await bindCardToPerson({
      personId: jordan.id as number,
      cardUid: JORDAN_CARD,
      sessionId: SESSION,
    });

    expect(binding.person.cardUid).toBe(JORDAN_CARD);
    expect(binding.countedThisSession).toBe(true);
    expect(binding.attendanceCount).toBe(1);
    // The tap it claimed is the one already in the session, not a new row.
    const taps = await listSessionTapRecords(SESSION);
    expect(taps).toHaveLength(1);
    expect(taps[0]).toMatchObject({ personId: jordan.id, counted: true });
    // And that student is no longer on offer for the next unknown card.
    expect((await listUnboundPersons()).map((person) => person.email)).toEqual([
      priyaRow.email,
    ]);
  });

  it('counts the card once however many times it tapped first', async () => {
    const jordan = await tapAnUnknownCard();
    await recordSessionTap({
      sessionId: SESSION,
      uid: JORDAN_CARD,
      scannedAt: '2026-09-15T20:01:00.000Z',
      personId: null,
    });

    const binding = await bindCardToPerson({
      personId: jordan.id as number,
      cardUid: JORDAN_CARD,
      sessionId: SESSION,
    });

    expect(binding.attendanceCount).toBe(1);
    const taps = await listSessionTapRecords(SESSION);
    expect(taps.map((tap) => tap.counted)).toEqual([true, false]);
    expect(taps.every((tap) => tap.personId === jordan.id)).toBe(true);
  });

  it('binds a student who has not tapped at all', async () => {
    await applyRosterImport([jordanRow]);
    const [jordan] = await listUnboundPersons();

    const binding = await bindCardToPerson({
      personId: jordan.id as number,
      cardUid: JORDAN_CARD,
      sessionId: SESSION,
    });

    expect(binding.person.cardUid).toBe(JORDAN_CARD);
    expect(binding.countedThisSession).toBe(false);
    expect(binding.attendanceCount).toBe(0);
  });

  it('refuses to replace a card the student already taps with', async () => {
    const bound = await addPerson({
      cardUid: JORDAN_CARD,
      ...jordanRow,
      enrolledAt: '2026-09-01T12:00:00.000Z',
    });

    await expect(
      bindCardToPerson({
        personId: bound.id,
        cardUid: STRAY_CARD,
        sessionId: SESSION,
      }),
    ).rejects.toBeInstanceOf(CardAlreadyBoundError);

    const [stored] = await listPersons();
    expect(stored.cardUid).toBe(JORDAN_CARD);
  });

  it('refuses a card that already belongs to somebody else', async () => {
    await addPerson({
      cardUid: JORDAN_CARD,
      ...jordanRow,
      enrolledAt: '2026-09-01T12:00:00.000Z',
    });
    await applyRosterImport([priyaRow]);
    const [priya] = await listUnboundPersons();

    await expect(
      bindCardToPerson({
        personId: priya.id as number,
        cardUid: JORDAN_CARD,
        sessionId: SESSION,
      }),
    ).rejects.toBeInstanceOf(CardTakenError);

    expect(await listUnboundPersons()).toHaveLength(1);
  });

  it('names the student but never the card in a refusal', async () => {
    const bound = await addPerson({
      cardUid: JORDAN_CARD,
      ...jordanRow,
      enrolledAt: '2026-09-01T12:00:00.000Z',
    });

    const refusal = await bindCardToPerson({
      personId: bound.id,
      cardUid: STRAY_CARD,
      sessionId: SESSION,
    }).catch((error: Error) => error);

    expect(refusal.message).toContain('Jordan Lee');
    expect(refusal.message).toContain('••••E5F6');
    expect(refusal.message).not.toContain(JORDAN_CARD);
    expect(refusal.message).not.toContain(STRAY_CARD);
  });

  it('leaves last week alone when it counts this week', async () => {
    const jordan = await tapAnUnknownCard();
    await recordSessionTap({
      sessionId: 'last-week',
      uid: JORDAN_CARD,
      scannedAt: '2026-09-08T20:00:00.000Z',
      personId: null,
    });

    await bindCardToPerson({
      personId: jordan.id as number,
      cardUid: JORDAN_CARD,
      sessionId: SESSION,
    });

    // Attendance already reported for a finished meeting must not move under
    // a teacher because a card was bound today.
    expect(await countSessionAttendance('last-week')).toBe(0);
    expect(await countSessionAttendance(SESSION)).toBe(1);
  });
});
