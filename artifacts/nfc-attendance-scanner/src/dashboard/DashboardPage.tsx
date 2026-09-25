import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, BarChart3, RotateCcw, Users } from 'lucide-react';
import {
  flattenBodyTree,
  formatBodySubtitle,
  isArchived,
  subtreeBodyIds,
} from '@/data/body-hierarchy';
import {
  ACTIVITY_LOG_CAP,
  BodyHierarchyError,
  BodyVocabError,
  addBodyFieldDef,
  addBodyTypeDef,
  archiveBody,
  createBody,
  createClassWithPeriods,
  deleteBodyFieldDef,
  deleteBodyTypeDef,
  getActiveBody,
  listActivity,
  listBodies,
  listBodyFieldDefs,
  listBodyTypeDefs,
  listPersonsForBodies,
  listTapsForBodies,
  previewAlumniRemoval,
  previewHistoryPurge,
  purgeHistoryBefore,
  recordActivity,
  removeAlumni,
  renameBody,
  renameBodyTypeDef,
  reparentBody,
  restoreBody,
  setActiveBody,
  setAttendanceTarget,
  getAttendanceTarget,
  updateBodyCustomFields,
  updateBodyFieldDef,
  type ActivityEntry,
  type AlumniRemoval,
  type AttendanceBody,
  type BodyFieldDef,
  type BodyTypeDef,
  type ClassWithPeriods,
  type CreateClassWithPeriodsInput,
  type HistoryPurge,
  type Person,
  type TapRecord,
  getSwitchPinRequired,
} from '@/data/attendance-store';
import { setSwitchPinRequired } from '@/data/switch-pin';
import { deriveGrade } from '@/lib/attendance-export';
import type { DateRange } from '@/lib/date-range';
import { exportRangeWorkbook } from '@/lib/range-export';
import {
  computeDashboardMetrics,
  computePeriodBreakdown,
  computeRollupDashboardMetrics,
  schoolYearStart,
  type DashboardMetrics,
} from '@/lib/attendance-metrics';
import {
  formatSessionDate,
  formatSessionDateLabel,
} from '@/lib/session-formatting';
import { RetentionDialog } from '@/ui/RetentionDialog';
import { ExportDialog } from '@/ui/ExportDialog';
import { BodySwitcherDialog } from '@/ui/BodySwitcherDialog';
import type { ClassSetupAttachment } from '@/ui/ClassSetupForm';
import { BodyVocabularyDialog } from '@/ui/BodyVocabularyDialog';
import { Dashboard } from '@/ui/Dashboard';
import { ScansPausedNotice } from '@/ui/ScansPausedNotice';
import { ExportNotice, type ExportResult } from '@/ui/ExportNotice';
import { ExportCancelledError } from '@/platform/desktop-bridge';
import { PinDialog } from '@/lock/PinDialog';
import { hasOperatorPin } from '@/data/operator-pin';
import { useOperatorLock } from '@/lock/OperatorLockProvider';

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function bodyFailure(error: unknown, fallback: string): string {
  return error instanceof BodyHierarchyError || error instanceof BodyVocabError
    ? error.message
    : fallback;
}

function metricsFromBundle(
  scope: 'body' | 'subtree',
  bundle: {
    bodyTaps: TapRecord[];
    bodyPersons: Person[];
    subtreeTaps: TapRecord[];
    subtreePersons: Person[];
    target: number;
  },
  now: string,
): DashboardMetrics {
  if (scope === 'subtree') {
    return computeRollupDashboardMetrics(
      bundle.subtreeTaps,
      bundle.subtreePersons,
      now,
      bundle.target,
    );
  }
  return computeDashboardMetrics(bundle.bodyTaps, bundle.bodyPersons, now, bundle.target);
}

/** Shown when turning the PIN requirement back on could not be saved. */
const PIN_ENABLE_FAILED =
  "Couldn't turn the teacher PIN back on: this device isn't letting the app save its settings. The requirement is still off.";

/**
 * The container behind `Dashboard`: it reads the whole tap history and the
 * roster together and folds them into metrics. Both reads happen in one pass so
 * a tap recorded between them cannot be counted against a roster that predates
 * it.
 */
export function DashboardPage() {
  // The single source of truth for the PIN gate itself — DashboardPage is
  // always mounted inside the app's one `OperatorLockProvider` (via
  // `LockedRoute` in `AppRouter`), so flipping the switch here has to go
  // through `setPinRequired`/`unlock` from the same context that
  // `LockedRoute`, the idle relock and `RelockOnScanner` all read; writing
  // straight to the store would persist the setting but leave this device's
  // live gate one reload behind.
  const { pinRequired, setPinRequired, unlock } = useOperatorLock();
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  // The rows behind the metrics, kept so the export writes the same history
  // the numbers were computed from rather than re-reading a store that may
  // have moved on — or failed — since.
  const [history, setHistory] = useState<{
    taps: TapRecord[];
    persons: Person[];
  } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  // The log is read with the history so the page opens in one pass, and
  // re-read on its own after an export so the new row shows without the
  // numbers being recomputed for nothing.
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  // The change-PIN dialog and the one-line notice its success leaves behind.
  const [changingPin, setChangingPin] = useState(false);
  const [pinNotice, setPinNotice] = useState<string | null>(null);
  // A failed switch change, shown apart from the success notice.
  const [pinError, setPinError] = useState<string | null>(null);
  // The "Require teacher PIN" switch (Design 05): whether a PIN exists to
  // gate behind (`pinRequired` itself lives on the lock context above), and
  // the two dialogs a flip can open — verifying the current PIN to turn
  // off, or setting one for the first time to turn on from a device that
  // has never had one.
  const [hasPin, setHasPin] = useState(false);
  const [disablingPinRequired, setDisablingPinRequired] = useState(false);
  const [enablingPinSetup, setEnablingPinSetup] = useState(false);
  // "Set PIN" from the missing-PIN alert: the existing set-PIN form, opened
  // without touching the requirement (which stayed on throughout).
  const [settingMissingPin, setSettingMissingPin] = useState(false);
  // "Require PIN to switch periods" (Design 09 §3), a per-device setting
  // under the same protection-toggle rule as the switch above: on is
  // immediate, off asks for the current PIN.
  const [switchPinRequired, setSwitchPinRequiredState] = useState(false);
  const [disablingSwitchPin, setDisablingSwitchPin] = useState(false);
  // The two retention previews, read with the page so the buttons can say
  // what they would do before anyone presses them; the action being
  // confirmed, whether it is running, and what it said when it finished.
  const [boundary, setBoundary] = useState(() =>
    schoolYearStart(new Date().toISOString()),
  );
  const [historyPreview, setHistoryPreview] = useState<HistoryPurge | null>(null);
  const [alumniPreview, setAlumniPreview] = useState<AlumniRemoval | null>(null);
  const [retentionAction, setRetentionAction] = useState<
    'history' | 'alumni' | null
  >(null);
  const [retentionWorking, setRetentionWorking] = useState(false);
  const [retentionFailed, setRetentionFailed] = useState(false);
  const [retentionNotice, setRetentionNotice] = useState<string | null>(null);
  // The body this device is attached to (D-T2), and the switcher that lets a
  // teacher create another body or point the device at one that already
  // exists. Neither previous nor new body's data is ever touched by this.
  const [activeBody, setActiveBodyState] = useState<AttendanceBody | null>(null);
  const [switchingBody, setSwitchingBody] = useState(false);
  const [bodies, setBodies] = useState<AttendanceBody[]>([]);
  const [bodyWorking, setBodyWorking] = useState(false);
  const [bodyError, setBodyError] = useState<string | null>(null);
  // A class just created from the switcher (Design 09 §1): while set, the
  // switcher shows the "Add students to each period" step for it.
  const [classSetup, setClassSetup] = useState<
    (ClassWithPeriods & { attachment: ClassSetupAttachment }) | null
  >(null);
  // The admin's saved type-label vocabulary and field defs (08b). Loaded
  // with everything else and refreshed after any write that could change
  // them, including a rename cascade that moves bodies onto a new label.
  const [typeDefs, setTypeDefs] = useState<BodyTypeDef[]>([]);
  const [fieldDefs, setFieldDefs] = useState<BodyFieldDef[]>([]);
  const [managingVocab, setManagingVocab] = useState(false);
  const [vocabWorking, setVocabWorking] = useState(false);
  const [vocabError, setVocabError] = useState<string | null>(null);
  // "This body" vs "this body + descendants". Export and retention stay on
  // the active body either way; only the figures above the body card move.
  const [metricsScope, setMetricsScope] = useState<'body' | 'subtree'>('body');
  const [metricsBundle, setMetricsBundle] = useState<{
    bodyTaps: TapRecord[];
    bodyPersons: Person[];
    subtreeTaps: TapRecord[];
    subtreePersons: Person[];
    target: number;
  } | null>(null);

  // The class view's per-period table (Design 09 §2), from the same subtree
  // rows the roll-up figures were computed from. Only built for the subtree
  // scope; the column header follows the children's type label.
  const periodBreakdown = useMemo(() => {
    if (metricsScope !== 'subtree' || !metricsBundle || !metrics || activeBody?.id === undefined) {
      return undefined;
    }
    const parentId = activeBody.id;
    const children = bodies.filter((body) => body.parentId === parentId);
    if (children.length === 0) return undefined;
    const live = children.filter((body) => !isArchived(body));
    const labels = new Set((live.length > 0 ? live : children).map((body) => body.typeLabel.trim().toLowerCase()));
    const childLabel = labels.size === 1 ? [...labels][0] : 'child';
    return {
      childLabel,
      rows: computePeriodBreakdown(
        parentId,
        bodies,
        metricsBundle.subtreeTaps,
        metricsBundle.subtreePersons,
        metrics.computedAt,
      ),
    };
  }, [metricsScope, metricsBundle, metrics, activeBody, bodies]);

  // `scope` overrides the state for a caller that just changed it: the
  // `load` it holds was made before that change landed.
  const load = useCallback(async (scope: 'body' | 'subtree' = metricsScope) => {
    setIsLoading(true);
    setLoadFailed(false);
    try {
      // The school-year boundary and every grade label hang off `now`, so it is
      // read once here and shared by the metrics and both retention previews.
      const now = new Date().toISOString();
      const start = schoolYearStart(now);
      const [
        body,
        allBodies,
        target,
        recent,
        stale,
        graduates,
        savedTypes,
        savedFields,
        pinExists,
        switchPinOn,
      ] = await Promise.all([
        getActiveBody(),
        listBodies(),
        getAttendanceTarget(),
        listActivity(),
        previewHistoryPurge((scannedAt) => formatSessionDate(scannedAt) < start),
        previewAlumniRemoval((person) => deriveGrade(person.gradYear, now) === 'Alumni'),
        listBodyTypeDefs(),
        listBodyFieldDefs(),
        hasOperatorPin(),
        getSwitchPinRequired(),
      ]);
      const ids =
        body.id === undefined ? [] : subtreeBodyIds(body.id, allBodies);
      const [subtreeTaps, subtreePersons] = await Promise.all([
        listTapsForBodies(ids),
        listPersonsForBodies(ids),
      ]);
      const bodyTaps = subtreeTaps.filter((tap) => tap.bodyId === body.id);
      const bodyPersons = subtreePersons.filter((person) => person.bodyId === body.id);
      const bundle = { bodyTaps, bodyPersons, subtreeTaps, subtreePersons, target };
      setMetricsBundle(bundle);
      setMetrics(metricsFromBundle(scope, bundle, now));
      // Export writes the active body only. The subtree workbook is Design 09 step 6.
      setHistory({ taps: bodyTaps, persons: bodyPersons });
      setActivity(recent);
      setBoundary(start);
      setHistoryPreview(stale);
      setAlumniPreview(graduates);
      setActiveBodyState(body);
      setBodies(allBodies);
      setTypeDefs(savedTypes);
      setFieldDefs(savedFields);
      setHasPin(pinExists);
      setSwitchPinRequiredState(switchPinOn);
    } catch {
      setLoadFailed(true);
    } finally {
      setIsLoading(false);
    }
  }, [metricsScope]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Every tap on the device, not just the session on the scanner screen: this
   * is the only route by which a rotated-away session — or a tap the v3
   * upgrade stamped `legacy` — reaches the workbook that is the record.
   */
  const [exportResult, setExportResult] = useState<ExportResult>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportWorking, setExportWorking] = useState(false);

  /**
   * Stores a new target and recomputes against it. Only the percentage moves;
   * the attendance behind it is untouched, which is why this re-derives from
   * the history already in hand rather than re-reading the store.
   */
  const saveTarget = useCallback(
    async (target: number) => {
      try {
        await setAttendanceTarget(target);
      } catch {
        return false;
      }
      if (metricsBundle) {
        const next = { ...metricsBundle, target };
        setMetricsBundle(next);
        setMetrics(metricsFromBundle(metricsScope, next, new Date().toISOString()));
      }
      return true;
    },
    [metricsBundle, metricsScope],
  );

  const changeMetricsScope = useCallback(
    (scope: 'body' | 'subtree') => {
      setMetricsScope(scope);
      if (!metricsBundle) return;
      setMetrics(metricsFromBundle(scope, metricsBundle, new Date().toISOString()));
    },
    [metricsBundle],
  );

  /**
   * A row for the switch is a courtesy entry, exactly like the PIN-set and
   * PIN-changed rows `PinDialog` writes: nothing downstream depends on it,
   * and the setting itself is already persisted by the time this runs, so a
   * write that fails here is allowed to pass in silence rather than make a
   * completed toggle look like it failed.
   */
  const logPinRequiredChange = useCallback(
    async (kind: 'pin-disabled' | 'pin-enabled') => {
      try {
        await recordActivity({ at: new Date().toISOString(), kind });
        setActivity(await listActivity());
      } catch {
        // See above.
      }
    },
    [],
  );

  /**
   * Turning it back on needs no PIN — the hash was never touched while off.
   * `unlock()` matters here: a teacher who reached this screen while the
   * gate was off never went through the PIN dialog, so the in-memory
   * unlock the gate itself checks is still false. Without this, re-arming
   * the gate mid-visit would swap the dashboard for a PIN prompt under
   * their hands.
   */
  const enablePinRequiredDirect = useCallback(async () => {
    // Unlock first: if the gate was relocked while off, re-arming it before
    // this would briefly swap the dashboard for a PIN prompt.
    unlock();
    let verdict;
    try {
      verdict = await setPinRequired(true);
    } catch {
      setPinError(PIN_ENABLE_FAILED);
      return;
    }
    if (verdict.status !== 'ok') {
      // No PIN after all (e.g. cleared elsewhere): set one first.
      setEnablingPinSetup(true);
      return;
    }
    setPinNotice('Teacher PIN turned on.');
    await logPinRequiredChange('pin-enabled');
  }, [setPinRequired, unlock, logPinRequiredChange]);

  /**
   * The switch was flipped. Off always asks for the current PIN first — see
   * `confirmDisablePinRequired`, which only runs once `PinDialog` has
   * verified it. On is immediate unless there has never been a PIN to
   * require, in which case it opens the same set-PIN form the locked-route
   * gate itself falls back to, rather than silently enabling a requirement
   * with nothing behind it.
   */
  const requestPinRequiredChange = useCallback(
    (next: boolean) => {
      setPinNotice(null);
      setPinError(null);
      if (!next) {
        setDisablingPinRequired(true);
        return;
      }
      if (hasPin) {
        void enablePinRequiredDirect();
      } else {
        setEnablingPinSetup(true);
      }
    },
    [hasPin, enablePinRequiredDirect],
  );

  /**
   * Runs only after `setPinRequired(false, pin)` itself verified the PIN and
   * saved the setting (it is the dialog's `verify`), so this just closes up.
   */
  const confirmDisablePinRequired = useCallback(async () => {
    setDisablingPinRequired(false);
    setPinNotice('Teacher PIN turned off.');
    await logPinRequiredChange('pin-disabled');
  }, [logPinRequiredChange]);

  /** The set-PIN form itself already wrote the hash and its own log row. */
  const confirmEnablePinAfterSetup = useCallback(async () => {
    setEnablingPinSetup(false);
    setHasPin(true);
    unlock();
    let verdict;
    try {
      verdict = await setPinRequired(true);
    } catch {
      setPinError(PIN_ENABLE_FAILED);
      return;
    }
    // Logged only on a real change.
    if (verdict.status !== 'ok') {
      setPinError(PIN_ENABLE_FAILED);
      return;
    }
    setPinNotice('Teacher PIN set. Requirement turned on.');
    await logPinRequiredChange('pin-enabled');
  }, [setPinRequired, unlock, logPinRequiredChange]);

  /** The PIN vanished while the turn-off dialog was open: close it and say so. */
  const handlePinMissingOnDisable = useCallback(() => {
    setDisablingPinRequired(false);
    setHasPin(false);
    setPinError(
      'There is no teacher PIN on this device anymore, so the requirement was not turned off. Set a PIN to manage it.',
    );
  }, []);

  /**
   * Same courtesy-row rule as `logPinRequiredChange`: the setting is saved
   * before this runs, so a log that cannot be written stays silent.
   */
  const logSwitchPinChange = useCallback(
    async (kind: 'switch-pin-enabled' | 'switch-pin-disabled') => {
      try {
        await recordActivity({ at: new Date().toISOString(), kind });
        setActivity(await listActivity());
      } catch {
        // See above.
      }
    },
    [],
  );

  /** The change is saved; say so, update the switch and log it. */
  const finishSwitchPinChange = useCallback(
    async (required: boolean) => {
      setSwitchPinRequiredState(required);
      setPinNotice(required ? 'PIN to switch periods turned on.' : 'PIN to switch periods turned off.');
      await logSwitchPinChange(required ? 'switch-pin-enabled' : 'switch-pin-disabled');
    },
    [logSwitchPinChange],
  );

  /**
   * The switch was flipped. On needs no PIN but does need one to exist (the
   * card keeps the switch disabled without one, and `setSwitchPinRequired`
   * refuses it anyway). Off asks for the current PIN through `PinDialog`,
   * whose `verify` is the store call itself, so the rule is enforced there.
   * With no PIN on the device there is nothing to verify: off goes straight
   * through (see `setSwitchPinRequired`).
   */
  const requestSwitchPinChange = useCallback(
    async (next: boolean) => {
      setPinNotice(null);
      setPinError(null);
      if (!next && hasPin) {
        setDisablingSwitchPin(true);
        return;
      }
      let verdict;
      try {
        verdict = await setSwitchPinRequired(next);
      } catch {
        setPinError("Couldn't change the PIN to switch periods: this device isn't letting the app save its settings.");
        return;
      }
      if (verdict.status !== 'ok') {
        setHasPin(false);
        setPinError('Set a teacher PIN first. Switching periods can only ask for a PIN that exists.');
        return;
      }
      await finishSwitchPinChange(next);
    },
    [hasPin, finishSwitchPinChange],
  );

  /** The PIN vanished while the turn-off dialog was open: nothing to verify. */
  const handlePinMissingOnSwitchPin = useCallback(async () => {
    setDisablingSwitchPin(false);
    setHasPin(false);
    try {
      await setSwitchPinRequired(false);
    } catch {
      setPinError("Couldn't change the PIN to switch periods: this device isn't letting the app save its settings.");
      return;
    }
    await finishSwitchPinChange(false);
  }, [finishSwitchPinChange]);

  // A stale switch error should not linger beside whatever the teacher does
  // next: any dialog opening on this page clears it.
  const anyDialogOpen =
    changingPin ||
    disablingPinRequired ||
    enablingPinSetup ||
    disablingSwitchPin ||
    settingMissingPin ||
    retentionAction !== null ||
    switchingBody ||
    managingVocab;
  useEffect(() => {
    if (anyDialogOpen) setPinError(null);
  }, [anyDialogOpen]);

  /**
   * Where the keyboard goes once the missing-PIN "Set PIN" dialog closes.
   * The alert's own button, which opened it, unmounted when the dialog
   * opened, so PinDialog's hand-back finds nothing to return to. Focused
   * from an effect because the switch only renders once `hasPin` is true.
   */
  const [focusAfterSetPin, setFocusAfterSetPin] = useState<
    'button-change-pin' | 'switch-pin-required' | null
  >(null);
  useEffect(() => {
    if (!focusAfterSetPin || settingMissingPin) return;
    const target = document.querySelector<HTMLElement>(`[data-testid="${focusAfterSetPin}"]`);
    // One try only: a target that is not on screen now (the page mid-reload)
    // must not pull focus later, on some unrelated re-render.
    target?.focus();
    setFocusAfterSetPin(null);
  }, [focusAfterSetPin, settingMissingPin, hasPin]);

  const cancelSettingMissingPin = useCallback(() => {
    setSettingMissingPin(false);
    setFocusAfterSetPin('button-change-pin');
  }, []);

  /**
   * The missing-PIN alert's "Set PIN" finished: a PIN exists again. If one
   * had appeared meanwhile (set from another window), the dialog asked for it
   * instead of setting a new one — and the notice says that, not "set".
   */
  const finishSettingMissingPin = useCallback((outcome?: 'set' | 'unlocked') => {
    setSettingMissingPin(false);
    setHasPin(true);
    setPinError(null);
    setPinNotice(
      outcome === 'unlocked' ? 'A teacher PIN is already set on this device.' : 'Teacher PIN set.',
    );
    setFocusAfterSetPin('switch-pin-required');
    // The set form logged its own row; re-read only the log.
    void listActivity()
      .then(setActivity)
      .catch(() => undefined);
  }, []);

  // Root-first names of the active body, for the dialog and the file name.
  const activeBodyPath = useMemo(() => {
    if (!activeBody) return [];
    const row = flattenBodyTree(bodies).find((entry) => entry.body.id === activeBody.id);
    return row?.pathNames ?? [activeBody.name];
  }, [activeBody, bodies]);

  /**
   * The Export dialog's confirm (Design 09 §4). Writes the active body's
   * workbook for `range` from the history the numbers on screen came from.
   * All time carries the whole activity log as its last sheet and is logged
   * as `export-all`, as the one-shot whole-history export was; any other
   * range is logged as `export-range` with its dates. Counts and the file
   * name only — never who is in it.
   */
  const exportRange = useCallback(
    async (range: DateRange) => {
      if (!history) return;
      setExportWorking(true);
      try {
        const allTime = range.preset === 'all-time';
        const delivered = await exportRangeWorkbook({
          taps: history.taps,
          persons: history.persons,
          body: activeBody ?? undefined,
          bodyPath: activeBodyPath,
          range,
          activity: allTime ? await listActivity(ACTIVITY_LOG_CAP) : undefined,
        });
        const { tapCount, sessionCount, ...result } = delivered;
        // The notice goes up as soon as the file is delivered; the log row
        // follows, and if it cannot be written the notice says so rather than
        // calling a finished export a failure.
        setExportOpen(false);
        setExportResult({ ok: true, ...result });
        try {
          await recordActivity({
            at: new Date().toISOString(),
            kind: allTime ? 'export-all' : 'export-range',
            filename: result.filename,
            delivery: result.delivery,
            taps: tapCount,
            sessions: sessionCount,
            ...(allTime || range.from === null || range.to === null
              ? {}
              : { rangeFrom: range.from, rangeTo: range.to }),
          });
          // Only the log is re-read: the numbers on screen are still true.
          setActivity(await listActivity());
        } catch {
          setExportResult((current) =>
            current?.ok ? { ...current, logFailed: true } : current,
          );
        }
      } catch (error) {
        // See ScannerScreen: a cancelled Save dialog must not read as a failure.
        setExportOpen(false);
        setExportResult({
          ok: false,
          cancelled: error instanceof ExportCancelledError,
        });
      } finally {
        setExportWorking(false);
      }
    },
    [history, activeBody, activeBodyPath],
  );

  /**
   * Runs the confirmed retention action, logs it as counts only, and reloads
   * so the numbers, both previews and the activity list all reflect what
   * just went. The log row is written after the deletion; a row that could
   * not be written is said in the notice, never allowed to undo the action.
   */
  const confirmRetention = useCallback(async () => {
    if (!retentionAction) return;
    setRetentionWorking(true);
    setRetentionFailed(false);
    try {
      const now = new Date().toISOString();
      let notice: string;
      let logFailed = false;
      if (retentionAction === 'history') {
        const start = schoolYearStart(now);
        const purged = await purgeHistoryBefore(
          (scannedAt) => formatSessionDate(scannedAt) < start,
        );
        notice = `Deleted ${plural(purged.tapCount, 'tap')} from ${plural(purged.sessionCount, 'session')} before ${formatSessionDateLabel(start)}.`;
        try {
          await recordActivity({
            at: now,
            kind: 'purge-history',
            taps: purged.tapCount,
            sessions: purged.sessionCount,
            before: start,
          });
        } catch {
          logFailed = true;
        }
      } else {
        const removed = await removeAlumni(
          (person) => deriveGrade(person.gradYear, now) === 'Alumni',
        );
        notice = `Removed ${plural(removed.studentCount, 'graduated student')} and ${plural(removed.tapCount, 'tap')}.`;
        try {
          await recordActivity({
            at: now,
            kind: 'remove-alumni',
            students: removed.studentCount,
            taps: removed.tapCount,
          });
        } catch {
          logFailed = true;
        }
      }
      setRetentionAction(null);
      setRetentionNotice(
        notice + (logFailed ? ' The activity log entry could not be written.' : ''),
      );
      await load();
    } catch {
      // The dialog stays open with the failure named: nothing was deleted,
      // and closing it would read as if something had been.
      setRetentionFailed(true);
    } finally {
      setRetentionWorking(false);
    }
  }, [retentionAction, load]);

  const retentionCost =
    retentionAction === 'history'
      ? `This deletes ${plural(historyPreview?.tapCount ?? 0, 'tap')} across ${plural(historyPreview?.sessionCount ?? 0, 'session')} recorded before ${formatSessionDateLabel(boundary)}, including sessions already finished. They will disappear from the dashboard and from any export made after this. The roster is untouched.`
      : `This removes ${plural(alumniPreview?.studentCount ?? 0, 'graduated student')} and ${plural(alumniPreview?.tapCount ?? 0, 'tap')} — every check-in that resolves to them, by name or by card. Their cards can be enrolled again as new students.`;

  const openBodySwitcher = useCallback(async () => {
    setBodyError(null);
    setBodies(await listBodies());
    setSwitchingBody(true);
  }, []);

  /**
   * Reassignment only: switching just moves `activeBodyId`, so the reload
   * that follows shows the newly-active body's own roster and history —
   * never the one just left.
   */
  const selectBody = useCallback(
    async (bodyId: number) => {
      setBodyWorking(true);
      setBodyError(null);
      try {
        await setActiveBody(bodyId);
        setSwitchingBody(false);
        await load();
      } catch (error) {
        setBodyError(bodyFailure(error, "This device couldn't switch bodies. Try again."));
      } finally {
        setBodyWorking(false);
      }
    },
    [load],
  );

  const createAndSwitchBody = useCallback(
    async (input: {
      name: string;
      typeLabel: string;
      parentId: number | null;
      customFields: Record<string, string>;
    }) => {
      setBodyWorking(true);
      setBodyError(null);
      try {
        const created = await createBody(input);
        await setActiveBody(created.id as number);
        setSwitchingBody(false);
        await load();
      } catch (error) {
        setBodyError(bodyFailure(error, "This device couldn't create that body. Try again."));
      } finally {
        setBodyWorking(false);
      }
    },
    [load],
  );

  /**
   * Same attach rule as `createAndSwitchBody`: the device moves to what was
   * just created — here the class itself, which is where the per-period
   * roll-up lives. The figures switch to the class-wide view for the same
   * reason. The switcher stays open on the template step.
   */
  const createClassAndSwitch = useCallback(
    async (input: Required<CreateClassWithPeriodsInput>) => {
      setBodyWorking(true);
      setBodyError(null);
      let created: ClassWithPeriods;
      try {
        created = await createClassWithPeriods(input);
      } catch (error) {
        setBodyError(bodyFailure(error, "This device couldn't create that class. Try again."));
        setBodyWorking(false);
        return;
      }
      // The class exists from here on: a failure to attach must not read as
      // a failed create (a retry would make a second class). The template
      // step says which body the device is actually on, so it is only shown
      // once that is known.
      try {
        await setActiveBody(created.parent.id as number);
      } catch {
        const current = await getActiveBody().catch(() => null);
        setClassSetup({
          ...created,
          attachment: { attached: false, currentBodyName: current?.name ?? null },
        });
        await load();
        setBodyWorking(false);
        return;
      }
      setClassSetup({ ...created, attachment: { attached: true } });
      setMetricsScope('subtree');
      await load('subtree');
      setBodyWorking(false);
    },
    [load],
  );

  const closeBodySwitcher = useCallback(() => {
    setSwitchingBody(false);
    setClassSetup(null);
  }, []);

  const refreshBodies = useCallback(async () => {
    setBodies(await listBodies());
    await load();
  }, [load]);

  const saveBodyCustomFields = useCallback(
    async (input: { bodyId: number; customFields: Record<string, string> }) => {
      setBodyWorking(true);
      setBodyError(null);
      try {
        await updateBodyCustomFields(input.bodyId, input.customFields);
        await refreshBodies();
      } catch (error) {
        setBodyError(bodyFailure(error, "This device couldn't save those fields. Try again."));
      } finally {
        setBodyWorking(false);
      }
    },
    [refreshBodies],
  );

  const renameSelectedBody = useCallback(
    async (input: {
      bodyId: number;
      name: string;
      typeLabel: string;
      customFields?: Record<string, string>;
    }) => {
      setBodyWorking(true);
      setBodyError(null);
      try {
        await renameBody(input.bodyId, input);
        await refreshBodies();
      } catch (error) {
        setBodyError(bodyFailure(error, "This device couldn't rename that body. Try again."));
      } finally {
        setBodyWorking(false);
      }
    },
    [refreshBodies],
  );

  const moveSelectedBody = useCallback(
    async (input: { bodyId: number; parentId: number | null }) => {
      setBodyWorking(true);
      setBodyError(null);
      try {
        await reparentBody(input.bodyId, input.parentId);
        await refreshBodies();
      } catch (error) {
        setBodyError(bodyFailure(error, "This device couldn't move that body. Try again."));
      } finally {
        setBodyWorking(false);
      }
    },
    [refreshBodies],
  );

  const archiveSelectedBody = useCallback(
    async (bodyId: number) => {
      setBodyWorking(true);
      setBodyError(null);
      try {
        await archiveBody(bodyId);
        await refreshBodies();
      } catch (error) {
        setBodyError(bodyFailure(error, "This device couldn't archive that body. Try again."));
      } finally {
        setBodyWorking(false);
      }
    },
    [refreshBodies],
  );

  const restoreSelectedBody = useCallback(
    async (bodyId: number) => {
      setBodyWorking(true);
      setBodyError(null);
      try {
        await restoreBody(bodyId);
        await refreshBodies();
      } catch (error) {
        setBodyError(bodyFailure(error, "This device couldn't restore that body. Try again."));
      } finally {
        setBodyWorking(false);
      }
    },
    [refreshBodies],
  );

  const openVocabDialog = useCallback(() => {
    setVocabError(null);
    setManagingVocab(true);
  }, []);

  /**
   * Refreshes both vocabulary lists and, for a write that can rewrite a
   * body's own `typeLabel` (a type-def rename cascades — see
   * `renameBodyTypeDef`), the whole page: `activeBodyLabel` reads that field,
   * and a stale one would show a label the rename just replaced.
   */
  const refreshVocab = useCallback(
    async (rewritesBodies = false) => {
      if (rewritesBodies) {
        await load();
        return;
      }
      setTypeDefs(await listBodyTypeDefs());
      setFieldDefs(await listBodyFieldDefs());
    },
    [load],
  );

  const addVocabType = useCallback(
    async (label: string) => {
      setVocabWorking(true);
      setVocabError(null);
      try {
        await addBodyTypeDef(label);
        await refreshVocab();
      } catch (error) {
        setVocabError(bodyFailure(error, "That body type couldn't be saved. Try again."));
      } finally {
        setVocabWorking(false);
      }
    },
    [refreshVocab],
  );

  const renameVocabType = useCallback(
    async (input: { id: number; label: string }) => {
      setVocabWorking(true);
      setVocabError(null);
      try {
        await renameBodyTypeDef(input.id, input.label);
        await refreshVocab(true);
      } catch (error) {
        setVocabError(bodyFailure(error, "That body type couldn't be renamed. Try again."));
      } finally {
        setVocabWorking(false);
      }
    },
    [refreshVocab],
  );

  const deleteVocabType = useCallback(
    async (id: number) => {
      setVocabWorking(true);
      setVocabError(null);
      try {
        await deleteBodyTypeDef(id);
        await refreshVocab();
      } catch (error) {
        setVocabError(bodyFailure(error, "That body type couldn't be removed. Try again."));
      } finally {
        setVocabWorking(false);
      }
    },
    [refreshVocab],
  );

  const addVocabField = useCallback(
    async (input: { label: string; appliesToTypeLabel: string; required: boolean }) => {
      setVocabWorking(true);
      setVocabError(null);
      try {
        await addBodyFieldDef(input);
        await refreshVocab();
      } catch (error) {
        setVocabError(bodyFailure(error, "That field couldn't be saved. Try again."));
      } finally {
        setVocabWorking(false);
      }
    },
    [refreshVocab],
  );

  const updateVocabField = useCallback(
    async (input: {
      id: number;
      label: string;
      appliesToTypeLabel: string;
      required: boolean;
    }) => {
      setVocabWorking(true);
      setVocabError(null);
      try {
        await updateBodyFieldDef(input.id, input);
        // A label change migrates the matching key in every body's
        // `customFields` (see `updateBodyFieldDef`) — reload bodies too, not
        // just the vocabulary lists, or a structure editor already open
        // against the stale `bodies` state could save back over the
        // migrated value under the old key.
        await refreshVocab(true);
      } catch (error) {
        setVocabError(bodyFailure(error, "That field couldn't be saved. Try again."));
      } finally {
        setVocabWorking(false);
      }
    },
    [refreshVocab],
  );

  const deleteVocabField = useCallback(
    async (id: number) => {
      setVocabWorking(true);
      setVocabError(null);
      try {
        await deleteBodyFieldDef(id);
        await refreshVocab();
      } catch (error) {
        setVocabError(bodyFailure(error, "That field couldn't be removed. Try again."));
      } finally {
        setVocabWorking(false);
      }
    },
    [refreshVocab],
  );

  return (
    <main
      className="grain relative min-h-[100dvh] overflow-hidden bg-[hsl(var(--background))]"
      data-testid="dashboard-page"
    >
      <div className="pointer-events-none absolute -left-40 -top-48 size-[34rem] rounded-full bg-[hsl(var(--accent)/.055)] blur-3xl" />
      <div className="pointer-events-none absolute -bottom-56 -right-32 size-[34rem] rounded-full bg-[hsl(var(--primary)/.05)] blur-3xl" />

      <div className="relative mx-auto flex w-full max-w-5xl flex-col gap-5 py-5 sm:py-7">
        <header
          className="station-enter flex flex-wrap items-center justify-between gap-3 px-5 sm:px-8"
          data-testid="header-dashboard"
        >
          <Link
            to="/"
            className="flex items-center gap-2 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--card)/.68)] px-3 py-2 text-[11px] font-bold uppercase tracking-[0.14em] text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--secondary))] hover:text-[hsl(var(--foreground))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
            data-testid="link-scanner"
          >
            <ArrowLeft aria-hidden="true" size={14} />
            Back to scanner
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.19em] text-[hsl(var(--muted-foreground))]">
              <BarChart3 aria-hidden="true" size={14} className="text-[hsl(var(--accent))]" />
              Year to date
            </p>
            {/* The sibling admin page, reachable without a detour through the
                kiosk screen. */}
            <Link
              to="/roster"
              className="flex items-center gap-2 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--card)/.68)] px-3 py-2 text-[11px] font-bold uppercase tracking-[0.14em] text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--secondary))] hover:text-[hsl(var(--foreground))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
              data-testid="link-roster"
            >
              <Users aria-hidden="true" size={14} />
              Students
            </Link>
          </div>
        </header>

        <ScansPausedNotice />

        {/* A refresh that fails keeps the numbers already on screen; they are
            still true, only older than the button implied. */}
        {loadFailed && metrics ? (
          <p
            className="station-enter mx-5 flex items-start gap-2.5 rounded-2xl border border-[hsl(var(--destructive)/.5)] bg-[hsl(var(--destructive)/.09)] px-4 py-3 text-sm text-[hsl(var(--destructive))] sm:mx-8"
            role="alert"
            data-testid="text-dashboard-stale"
          >
            <AlertTriangle aria-hidden="true" className="mt-0.5 shrink-0" size={16} />
            <span>
              Could not re-read this device’s storage. These numbers are from
              the last successful read.
            </span>
          </p>
        ) : null}

        {loadFailed && !metrics ? (
          <section
            className="station-enter mx-5 rounded-[1.7rem] border border-[hsl(var(--destructive)/.5)] bg-[hsl(var(--card)/.88)] p-5 sm:mx-8 sm:p-7"
            role="alert"
            data-testid="text-dashboard-load-error"
          >
            <div className="flex items-start gap-3 text-[hsl(var(--destructive))]">
              <AlertTriangle aria-hidden="true" size={22} strokeWidth={2.2} className="mt-0.5 shrink-0" />
              <div className="min-w-0">
                <h2 className="font-display text-lg font-semibold tracking-[-0.02em] text-[hsl(var(--foreground))]">
                  Could not read this device’s attendance
                </h2>
                <p className="mt-1.5 text-sm leading-5 text-[hsl(var(--muted-foreground))]">
                  Nothing has been deleted — the taps are still on the device,
                  and the exported Excel file is unaffected.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void load()}
              disabled={isLoading}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg border border-[hsl(var(--destructive)/.6)] px-3 py-2 text-xs font-bold uppercase tracking-[0.14em] text-[hsl(var(--destructive))] transition hover:bg-[hsl(var(--destructive)/.12)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] disabled:cursor-not-allowed disabled:opacity-60 sm:w-fit"
              data-testid="button-dashboard-retry"
            >
              <RotateCcw aria-hidden="true" size={14} />
              Retry
            </button>
          </section>
        ) : null}

        {!metrics && !loadFailed ? (
          <p
            className="station-enter mx-5 rounded-[1.7rem] border border-dashed border-[hsl(var(--primary)/.34)] bg-[hsl(var(--card)/.5)] px-5 py-10 text-center text-sm text-[hsl(var(--muted-foreground))] sm:mx-8"
            aria-busy="true"
            data-testid="text-dashboard-loading"
          >
            Adding up this device’s attendance…
          </p>
        ) : null}

        {metrics ? (
          <div className="station-enter" style={{ animationDelay: '80ms' }}>
            <Dashboard
              metrics={metrics}
              isLoading={isLoading}
              onRefresh={() => void load()}
              onExport={
                history
                  ? () => {
                      setExportResult(null);
                      setExportOpen(true);
                    }
                  : undefined
              }
              onSaveTarget={saveTarget}
              activity={activity}
              activeBody={activeBody ?? undefined}
              activeBodyLabel={
                activeBody ? formatBodySubtitle(activeBody, bodies) : undefined
              }
              onChangeBody={() => void openBodySwitcher()}
              onManageVocabulary={openVocabDialog}
              onMetricsScopeChange={changeMetricsScope}
              periodBreakdown={periodBreakdown}
              onChangePin={() => {
                setPinNotice(null);
                setChangingPin(true);
              }}
              pinRequired={pinRequired}
              hasPin={hasPin}
              onTogglePinRequired={requestPinRequiredChange}
              switchPinRequired={switchPinRequired}
              onToggleSwitchPinRequired={(next) => void requestSwitchPinChange(next)}
              retention={{
                schoolYearStart: boundary,
                history: historyPreview,
                alumni: alumniPreview,
                onPurgeHistory: () => {
                  setRetentionNotice(null);
                  setRetentionFailed(false);
                  setRetentionAction('history');
                },
                onRemoveAlumni: () => {
                  setRetentionNotice(null);
                  setRetentionFailed(false);
                  setRetentionAction('alumni');
                },
              }}
            />
            <ExportNotice result={exportResult} />
            {pinNotice ? (
              <p
                className="mt-3 rounded-xl border border-[hsl(var(--accent)/.45)] bg-[hsl(var(--accent)/.08)] px-3 py-2.5 text-xs leading-5 text-[hsl(var(--accent))]"
                role="status"
                data-testid="text-pin-changed"
              >
                {pinNotice}
              </p>
            ) : null}
            {pinError ? (
              <p
                className="mt-3 rounded-xl border border-[hsl(var(--destructive)/.45)] bg-[hsl(var(--destructive)/.08)] px-3 py-2.5 text-xs leading-5 text-[hsl(var(--destructive))]"
                role="alert"
                data-testid="text-pin-required-error"
              >
                {pinError}
                <span className="mt-2 flex flex-wrap gap-2">
                  {!hasPin ? (
                    <button
                      type="button"
                      onClick={() => setSettingMissingPin(true)}
                      className="rounded-lg border border-[hsl(var(--destructive)/.6)] px-2.5 py-1 font-semibold hover:bg-[hsl(var(--destructive)/.12)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
                      data-testid="button-pin-error-set-pin"
                    >
                      Set PIN
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setPinError(null)}
                    className="rounded-lg px-2.5 py-1 font-semibold underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
                    data-testid="button-pin-error-dismiss"
                  >
                    Dismiss
                  </button>
                </span>
              </p>
            ) : null}
            {retentionNotice ? (
              <p
                className="mt-3 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card)/.6)] px-3 py-2.5 text-xs leading-5 text-[hsl(var(--muted-foreground))]"
                role="status"
                data-testid="text-retention-done"
              >
                {retentionNotice}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      {exportOpen && history ? (
        <ExportDialog
          bodyPath={activeBodyPath}
          taps={history.taps}
          persons={history.persons}
          isWorking={exportWorking}
          onExport={(range) => void exportRange(range)}
          onCancel={() => setExportOpen(false)}
        />
      ) : null}

      {retentionAction ? (
        <RetentionDialog
          title={
            retentionAction === 'history'
              ? `Delete attendance before ${formatSessionDateLabel(boundary)}?`
              : 'Remove graduated students?'
          }
          cost={retentionCost}
          failed={retentionFailed}
          isWorking={retentionWorking}
          confirmLabel={
            retentionAction === 'history' ? 'Delete permanently' : 'Remove permanently'
          }
          onConfirm={() => void confirmRetention()}
          onCancel={() => setRetentionAction(null)}
        />
      ) : null}

      {switchingBody ? (
        <BodySwitcherDialog
          bodies={bodies}
          activeBodyId={activeBody?.id}
          isWorking={bodyWorking}
          error={bodyError}
          typeDefs={typeDefs}
          fieldDefs={fieldDefs}
          onSelect={(bodyId) => void selectBody(bodyId)}
          onCreate={(input) => void createAndSwitchBody(input)}
          onCreateClass={(input) => void createClassAndSwitch(input)}
          classSetup={classSetup}
          onRename={(input) => void renameSelectedBody(input)}
          onReparent={(input) => void moveSelectedBody(input)}
          onArchive={(bodyId) => void archiveSelectedBody(bodyId)}
          onRestore={(bodyId) => void restoreSelectedBody(bodyId)}
          onSaveCustomFields={(input) => void saveBodyCustomFields(input)}
          onCancel={closeBodySwitcher}
        />
      ) : null}

      {managingVocab ? (
        <BodyVocabularyDialog
          typeDefs={typeDefs}
          fieldDefs={fieldDefs}
          isWorking={vocabWorking}
          error={vocabError}
          onAddType={(label) => void addVocabType(label)}
          onRenameType={(input) => void renameVocabType(input)}
          onDeleteType={(id) => void deleteVocabType(id)}
          onAddField={(input) => void addVocabField(input)}
          onUpdateField={(input) => void updateVocabField(input)}
          onDeleteField={(id) => void deleteVocabField(id)}
          onCancel={() => setManagingVocab(false)}
        />
      ) : null}

      {changingPin ? (
        <PinDialog
          mode="change"
          onChanged={(outcome) => {
            setChangingPin(false);
            if (outcome === 'set') {
              // There was no PIN to change; one now exists again.
              setHasPin(true);
              setPinError(null);
              setPinNotice('Teacher PIN set.');
            } else {
              setPinNotice('Teacher PIN changed.');
            }
            // The log gained a row; re-read only that. A failed re-read leaves
            // the list one row stale, which the next refresh corrects.
            void listActivity()
              .then(setActivity)
              .catch(() => undefined);
          }}
          onCancel={() => setChangingPin(false)}
        />
      ) : null}

      {disablingPinRequired ? (
        <PinDialog
          mode="verify"
          verify={(pin) => setPinRequired(false, pin)}
          onVerified={() => void confirmDisablePinRequired()}
          onPinMissing={handlePinMissingOnDisable}
          onCancel={() => setDisablingPinRequired(false)}
        />
      ) : null}

      {disablingSwitchPin ? (
        <PinDialog
          mode="verify"
          title="Enter the teacher PIN to turn this off"
          helper="Turning off the PIN to switch periods lets anyone at the scanner change which period taps count for."
          verify={(pin) => setSwitchPinRequired(false, pin)}
          onVerified={() => {
            setDisablingSwitchPin(false);
            void finishSwitchPinChange(false);
          }}
          onPinMissing={() => void handlePinMissingOnSwitchPin()}
          onCancel={() => setDisablingSwitchPin(false)}
        />
      ) : null}

      {enablingPinSetup ? (
        <PinDialog
          mode="gate"
          onUnlocked={() => void confirmEnablePinAfterSetup()}
          onCancel={() => setEnablingPinSetup(false)}
        />
      ) : null}
      {settingMissingPin ? (
        <PinDialog
          mode="gate"
          onUnlocked={finishSettingMissingPin}
          onCancel={cancelSettingMissingPin}
        />
      ) : null}
    </main>
  );
}
