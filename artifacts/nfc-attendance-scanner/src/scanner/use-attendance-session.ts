import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  addPerson,
  clearAttendanceSession,
  countSessionAttendance,
  createNewSessionId,
  findPersonByUid,
  getOrCreateSessionId,
  listPersons,
  listSessionTapRecords,
  recordSessionTap,
  updatePerson,
  type Person,
  type TapRecord,
} from '@/data/attendance-store';
import { isValidUid, normalizeUid } from '@/lib/scan-format';

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
  | 'storage-error';

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
  const [persons, setPersons] = useState<Person[]>([]);
  const [taps, setTaps] = useState<TapRecord[]>([]);
  const [attendanceCount, setAttendanceCount] = useState(0);
  const [feedback, setFeedback] = useState<ScanFeedback>('ready');
  const [lastUid, setLastUid] = useState('');
  const [lastPerson, setLastPerson] = useState<Person | undefined>();
  const [lastScannedAt, setLastScannedAt] = useState('');
  const [enrollmentCandidate, setEnrollmentCandidate] =
    useState<EnrollmentCandidate | null>(null);
  const [sessionSummary, setSessionSummary] = useState<SessionSummary | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const feedbackTimer = useRef<number | undefined>(undefined);
  const queue = useRef(Promise.resolve());
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

  useEffect(() => {
    let mounted = true;
    const currentSessionId = sessionIdRef.current;
    Promise.all([
      listPersons(),
      listSessionTapRecords(currentSessionId),
      countSessionAttendance(currentSessionId),
    ])
      .then(([savedPersons, savedTaps, savedAttendanceCount]) => {
        if (!mounted) return;
        personsRef.current = savedPersons;
        tapsRef.current = savedTaps;
        setPersons(savedPersons);
        setTaps(savedTaps);
        setAttendanceCount(savedAttendanceCount);
      })
      .catch(() => {
        if (mounted) setStorageError(true);
      })
      .finally(() => {
        if (mounted) setIsLoading(false);
      });

    return () => {
      mounted = false;
      if (feedbackTimer.current) window.clearTimeout(feedbackTimer.current);
    };
  }, []);

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
        const existing = await findPersonByUid(uid);
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
        const person = personsRef.current.find((item) => item.cardUid === uid);
        const scannedAt = new Date().toISOString();
        const committed = await recordSessionTap({
          sessionId: sessionIdRef.current,
          uid,
          scannedAt,
          personId: person?.id ?? null,
        });

        tapsRef.current = [...tapsRef.current, committed.tap];
        setTaps(tapsRef.current);
        setAttendanceCount(committed.attendanceCount);
        setLastUid(uid);
        setLastPerson(person);
        setLastScannedAt(scannedAt);
        setStorageError(false);
        const nextFeedback = person
          ? committed.priorCounted
            ? 'duplicate'
            : 'valid'
          : 'unknown';
        announce(nextFeedback);
        if (import.meta.env.DEV) {
          console.debug('[attendance scan]', {
            uid,
            sessionId: sessionIdRef.current,
            priorCounted: committed.priorCounted,
            counted: committed.tap.counted,
            attendanceCount: committed.attendanceCount,
          });
        }
      } catch {
        setStorageError(true);
        announce('storage-error');
      }
    },
    [announce],
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
        setStorageError(false);
        announce(candidate.person ? 'updated' : 'enrolled', 1800);
      } catch {
        setStorageError(true);
        announce('storage-error');
      } finally {
        setIsSaving(false);
      }
    },
    [announce],
  );

  const endSession = useCallback(() => {
    const summary = {
      ...calculateMetrics(tapsRef.current),
      endedAt: new Date().toISOString(),
    };
    sessionSummaryRef.current = summary;
    setSessionSummary(summary);
  }, []);

  const startNewSession = useCallback(async () => {
    setIsSaving(true);
    try {
      await clearAttendanceSession();
      const nextSessionId = createNewSessionId();
      sessionIdRef.current = nextSessionId;
      setSessionId(nextSessionId);
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
      setStorageError(false);
      announce('ready');
    } catch {
      setStorageError(true);
    } finally {
      setIsSaving(false);
    }
  }, [announce]);

  const cancelEnrollment = useCallback(() => {
    candidateRef.current = null;
    setEnrollmentCandidate(null);
    setLastUid('');
    setLastPerson(undefined);
    setLastScannedAt('');
    announce('ready');
  }, [announce]);

  const metrics = useMemo(() => calculateMetrics(taps), [taps]);

  return {
    persons,
    taps,
    feedback,
    lastUid,
    lastPerson,
    lastScannedAt,
    enrollmentCandidate,
    sessionSummary,
    metrics,
    count: attendanceCount,
    isLoading,
    isSaving,
    storageError,
    handleScan,
    enrollPerson,
    cancelEnrollment,
    endSession,
    startNewSession,
  };
}