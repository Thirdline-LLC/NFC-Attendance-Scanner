import Dexie from 'dexie';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  countSessionAttendance,
  listSessionTapRecords,
  listTapRecords,
  listPersons,
} from '@/data/attendance-store';
import { useAttendanceSession } from '@/scanner/use-attendance-session';

/**
 * The scan path is serialised through a promise queue, and a kiosk pushes on
 * it hard: an HID reader can fire faster than IndexedDB commits, a volunteer
 * presses Retry mid-burst, and "Start New Session" is one tap away from the
 * reader. Every test here asserts the same three things — no tap dropped, no
 * tap counted twice, and the number on screen equal to
 * `countSessionAttendance` for the session actually being run.
 */

const DATABASE_NAME = 'attendance-scanner-local';

/**
 * A hold placed on one store call, so a test can park it mid-flight and do
 * something to the session underneath it. Hoisted because `vi.mock` runs
 * before the module body.
 */
const gates = vi.hoisted(() => {
  type Gate = {
    reached: Promise<void>;
    held: Promise<void> | null;
    hold(): void;
    arrive(): void;
    open(): void;
  };

  const makeGate = (): Gate => {
    let release: (() => void) | null = null;
    let entered: (() => void) | null = null;

    return {
      /** Resolves once a gated call has actually reached the gate. */
      reached: Promise.resolve(),
      held: null,
      hold() {
        this.held = new Promise<void>((resolve) => {
          release = resolve;
        });
        this.reached = new Promise<void>((resolve) => {
          entered = resolve;
        });
      },
      arrive() {
        entered?.();
      },
      open() {
        release?.();
        this.held = null;
      },
    };
  };

  return { write: makeGate(), read: makeGate() };
});

vi.mock('@/data/attendance-store', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/data/attendance-store')>();

  return {
    ...actual,
    recordSessionTap: async (
      input: Parameters<typeof actual.recordSessionTap>[0],
    ) => {
      if (gates.write.held) {
        gates.write.arrive();
        await gates.write.held;
      }
      return actual.recordSessionTap(input);
    },
    countSessionAttendance: async (sessionId: string) => {
      if (gates.read.held) {
        gates.read.arrive();
        await gates.read.held;
      }
      return actual.countSessionAttendance(sessionId);
    },
  };
});

const CARDS = [
  '04A1B2C3D4E5F6',
  '04FFEEDDCCBBAA',
  '0400112233445F',
  '04ABCDEF012345',
  '0455667788990A',
];

async function enrol(
  hook: ReturnType<typeof renderHook<ReturnType<typeof useAttendanceSession>, unknown>>,
  cardUid: string,
  index: number,
): Promise<void> {
  await act(async () => {
    await hook.result.current.handleScan(cardUid);
  });
  await act(async () => {
    await hook.result.current.enrollPerson({
      firstName: 'Student',
      lastName: `Number${index}`,
      gradYear: 2027,
      email: `student${index}@stjohnschs.org`,
    });
  });
}

/** Renders the hook in enroll mode, adds the roster, and hands back check-in. */
async function renderWithRoster(cards: readonly string[]) {
  const enrolling = renderHook(() => useAttendanceSession('enroll'));
  await waitFor(() => expect(enrolling.result.current.isLoading).toBe(false));
  for (const [index, card] of cards.entries()) {
    await enrol(enrolling, card, index);
  }
  enrolling.unmount();

  const hook = renderHook(() => useAttendanceSession('checkin'));
  await waitFor(() => expect(hook.result.current.isLoading).toBe(false));
  expect(hook.result.current.persons).toHaveLength(cards.length);
  return hook;
}

/** The invariant the kiosk's headline number depends on. */
async function expectCountAgreesWithStore(
  hook: ReturnType<typeof renderHook<ReturnType<typeof useAttendanceSession>, unknown>>,
): Promise<void> {
  const sessionId = hook.result.current.sessionId;
  expect(hook.result.current.count).toBe(
    await countSessionAttendance(sessionId),
  );
}

describe('the scan queue under load', () => {
  beforeEach(async () => {
    localStorage.clear();
    gates.write.open();
    gates.read.open();
    await Dexie.delete(DATABASE_NAME);
  });

  afterEach(() => {
    cleanup();
  });

  it('keeps every tap of a burst fired without awaiting, and counts each card once', async () => {
    const hook = await renderWithRoster(CARDS);
    const sessionId = hook.result.current.sessionId;

    // Forty taps thrown at the hook with nothing awaited: five cards, eight
    // passes, which is what a queue of students tapping twice looks like.
    await act(async () => {
      const scans: Promise<void>[] = [];
      for (let pass = 0; pass < 8; pass += 1) {
        for (const card of CARDS) scans.push(hook.result.current.handleScan(card));
      }
      await Promise.all(scans);
    });

    const stored = await listSessionTapRecords(sessionId);
    expect(stored).toHaveLength(40);
    expect(stored.filter((tap) => tap.counted)).toHaveLength(CARDS.length);
    expect(hook.result.current.taps).toHaveLength(40);
    expect(hook.result.current.count).toBe(CARDS.length);
    expect(hook.result.current.metrics).toMatchObject({
      uniqueAttendance: CARDS.length,
      totalTaps: 40,
      duplicateTaps: 40 - CARDS.length,
      unknownCards: 0,
    });
    await expectCountAgreesWithStore(hook);
  });

  it('holds the count steady when a storage retry races a burst', async () => {
    const hook = await renderWithRoster(CARDS);
    const sessionId = hook.result.current.sessionId;

    await act(async () => {
      const inFlight: Promise<unknown>[] = [];
      for (const card of CARDS) {
        inFlight.push(hook.result.current.handleScan(card));
        // A volunteer pressing Retry in the middle of a queue of students.
        inFlight.push(hook.result.current.retryStorage());
      }
      await Promise.all(inFlight);
    });

    expect(await listSessionTapRecords(sessionId)).toHaveLength(CARDS.length);
    expect(hook.result.current.taps).toHaveLength(CARDS.length);
    expect(hook.result.current.count).toBe(CARDS.length);
    expect(hook.result.current.storageStatus).toBe('ready');
    await expectCountAgreesWithStore(hook);
  });

  it('does not lose an enrolment to a tap committing beside it', async () => {
    const hook = renderHook(() => useAttendanceSession('enroll'));
    await waitFor(() => expect(hook.result.current.isLoading).toBe(false));
    await enrol(hook, CARDS[0], 0);

    // Open a second student's form, then let a tap of the first student's
    // card land while the save is in flight. Enrolment does not share the
    // scan queue, so these two really do interleave.
    await act(async () => {
      await hook.result.current.handleScan(CARDS[1]);
    });
    await act(async () => {
      await Promise.all([
        hook.result.current.enrollPerson({
          firstName: 'Student',
          lastName: 'Number1',
          gradYear: 2028,
          email: 'student1@stjohnschs.org',
        }),
        hook.result.current.handleScan(CARDS[0]),
      ]);
    });

    const roster = await listPersons();
    expect(roster.map((person) => person.cardUid).sort()).toEqual(
      [CARDS[0], CARDS[1]].sort(),
    );
    expect(hook.result.current.persons).toHaveLength(2);
    // Enroll mode records no tap, so the store is untouched by the scan.
    expect(await listTapRecords()).toHaveLength(0);
  });

  it('leaves a tap that lands after a rotation with the session it belongs to', async () => {
    const hook = await renderWithRoster([CARDS[0], CARDS[1]]);
    const firstSessionId = hook.result.current.sessionId;

    await act(async () => {
      await hook.result.current.handleScan(CARDS[0]);
    });
    expect(hook.result.current.count).toBe(1);

    // A card read at the moment the volunteer starts the next meeting: the
    // write is parked at the gate, the session rotates under it, and only
    // then does it commit.
    gates.write.hold();
    let straggler: Promise<void> | undefined;
    await act(async () => {
      straggler = hook.result.current.handleScan(CARDS[1]);
      await gates.write.reached;
    });
    await act(async () => {
      await hook.result.current.startNewSession();
    });
    await act(async () => {
      gates.write.open();
      await straggler;
    });

    const secondSessionId = hook.result.current.sessionId;
    expect(secondSessionId).not.toBe(firstSessionId);

    // The tap is not lost: it belongs to the meeting that was being run when
    // the card was read.
    const firstSessionTaps = await listSessionTapRecords(firstSessionId);
    expect(firstSessionTaps.map((tap) => tap.uid)).toEqual([CARDS[0], CARDS[1]]);
    expect(await countSessionAttendance(firstSessionId)).toBe(2);

    // ...and it is not on the new session's screen, whose count is the new
    // session's own.
    expect(await listSessionTapRecords(secondSessionId)).toHaveLength(0);
    expect(hook.result.current.taps).toEqual([]);
    expect(hook.result.current.count).toBe(0);
    await expectCountAgreesWithStore(hook);
  });

  it('ignores a storage read that a rotation has overtaken', async () => {
    const hook = await renderWithRoster([CARDS[0], CARDS[1]]);
    const firstSessionId = hook.result.current.sessionId;

    await act(async () => {
      await hook.result.current.handleScan(CARDS[0]);
      await hook.result.current.handleScan(CARDS[1]);
    });
    expect(hook.result.current.count).toBe(2);

    // Retry reads the session it was started on. Parking that read and
    // rotating before it lands must not put the finished meeting's two taps
    // and its count under the new session's heading.
    gates.read.hold();
    let reading: Promise<void> | undefined;
    await act(async () => {
      reading = hook.result.current.retryStorage();
      await gates.read.reached;
    });
    await act(async () => {
      await hook.result.current.startNewSession();
    });
    await act(async () => {
      gates.read.open();
      await reading;
    });

    expect(hook.result.current.sessionId).not.toBe(firstSessionId);
    expect(hook.result.current.taps).toEqual([]);
    expect(hook.result.current.count).toBe(0);
    await expectCountAgreesWithStore(hook);
    // The finished meeting still has its taps.
    expect(await listSessionTapRecords(firstSessionId)).toHaveLength(2);
  });
});
