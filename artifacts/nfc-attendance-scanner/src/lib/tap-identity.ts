import type { Person, TapRecord } from '@/data/attendance-store';

/**
 * Roster lookups keyed both ways, so a tap can be matched by the person id
 * stored at scan time or, failing that, by the card itself.
 */
export type RosterIndex = {
  byId: ReadonlyMap<number, Person>;
  byCardUid: ReadonlyMap<string, Person>;
};

export function indexRoster(persons: readonly Person[]): RosterIndex {
  const byId = new Map<number, Person>();
  const byCardUid = new Map<string, Person>();

  for (const person of persons) {
    if (person.id !== undefined) byId.set(person.id, person);
    // A pre-enrolled student with no card yet is in `byId` only: indexing
    // them under an absent card would make every unbound student answer to
    // the same lookup, and the first of them would claim every unknown tap.
    if (person.cardUid !== undefined) byCardUid.set(person.cardUid, person);
  }

  return { byId, byCardUid };
}

/**
 * The student a tap belongs to, if the roster knows them. A tap records the
 * `personId` known at scan time, which stays `null` for a card that had not
 * been enrolled yet; enrolling that card later matches those earlier taps
 * retroactively, by UID. A `personId` that no longer resolves (the roster
 * entry is gone) also falls back to the card.
 */
export function resolveTapPerson(
  tap: Pick<TapRecord, 'uid' | 'personId'>,
  roster: RosterIndex,
): Person | undefined {
  if (tap.personId !== null) {
    const byId = roster.byId.get(tap.personId);
    if (byId) return byId;
  }

  return roster.byCardUid.get(tap.uid);
}
