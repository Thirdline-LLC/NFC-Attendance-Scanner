import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, BarChart3, RotateCcw, Users } from 'lucide-react';
import { formatBodySubtitle, subtreeBodyIds } from '@/data/body-hierarchy';
import {
  ACTIVITY_LOG_CAP,
  BodyHierarchyError,
  BodyVocabError,
  addBodyFieldDef,
  addBodyTypeDef,
  archiveBody,
  createBody,
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
  type HistoryPurge,
  type Person,
  type TapRecord,
} from '@/data/attendance-store';
import { deriveGrade, exportAttendanceWorkbook } from '@/lib/attendance-export';
import {
  computeDashboardMetrics,
  computeRollupDashboardMetrics,
  schoolYearStart,
  type DashboardMetrics,
} from '@/lib/attendance-metrics';
import {
  formatSessionDate,
  formatSessionDateLabel,
} from '@/lib/session-formatting';
import { RetentionDialog } from '@/ui/RetentionDialog';
import { BodySwitcherDialog } from '@/ui/BodySwitcherDialog';
import { BodyVocabularyDialog } from '@/ui/BodyVocabularyDialog';
import { Dashboard } from '@/ui/Dashboard';
import { ScansPausedNotice } from '@/ui/ScansPausedNotice';
import { ExportNotice, type ExportResult } from '@/ui/ExportNotice';
import { ExportCancelledError } from '@/platform/desktop-bridge';
import { PinDialog } from '@/lock/PinDialog';

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

/**
 * The container behind `Dashboard`: it reads the whole tap history and the
 * roster together and folds them into metrics. Both reads happen in one pass so
 * a tap recorded between them cannot be counted against a roster that predates
 * it.
 */
export function DashboardPage() {
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

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadFailed(false);
    try {
      // The school-year boundary and every grade label hang off `now`, so it is
      // read once here and shared by the metrics and both retention previews.
      const now = new Date().toISOString();
      const start = schoolYearStart(now);
      const [body, allBodies, target, recent, stale, graduates, savedTypes, savedFields] =
        await Promise.all([
          getActiveBody(),
          listBodies(),
          getAttendanceTarget(),
          listActivity(),
          previewHistoryPurge((scannedAt) => formatSessionDate(scannedAt) < start),
          previewAlumniRemoval((person) => deriveGrade(person.gradYear, now) === 'Alumni'),
          listBodyTypeDefs(),
          listBodyFieldDefs(),
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
      setMetrics(metricsFromBundle(metricsScope, bundle, now));
      // Export writes the active body only. Subtree workbook export is 08c.
      setHistory({ taps: bodyTaps, persons: bodyPersons });
      setActivity(recent);
      setBoundary(start);
      setHistoryPreview(stale);
      setAlumniPreview(graduates);
      setActiveBodyState(body);
      setBodies(allBodies);
      setTypeDefs(savedTypes);
      setFieldDefs(savedFields);
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

  const exportAll = useCallback(async () => {
    if (!history) return;
    try {
      // The whole log rides along as the second sheet: this file is the record
      // a school keeps, and the log is what says where earlier copies went.
      const delivered = await exportAttendanceWorkbook(
        history.taps,
        history.persons,
        await listActivity(ACTIVITY_LOG_CAP),
        activeBody ?? undefined,
      );
      // The notice goes up as soon as the file is delivered; the log row
      // follows, and if it cannot be written the notice says so rather than
      // calling a finished export a failure.
      setExportResult({ ok: true, ...delivered });
      try {
        await recordActivity({
          at: new Date().toISOString(),
          kind: 'export-all',
          filename: delivered.filename,
          delivery: delivered.delivery,
          taps: history.taps.length,
          sessions: new Set(history.taps.map((tap) => tap.sessionId)).size,
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
      setExportResult({
        ok: false,
        cancelled: error instanceof ExportCancelledError,
      });
    }
  }, [history, activeBody]);

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
              onExportAll={history ? () => void exportAll() : undefined}
              onSaveTarget={saveTarget}
              activity={activity}
              activeBody={activeBody ?? undefined}
              activeBodyLabel={
                activeBody ? formatBodySubtitle(activeBody, bodies) : undefined
              }
              onChangeBody={() => void openBodySwitcher()}
              onManageVocabulary={openVocabDialog}
              onMetricsScopeChange={changeMetricsScope}
              onChangePin={() => {
                setPinNotice(null);
                setChangingPin(true);
              }}
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
          onRename={(input) => void renameSelectedBody(input)}
          onReparent={(input) => void moveSelectedBody(input)}
          onArchive={(bodyId) => void archiveSelectedBody(bodyId)}
          onRestore={(bodyId) => void restoreSelectedBody(bodyId)}
          onSaveCustomFields={(input) => void saveBodyCustomFields(input)}
          onCancel={() => setSwitchingBody(false)}
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
          onChanged={() => {
            setChangingPin(false);
            setPinNotice('Teacher PIN changed.');
            // The log gained a row; re-read only that. A failed re-read leaves
            // the list one row stale, which the next refresh corrects.
            void listActivity()
              .then(setActivity)
              .catch(() => undefined);
          }}
          onCancel={() => setChangingPin(false)}
        />
      ) : null}
    </main>
  );
}
