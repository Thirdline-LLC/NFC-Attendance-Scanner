import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  addPerson,
  countSessionAttendance,
  createNewSessionId,
  DuplicateEmailError,
  findPersonByUid,
  getOrCreateSessionStartedAt,
  getOrCreateSessionId,
  listPersons,
  listSessionTapRecords,
  recordSessionTap,
  updatePerson,
  type Person,
  type TapRecord,
} from '@/data/attendance-store';
import { isValidUid, maskCardUid, normalizeUid } from '@/lib/scan-format';

export type ScannerMode = 'checkin' | 'enroll';
export type ScanFeedback =
  | 'ready'
  | 'valid'
  | 'duplicate'
  | 'invalid'
  | 'unknown'
  | 'enrollment'
  | 'enrolled'
  | 'editing'
  | 'updated'
  | 'existing'
  | 'storage-error'
  | 'storage-unavailable';

/**
 * How local storage is doing, which the kiosk has to distinguish because the
 * two failures need different words and different actions from the operator.
 *
 * - `checking` — the opening read is in flight.
 * - `ready` — IndexedDB answered; scans are being saved.
 * - `unavailable` — the store could not be opened or read at all (private
 *   browsing, blocked site data, a full disk). Nothing can be saved until
 *   something changes on the device, so enrollment is held back entirely.
 * - `save-failed` — the store opened, but a write did not land. The next
 *   successful write clears it.
 */
export type StorageStatus = 'checking' | 'ready' | 'unavailable' | 'save-failed';

export type EnrollmentCandidate = {
  uid: string;
  person?: Person;
};

export type SessionMetrics = {
  uniqueAttendance: number;
  totalTaps: number;
  duplicateTaps: number;
  unknownCards: number;
};

export type SessionSummary = SessionMetrics & {
  sessionStartedAt: string;
  endedAt: string;
};

function calculateMetrics(taps: TapRecord[]): SessionMetrics {
  const unknownUids = new Set<string>();
  for (const tap of taps) {
    if (tap.personId === null) unknownUids.add(tap.uid);
  }

  return {
    uniqueAttendance: taps.filter((tap) => tap.counted).length,
    totalTaps: taps.length,
    duplicateTaps: taps.filter(
      (tap) => tap.personId !== null && !tap.counted,
    ).length,
    unknownCards: unknownUids.size,
  };
}

export function useAttendanceSession(mode: ScannerMode) {
  const [sessionId, setSessionId] = useState(() => getOrCreateSessionId());
  const [sessionStartedAt, setSessionStartedAt] = useState(() =>
    getOrCreateSessionStartedAt(sessionId),
  );
  const [persons, setPersons] = useState<Person[]>([]);
  const [taps, setTaps] = useState<TapRecord[]>([]);
  const [attendanceCount, setAttendanceCount] = useState(0);
  const [feedback, setFeedback] = useState<ScanFeedback>('ready');
  const [lastUid, setLastUid] = useState('');
  const [lastPerson, setLastPerson] = useState<Person | undefined>();
  const [lastScannedAt, setLastScannedAt] = useState('');
  // When a repeat tap's student was actually counted. `lastScannedAt` is the
  // repeat's own clock reading, so reporting that would tell the operator the
  // student checked in a moment ago whenever they tap again.
  const [lastCountedAt, setLastCountedAt] = useState('');
  const [enrollmentCandidate, setEnrollmentCandidate] =
    useState<EnrollmentCandidate | null>(null);
  const [sessionSummary, setSessionSummary] = useState<SessionSummary | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [storageStatus, setStorageStatus] = useState<StorageStatus>('checking');
  // A save that failed for a reason storage cannot explain, phrased for the
  // enrollment form rather than the feedback panel the form is covering.
  const [saveErrorMessage, setSaveErrorMessage] = useState('');
  const feedbackTimer = useRef<number | undefined>(undefined);
  const mountedRef = useRef(true);
  const storageStatusRef = useRef<StorageStatus>('checking');
  const queue = useRef(Promise.resolve());
  // Opening/recovery reads can overlap a physical tap. If their snapshot was
  // taken before that write, it must not roll the fresh count and tap list back
  // off the screen when the read eventually resolves.
  const tapWriteVersion = useRef(0);
  const modeRef = useRef(mode);
  const sessionIdRef = useRef(sessionId);
  const personsRef = useRef<Person[]>([]);
  const tapsRef = useRef<TapRecord[]>([]);
  const sessionSummaryRef = useRef<SessionSummary | null>(null);
  const candidateRef = useRef<EnrollmentCandidate | null>(null);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  useEffect(() => {
    personsRef.current = persons;
  }, [persons]);

  useEffect(() => {
    tapsRef.current = taps;
  }, [taps]);

  useEffect(() => {
    candidateRef.current = enrollmentCandidate;
  }, [enrollmentCandidate]);

  useEffect(() => {
    sessionSummaryRef.current = sessionSummary;
  }, [sessionSummary]);

  /** Keeps the ref other callbacks read in step with the rendered state. */
  const applyStorageStatus = useCallback((next: StorageStatus) => {
    storageStatusRef.current = next;
    setStorageStatus(next);
  }, []);

  /**
   * Reads this session back out of IndexedDB. Used for the opening load and
   * again by `retryStorage`, so the recovery path cannot drift from the one
   * that runs at boot.
   *
   * A failure deliberately leaves `persons`, `taps` and any open enrollment
   * candidate exactly as they were: a store that has gone away momentarily
   * must not also wipe what the operator is looking at.
   */
  const loadSession = useCallback(async () => {
    applyStorageStatus('checking');
    const currentSessionId = sessionIdRef.current;
    const readTapWriteVersion = tapWriteVersion.current;

    try {
      const [savedPersons, savedTaps, savedAttendanceCount] = await Promise.all(
        [
          listPersons(),
          listSessionTapRecords(currentSessionId),
          countSessionAttendance(currentSessionId),
        ],
      );
      if (!mountedRef.current) return;
      // The roster does not belong to a session, so it is applied either way.
      personsRef.current = savedPersons;
      setPersons(savedPersons);
      // The taps and the count do belong to one, and this read may be out of
      // date in two different ways that need opposite answers.
      if (sessionIdRef.current !== currentSessionId) {
        // The session rotated while the read was in flight, so this snapshot
        // describes a meeting that is no longer on screen. Applying it would
        // file the previous meeting's taps under the new session's heading.
        // The rotation already left the view as it wants it.
      } else if (tapWriteVersion.current === readTapWriteVersion) {
        tapsRef.current = savedTaps;
        setTaps(savedTaps);
        setAttendanceCount(savedAttendanceCount);
      } else {
        // A tap committed while the read was in flight. Dropping the snapshot
        // here loses this session's existing taps for the rest of the shift:
        // at boot `tapsRef` is empty, so the summary and "Export this session"
        // would cover only what arrived after the app was opened, while the
        // headline count — set by the tap itself — still looked right.
        //
        // So merge instead. The snapshot is the only copy of what the store
        // held before the tap; anything committed since is already in
        // `tapsRef` and is re-appended by id. The count came from that write
        // and is newer than the read's, so it is left alone.
        const readIds = new Set(savedTaps.map((tap) => tap.id));
        const merged = [
          ...savedTaps,
          ...tapsRef.current.filter((tap) => !readIds.has(tap.id)),
        ];
        tapsRef.current = merged;
        setTaps(merged);
      }
      // The read landed either way, which is what the status reports.
      applyStorageStatus('ready');
    } catch {
      if (!mountedRef.current) return;
      applyStorageStatus('unavailable');
    } finally {
      // Only ever falls; a retry reports itself through the status instead, so
      // the attendance count does not drop back to a skeleton mid-shift.
      if (mountedRef.current) setIsLoading(false);
    }
  }, [applyStorageStatus]);

  /**
   * `loadSession` through the same queue that serialises scans.
   *
   * The read and the write it may overtake both land on `attendanceCount` and
   * `tapsRef`, and the read is the older of the two: a tap committing between
   * `countSessionAttendance` and the `setAttendanceCount` that follows it would
   * be rolled straight back off the screen. Queueing makes the recovery read
   * wait its turn, so what it reports is never staler than what is displayed.
   */
  const refreshFromStore = useCallback(() => {
    const next = queue.current.then(() => loadSession());
    queue.current = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }, [loadSession]);

  useEffect(() => {
    mountedRef.current = true;
    void loadSession();

    return () => {
      mountedRef.current = false;
      if (feedbackTimer.current) window.clearTimeout(feedbackTimer.current);
    };
  }, [loadSession]);

  const announce = useCallback((nextFeedback: ScanFeedback, duration = 3200) => {
    setFeedback(nextFeedback);
    if (feedbackTimer.current) window.clearTimeout(feedbackTimer.current);
    if (nextFeedback !== 'ready') {
      feedbackTimer.current = window.setTimeout(
        () => setFeedback('ready'),
        duration,
      );
    }
  }, []);

  const processScan = useCallback(
    async (input: string) => {
      const uid = normalizeUid(input);
      if (!isValidUid(uid)) {
        announce('invalid');
        return;
      }

      if (sessionSummaryRef.current) return;
      if (modeRef.current === 'enroll') {
        if (candidateRef.current) return;
        // Opening the form would invite details that have nowhere to land, so
        // the card is acknowledged and the operator is told why instead.
        if (
          storageStatusRef.current === 'unavailable' ||
          storageStatusRef.current === 'checking'
        ) {
          setLastUid(uid);
          setLastScannedAt(new Date().toISOString());
          announce('storage-unavailable');
          return;
        }

        let existing: Person | undefined;
        try {
          existing = await findPersonByUid(uid);
        } catch {
          // A failed read means the store itself is gone, not one bad write.
          applyStorageStatus('unavailable');
          announce('storage-unavailable');
          return;
        }
        setLastUid(uid);
        setLastScannedAt(new Date().toISOString());
        if (existing) {
          setLastPerson(existing);
          setEnrollmentCandidate({ uid, person: existing });
          announce('editing');
          return;
        }
        setLastPerson(undefined);
        setEnrollmentCandidate({ uid });
        announce('enrollment');
        return;
      }

      try {
        // The store is asked who the card belongs to, not the in-memory
        // roster: `personsRef` is a snapshot that is still empty while the
        // opening read is in flight, so a card tapped during boot was written
        // as an unknown card, uncounted, and the volunteer was told to enroll
        // a student who is already enrolled. One lookup on the `&cardUid`
        // index is cheap enough to run on every tap and cannot disagree with
        // the store the tap is about to land in.
        let person: Person | undefined;
        try {
          person = await findPersonByUid(uid);
        } catch {
          // A read that fails must not cost the tap: fall back to whatever the
          // last successful read left behind and still write the row.
          person = personsRef.current.find((item) => item.cardUid === uid);
        }
        const scannedAt = new Date().toISOString();
        // Captured before the await so a rotation mid-write cannot land this
        // tap under the session that replaced the one it was scanned in.
        const tapSessionId = sessionIdRef.current;
        tapWriteVersion.current += 1;
        const committed = await recordSessionTap({
          sessionId: tapSessionId,
          uid,
          scannedAt,
          personId: person?.id ?? null,
        });

        // A card can be read at the moment the volunteer starts a new session,
        // and the write outlives the rotation. The tap is safely stored under
        // the meeting it belongs to, but the screen now belongs to the next
        // one: adding it here would show a tap the new session does not have
        // and a count taken from the old session, so the number on screen
        // would stop matching `countSessionAttendance` for the session being
        // run. The rotation deliberately cleared the view; a straggler must
        // not repopulate it, and announcing a check-in against a count of zero
        // would only puzzle whoever is watching.
        if (sessionIdRef.current !== tapSessionId) {
          if (import.meta.env.DEV) {
            // Masked even here. A card UID is hardware identity that is still
            // in a student's wallet, and the devtools console on a kiosk
            // tablet is as readable as the screen -- and is captured by every
            // driver log and screenshot.
            console.debug('[attendance scan] landed in a rotated-away session', {
              card: maskCardUid(uid),
              sessionId: tapSessionId,
            });
          }
          return;
        }

        tapsRef.current = [...tapsRef.current, committed.tap];
        setTaps(tapsRef.current);
        setAttendanceCount(committed.attendanceCount);
        setLastUid(uid);
        setLastPerson(person);
        setLastScannedAt(scannedAt);
        setLastCountedAt(committed.priorCountedAt ?? scannedAt);
        // Only the milder failure clears on a good write. A store that never
        // opened has still never been read, so 'unavailable' keeps its panel
        // and its Retry button and asks for the read instead; the status only
        // goes green once that read actually lands.
        if (storageStatusRef.current === 'save-failed') {
          applyStorageStatus('ready');
        } else if (storageStatusRef.current === 'unavailable') {
          void refreshFromStore();
        }
        const nextFeedback = person
          ? committed.priorCounted
            ? 'duplicate'
            : 'valid'
          : 'unknown';
        announce(nextFeedback);
        if (import.meta.env.DEV) {
          console.debug('[attendance scan]', {
            card: maskCardUid(uid),
            sessionId: sessionIdRef.current,
            priorCounted: committed.priorCounted,
            counted: committed.tap.counted,
            attendanceCount: committed.attendanceCount,
          });
        }
      } catch {
        // A store that never opened stays 'unavailable': this is not the
        // milder "one write missed" case, the retry affordance must stay, and
        // "try again" is advice that cannot work. 'storage-unavailable' says
        // the card was not recorded, which is the part that matters.
        if (storageStatusRef.current === 'unavailable') {
          announce('storage-unavailable');
        } else {
          applyStorageStatus('save-failed');
          announce('storage-error');
        }
      }
    },
    [announce, applyStorageStatus, loadSession],
  );

  const handleScan = useCallback(
    (input: string) => {
      const next = queue.current.then(() => processScan(input));
      queue.current = next.then(
        () => undefined,
        () => undefined,
      );
      return next;
    },
    [processScan],
  );

  const enrollPerson = useCallback(
    async (details: {
      firstName: string;
      lastName: string;
      gradYear: number;
      email: string;
    }) => {
      const candidate = candidateRef.current;
      if (!candidate) return;

      setSaveErrorMessage('');
      setIsSaving(true);
      try {
        const existing = await findPersonByUid(candidate.uid);
        const isTheCandidateBeingEdited =
          existing?.id !== undefined &&
          existing.id === candidate.person?.id;
        if (existing && !isTheCandidateBeingEdited) {
          setLastPerson(existing);
          setEnrollmentCandidate(null);
          announce('existing');
          return;
        }

        const changes = {
          firstName: details.firstName.trim(),
          lastName: details.lastName.trim(),
          gradYear: details.gradYear,
          email: details.email.trim(),
        };
        const person =
          candidate.person?.id !== undefined
            ? await updatePerson(candidate.person.id, changes)
            : await addPerson({
                cardUid: candidate.uid,
                ...changes,
                enrolledAt: new Date().toISOString(),
              });
        personsRef.current = candidate.person
          ? personsRef.current.map((item) =>
              item.id === person.id ? person : item,
            )
          : [...personsRef.current, person];
        setPersons(personsRef.current);
        setLastPerson(person);
        setLastUid(candidate.uid);
        setEnrollmentCandidate(null);
        applyStorageStatus('ready');
        announce(candidate.person ? 'updated' : 'enrolled', 1800);
      } catch (error) {
        // The candidate is deliberately left open in both branches:
        // EnrollmentForm keeps the typed details on screen.
        if (error instanceof DuplicateEmailError) {
          // The address belongs to somebody else. Nothing is wrong with
          // storage, so saying "check browser storage and try again" would
          // send the operator after the wrong problem — and retrying the same
          // address can only fail again. The form's own collision check runs
          // against the roster it was handed, so reaching here means that copy
          // was stale: a second kiosk tab, or a roster read that has not
          // landed yet.
          setSaveErrorMessage(error.message);
          announce('existing');
          return;
        }
        setSaveErrorMessage('');
        if (storageStatusRef.current !== 'unavailable') {
          applyStorageStatus('save-failed');
        }
        announce('storage-error');
      } finally {
        setIsSaving(false);
      }
    },
    [announce, applyStorageStatus],
  );

  const endSession = useCallback(() => {
    const summary = {
      ...calculateMetrics(tapsRef.current),
      // Snapshot the meeting identity with the results. The summary can stay
      // open while the clock advances, so deriving this in the dialog would
      // make an empty session appear to have started when it was reviewed.
      sessionStartedAt:
        tapsRef.current[0]?.scannedAt ?? sessionStartedAt,
      endedAt: new Date().toISOString(),
    };
    sessionSummaryRef.current = summary;
    setSessionSummary(summary);
  }, [sessionStartedAt]);

  /**
   * Closes the summary and nothing else. End Session is one tap away from the
   * reader, and without this the only way out of the summary was to rotate the
   * session id — an accidental press would cost the volunteer the on-screen
   * count. The session, its taps and the count are all untouched.
   */
  const dismissSummary = useCallback(() => {
    sessionSummaryRef.current = null;
    setSessionSummary(null);
  }, []);

  /**
   * Rotates to a fresh session id and resets the on-screen view of "this
   * session". Attendance history is retained: the previous session's taps stay
   * in IndexedDB under their own session id, so a dashboard can report
   * per-session and year-to-date figures later. Nothing here touches
   * IndexedDB — `createNewSessionId` writes only localStorage and swallows its
   * own failures — so `isSaving` is deliberately not raised: that flag exists
   * to report a pending local write ("Saving locally" in the feedback panel,
   * a disabled save button on the enrollment form), and there is none. The
   * function stays async so ScannerScreen, which awaits it before refocusing
   * the reader input, keeps working unchanged.
   */
  const startNewSession = useCallback(async () => {
    const nextSessionId = createNewSessionId();
    const nextSessionStartedAt = getOrCreateSessionStartedAt(nextSessionId);
    sessionIdRef.current = nextSessionId;
    setSessionId(nextSessionId);
    setSessionStartedAt(nextSessionStartedAt);
    tapsRef.current = [];
    setTaps([]);
    setAttendanceCount(0);
    setEnrollmentCandidate(null);
    setSessionSummary(null);
    sessionSummaryRef.current = null;
    candidateRef.current = null;
    setLastUid('');
    setLastPerson(undefined);
    setLastScannedAt('');
    // A failed write belongs to the session that hit it, so that notice goes
    // with it; the next failure will raise it again. A store that cannot be
    // opened at all is not fixed by rotating a session id, so 'unavailable'
    // deliberately survives.
    if (storageStatusRef.current === 'save-failed') {
      applyStorageStatus('ready');
    }
    announce('ready');
  }, [announce, applyStorageStatus]);

  const cancelEnrollment = useCallback(() => {
    candidateRef.current = null;
    setEnrollmentCandidate(null);
    setLastUid('');
    setLastPerson(undefined);
    setLastScannedAt('');
    announce('ready');
  }, [announce]);

  const metrics = useMemo(() => calculateMetrics(taps), [taps]);

  /**
   * The old single boolean, kept so components that only need "is something
   * wrong" — the enrollment form's save banner — stay unchanged. Anything that
   * has to tell the two failures apart reads `storageStatus`.
   */
  const storageError =
    storageStatus === 'unavailable' || storageStatus === 'save-failed';

  return {
    sessionId,
    // A session with taps is identified by its first tap everywhere else in
    // the app. The persisted fallback keeps the confirmation useful before
    // the first tap, including after a page reload.
    sessionStartedAt: taps[0]?.scannedAt ?? sessionStartedAt,
    persons,
    taps,
    feedback,
    lastUid,
    lastPerson,
    lastScannedAt,
    lastCountedAt,
    enrollmentCandidate,
    sessionSummary,
    metrics,
    count: attendanceCount,
    isLoading,
    isSaving,
    storageStatus,
    storageError,
    saveErrorMessage,
    retryStorage: refreshFromStore,
    handleScan,
    enrollPerson,
    cancelEnrollment,
    endSession,
    dismissSummary,
    startNewSession,
  };
}
