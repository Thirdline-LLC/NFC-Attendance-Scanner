import { describe, expect, it } from 'vitest';
import type { Person } from '@/data/attendance-store';
import { indexRoster, resolveTapPerson } from './tap-identity';

const jordan: Person = {
  id: 1,
  cardUid: '04A1B2C3D4E5F6',
  firstName: 'Jordan',
  lastName: 'Lee',
  gradYear: 2027,
  email: 'jlee27@stjohnschs.org',
  enrolledAt: '2026-09-01T10:00:00.000Z',
};

const priya: Person = {
  id: 2,
  cardUid: '04F6E5D4C3B2A1',
  firstName: 'Priya',
  lastName: 'Nair',
  gradYear: 2028,
  email: 'pnair28@stjohnschs.org',
  enrolledAt: '2026-09-02T10:00:00.000Z',
};

const roster = indexRoster([jordan, priya]);

describe('resolveTapPerson', () => {
  it('matches a tap by the person id stored at scan time', () => {
    expect(resolveTapPerson({ uid: jordan.cardUid, personId: 1 }, roster)).toBe(
      jordan,
    );
  });

  it('matches an unknown-at-the-time tap retroactively by card UID', () => {
    expect(
      resolveTapPerson({ uid: priya.cardUid, personId: null }, roster),
    ).toBe(priya);
  });

  it('falls back to the card when the stored person id no longer resolves', () => {
    expect(
      resolveTapPerson({ uid: jordan.cardUid, personId: 99 }, roster),
    ).toBe(jordan);
  });

  it('returns undefined for a card nobody has enrolled', () => {
    expect(
      resolveTapPerson({ uid: '00000000000000', personId: null }, roster),
    ).toBeUndefined();
  });

  it('skips roster entries without an id when indexing by id', () => {
    const unsaved: Person = { ...priya, id: undefined };
    const index = indexRoster([unsaved]);

    expect(index.byId.size).toBe(0);
    expect(index.byCardUid.get(priya.cardUid)).toBe(unsaved);
  });
});
