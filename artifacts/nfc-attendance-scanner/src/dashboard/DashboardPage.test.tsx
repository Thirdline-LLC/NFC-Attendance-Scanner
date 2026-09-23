import Dexie from 'dexie';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as attendanceStore from '@/data/attendance-store';
import {
  addPerson,
  createBody,
  getActiveBody,
  recordActivity,
  recordSessionTap,
  type BoundPerson,
} from '@/data/attendance-store';
import { setOperatorPin, verifyOperatorPin } from '@/data/operator-pin';
import * as attendanceExport from '@/lib/attendance-export';
import { currentSeniorGradYear } from '@/lib/attendance-export';
import { schoolYearStart } from '@/lib/attendance-metrics';
import { DashboardPage } from './DashboardPage';

const DATABASE_NAME = 'attendance-scanner-local';
const UNKNOWN_UID = '04CAFEBABE1122';

/**
 * Seeded relative to the clock the page reads, so the taps always land inside
 * the school year in session — a fixed date would fall out of it every August.
 */
const startedAt = Date.now();
function secondsAgo(seconds: number): string {
  return new Date(startedAt - seconds * 1000).toISOString();
}

function renderPage() {
  return render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>,
  );
}

/**
 * Two sessions, four taps: one student at both meetings, one at the first
 * only, and one card nobody has enrolled.
 */
async function seedTwoSessions(): Promise<{ jane: BoundPerson; ada: BoundPerson }> {
  const seniorYear = currentSeniorGradYear(new Date().toISOString());
  const jane = await addPerson({
    cardUid: '04A1B2C3D4E5F6',
    firstName: 'Jane',
    lastName: 'Smith',
    gradYear: seniorYear,
    email: 'jsmith@stjohnschs.org',
    enrolledAt: secondsAgo(90),
  });
  const ada = await addPerson({
    cardUid: '04FFEEDDCCBB99',
    firstName: 'Ada',
    lastName: 'Lovelace',
    gradYear: seniorYear,
    email: 'alovelace@stjohnschs.org',
    enrolledAt: secondsAgo(89),
  });

  await recordSessionTap({
    sessionId: 'session-one',
    uid: jane.cardUid,
    scannedAt: secondsAgo(60),
    personId: jane.id as number,
  });
  await recordSessionTap({
    sessionId: 'session-one',
    uid: ada.cardUid,
    scannedAt: secondsAgo(55),
    personId: ada.id as number,
  });
  await recordSessionTap({
    sessionId: 'session-two',
    uid: jane.cardUid,
    scannedAt: secondsAgo(40),
    personId: jane.id as number,
  });
  // No roster row, so `personId` is null exactly as an unrecognised tap is stored.
  await recordSessionTap({
    sessionId: 'session-two',
    uid: UNKNOWN_UID,
    scannedAt: secondsAgo(35),
    personId: null,
  });

  return { jane, ada };
}

describe('DashboardPage', () => {
  beforeEach(async () => {
    localStorage.clear();
    await Dexie.delete(DATABASE_NAME);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('folds the seeded taps and roster into the metrics on screen', async () => {
    await seedTwoSessions();
    const { container } = renderPage();

    expect(screen.getByTestId('text-dashboard-loading')).toBeTruthy();
    expect(await screen.findByTestId('dashboard')).toBeTruthy();

    expect(screen.getByTestId('text-sessions-count').textContent).toBe('2');
    // Two students at the first meeting, one at the second.
    expect(screen.getByTestId('text-average-attendance').textContent).toBe('1.5');
    expect(screen.getByTestId('text-attendance-target').textContent).toBe('50');
    expect(screen.getByTestId('text-percent-of-target').textContent).toBe('3%');
    expect(screen.getByTestId('text-unique-students').textContent).toBe('2');
    expect(screen.getByTestId('text-enrolled-students').textContent).toBe('2');

    expect(screen.getByTestId('text-unidentified-taps').textContent).toBe('1');
    expect(screen.getByTestId('text-unidentified-cards').textContent).toBe('1');
    const cards = screen.getByTestId('list-unidentified-cards');
    expect(within(cards).getByText('••••1122')).toBeTruthy();
    // A card UID is hardware identity: only its tail may reach the DOM.
    expect(container.textContent).not.toContain(UNKNOWN_UID);

    expect(screen.getByTestId('row-grade-12').textContent).toContain('2');
  });

  it('exports every session ever recorded, not just the latest', async () => {
    const { jane } = await seedTwoSessions();
    // What the v3 upgrade stamps on taps that predate session ids. No session
    // id will ever equal it, so the scanner's own export can never reach it.
    await recordSessionTap({
      sessionId: 'legacy',
      uid: jane.cardUid,
      scannedAt: secondsAgo(120),
      personId: jane.id as number,
    });
    const exportSpy = vi
      .spyOn(attendanceExport, 'exportAttendanceWorkbook')
      .mockResolvedValue({
        filename: 'attendance-2026-09-07-20260907T000000Z.xlsx',
        delivery: 'download',
      });
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('dashboard');

    await user.click(screen.getByTestId('button-export-history'));

    expect(exportSpy).toHaveBeenCalledTimes(1);
    const [exportedTaps, exportedPersons] = exportSpy.mock.calls[0];
    expect(exportedTaps).toHaveLength(5);
    expect(new Set(exportedTaps.map((tap) => tap.sessionId))).toEqual(
      new Set(['legacy', 'session-one', 'session-two']),
    );
    expect(exportedPersons).toHaveLength(2);
  });

  it('names the file it handed to the browser', async () => {
    await seedTwoSessions();
    vi.spyOn(attendanceExport, 'exportAttendanceWorkbook').mockResolvedValue({
      filename: 'attendance-2026-09-07-20260907T000000Z.xlsx',
      delivery: 'download',
    });
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('dashboard');

    await user.click(screen.getByTestId('button-export-history'));

    expect(screen.getByTestId('text-export-saved').textContent).toContain(
      'attendance-2026-09-07-20260907T000000Z.xlsx',
    );
  });

  it('re-reads the store when refreshed', async () => {
    const { jane } = await seedTwoSessions();
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('dashboard');
    expect(screen.getByTestId('text-sessions-count').textContent).toBe('2');

    await recordSessionTap({
      sessionId: 'session-three',
      uid: jane.cardUid,
      scannedAt: secondsAgo(10),
      personId: jane.id as number,
    });

    await user.click(screen.getByTestId('button-refresh-dashboard'));

    await waitFor(() =>
      expect(screen.getByTestId('text-sessions-count').textContent).toBe('3'),
    );
  });

  it('offers a retry when the first read fails', async () => {
    await seedTwoSessions();
    const read = vi
      .spyOn(attendanceStore, 'listTapRecords')
      .mockRejectedValueOnce(new Error('storage unavailable'));
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByTestId('text-dashboard-load-error')).toBeTruthy();
    expect(screen.queryByTestId('dashboard')).toBeNull();

    read.mockRestore();
    await user.click(screen.getByTestId('button-dashboard-retry'));

    expect(await screen.findByTestId('dashboard')).toBeTruthy();
    expect(screen.getByTestId('text-sessions-count').textContent).toBe('2');
  });

  it('keeps the numbers already computed when a refresh fails', async () => {
    await seedTwoSessions();
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('dashboard');

    vi.spyOn(attendanceStore, 'listTapRecords').mockRejectedValueOnce(
      new Error('storage unavailable'),
    );
    await user.click(screen.getByTestId('button-refresh-dashboard'));

    expect(await screen.findByTestId('text-dashboard-stale')).toBeTruthy();
    // Still true, only older than the button implied.
    expect(screen.getByTestId('text-sessions-count').textContent).toBe('2');
  });

  it('warns that cards are not being recorded while this page is open', async () => {
    renderPage();

    const notice = await screen.findByTestId('text-scans-paused');
    expect(notice.textContent).toMatch(/not being recorded/i);
    expect(within(notice).getByTestId('link-scanner-resume')).toBeTruthy();
  });

  it('measures against a target the operator can change', async () => {
    const { jane } = await seedTwoSessions();
    expect(jane).toBeTruthy();
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('dashboard');

    // Starts at the default until this kiosk is told what its club looks like.
    expect(screen.getByTestId('text-attendance-target').textContent).toBe('50');
    const before = screen.getByTestId('text-average-attendance').textContent;

    await user.click(screen.getByTestId('button-edit-target'));
    const field = screen.getByTestId('input-attendance-target');
    await user.clear(field);
    await user.type(field, '2');
    await user.click(screen.getByTestId('button-save-target'));

    await waitFor(() =>
      expect(screen.getByTestId('text-attendance-target').textContent).toBe('2'),
    );
    // Only the goal moved; the attendance behind it is untouched.
    expect(screen.getByTestId('text-average-attendance').textContent).toBe(
      before,
    );
    expect(await attendanceStore.getAttendanceTarget()).toBe(2);
  });

  it('reloads with the target this kiosk was given', async () => {
    await seedTwoSessions();
    await attendanceStore.setAttendanceTarget(12);
    renderPage();
    await screen.findByTestId('dashboard');

    expect(screen.getByTestId('text-attendance-target').textContent).toBe('12');
  });

  it('refuses a target that is not a sensible number', async () => {
    await seedTwoSessions();
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('dashboard');

    await user.click(screen.getByTestId('button-edit-target'));
    const field = screen.getByTestId('input-attendance-target');
    await user.clear(field);
    await user.type(field, '0');
    await user.click(screen.getByTestId('button-save-target'));

    expect(await screen.findByTestId('text-target-error')).toBeTruthy();
    // The editor stays open with the typed value, and nothing was stored.
    expect(screen.getByTestId('input-attendance-target')).toBeTruthy();
    expect(await attendanceStore.getAttendanceTarget()).toBe(50);
  });

  it('keeps the editor open when the device will not store it', async () => {
    await seedTwoSessions();
    vi.spyOn(attendanceStore, 'setAttendanceTarget').mockRejectedValue(
      new Error('storage unavailable'),
    );
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('dashboard');

    await user.click(screen.getByTestId('button-edit-target'));
    const field = screen.getByTestId('input-attendance-target');
    await user.clear(field);
    await user.type(field, '15');
    await user.click(screen.getByTestId('button-save-target'));

    expect(await screen.findByTestId('text-target-error')).toBeTruthy();
    expect(screen.getByTestId('text-attendance-target').textContent).toBe('50');
  });

});

describe('DashboardPage activity log', () => {
  beforeEach(async () => {
    localStorage.clear();
    await Dexie.delete(DATABASE_NAME);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('lists the device activity newest first, in words, and says when there is none', async () => {
    await seedTwoSessions();
    renderPage();
    expect(await screen.findByTestId('text-activity-empty')).toBeTruthy();

    cleanup();
    await recordActivity({ at: secondsAgo(30), kind: 'pin-set' });
    await recordActivity({
      at: secondsAgo(10),
      kind: 'remove-student',
      taps: 3,
      sessions: 2,
    });
    renderPage();

    const list = await screen.findByTestId('list-activity');
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('Removed a student');
    expect(rows[0].textContent).toContain('3 taps from 2 sessions');
    expect(rows[1].textContent).toContain('Teacher PIN set');
  });

  it('exports all history with the activity sheet and records the export', async () => {
    await seedTwoSessions();
    await recordActivity({ at: secondsAgo(20), kind: 'pin-set' });
    const exportSpy = vi
      .spyOn(attendanceExport, 'exportAttendanceWorkbook')
      .mockResolvedValue({ filename: 'attendance-all.xlsx', delivery: 'download' });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByTestId('button-export-history'));

    await waitFor(() => expect(exportSpy).toHaveBeenCalledTimes(1));
    const [, , activity] = exportSpy.mock.calls[0];
    expect(activity?.map((entry) => entry.kind)).toEqual(['pin-set']);

    await waitFor(async () =>
      expect((await attendanceStore.listActivity())[0]).toMatchObject({
        kind: 'export-all',
        filename: 'attendance-all.xlsx',
        delivery: 'download',
        taps: 4,
        sessions: 2,
      }),
    );
    // The list on screen picks the new row up without a full reload.
    await waitFor(() =>
      expect(
        within(screen.getByTestId('list-activity')).getAllByRole('listitem')[0]
          .textContent,
      ).toContain('Exported all history'),
    );
    expect(screen.getByTestId('text-export-saved').textContent).toContain(
      'Send this file only to a school account.',
    );
  });

  it('keeps the export a success when the log row cannot be written', async () => {
    await seedTwoSessions();
    vi.spyOn(attendanceExport, 'exportAttendanceWorkbook').mockResolvedValue({
      filename: 'attendance-all.xlsx',
      delivery: 'download',
    });
    vi.spyOn(attendanceStore, 'recordActivity').mockRejectedValue(new Error('quota'));
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByTestId('button-export-history'));

    await waitFor(() =>
      expect(screen.getByTestId('text-export-saved').textContent).toContain(
        'The activity log entry could not be written.',
      ),
    );
  });
});

describe('DashboardPage teacher PIN', () => {
  beforeEach(async () => {
    localStorage.clear();
    await Dexie.delete(DATABASE_NAME);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('changes the teacher PIN from the dashboard and logs it', async () => {
    await setOperatorPin('2468');
    await seedTwoSessions();
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByTestId('button-change-pin'));
    await user.type(await screen.findByTestId('input-pin-current'), '2468');
    await user.type(screen.getByTestId('input-pin'), '1357');
    await user.type(screen.getByTestId('input-pin-confirm'), '1357');
    await user.click(screen.getByTestId('button-pin-submit'));

    expect((await screen.findByTestId('text-pin-changed')).textContent).toContain(
      'Teacher PIN changed',
    );
    expect(await verifyOperatorPin('1357')).toEqual({ status: 'ok' });
    await waitFor(() =>
      expect(
        within(screen.getByTestId('list-activity')).getAllByRole('listitem')[0]
          .textContent,
      ).toContain('Teacher PIN changed'),
    );
  });

  it('keeps the old PIN when the dialog is cancelled', async () => {
    await setOperatorPin('2468');
    await seedTwoSessions();
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByTestId('button-change-pin'));
    await user.click(await screen.findByTestId('button-pin-cancel'));

    expect(screen.queryByTestId('dialog-pin')).toBeNull();
    expect(await verifyOperatorPin('2468')).toEqual({ status: 'ok' });
  });
});

describe('DashboardPage attendance body', () => {
  beforeEach(async () => {
    localStorage.clear();
    await Dexie.delete(DATABASE_NAME);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('shows the active body the device is attached to', async () => {
    await seedTwoSessions();
    renderPage();

    expect((await screen.findByTestId('text-active-body')).textContent).toContain(
      'Club',
    );
    expect(screen.getByTestId('text-active-body').textContent).toContain('club');
  });

  it('switches to an existing body without touching the one just left', async () => {
    await seedTwoSessions();
    const debateClub = await createBody({ name: 'Debate Club', typeLabel: 'club' });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByTestId('button-change-body'));
    await user.click(await screen.findByTestId(`button-body-${debateClub.id}`));

    await waitFor(() =>
      expect(screen.getByTestId('text-active-body').textContent).toContain(
        'Debate Club',
      ),
    );
    expect((await getActiveBody()).id).toBe(debateClub.id);
  });

  it('creates a new body from the dashboard and attaches to it', async () => {
    await seedTwoSessions();
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByTestId('button-change-body'));
    await user.type(await screen.findByTestId('input-body-name'), 'Robotics Club');
    await user.selectOptions(screen.getByTestId('select-body-type'), 'club');
    await user.click(screen.getByTestId('button-body-create'));

    await waitFor(() =>
      expect(screen.getByTestId('text-active-body').textContent).toContain(
        'Robotics Club',
      ),
    );
  });
});

describe('DashboardPage retention', () => {
  beforeEach(async () => {
    localStorage.clear();
    await Dexie.delete(DATABASE_NAME);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  /** A graduate with one tap last school year and one this year. */
  async function seedGraduate() {
    const now = new Date().toISOString();
    const start = schoolYearStart(now);
    const lastYear = new Date(
      Date.parse(`${start}T12:00:00.000Z`) - 86_400_000,
    ).toISOString();
    const grace = await addPerson({
      cardUid: '04AAAAAAAAAAAA',
      firstName: 'Grace',
      lastName: 'Old',
      gradYear: currentSeniorGradYear(now) - 1,
      email: 'gold@stjohnschs.org',
      enrolledAt: lastYear,
    });
    await recordSessionTap({
      sessionId: 'last-year',
      uid: grace.cardUid,
      scannedAt: lastYear,
      personId: grace.id as number,
    });
    await recordSessionTap({
      sessionId: 'session-two',
      uid: grace.cardUid,
      scannedAt: secondsAgo(30),
      personId: grace.id as number,
    });
    return { grace, start };
  }

  it('previews, confirms, logs and reloads both retention actions', async () => {
    await seedTwoSessions();
    const { grace } = await seedGraduate();
    const user = userEvent.setup();
    renderPage();

    const historyText = await screen.findByTestId('text-retention-history');
    expect(historyText.textContent).toContain('1 tap');
    expect(historyText.textContent).toContain('1 session');
    expect(screen.getByTestId('text-retention-alumni').textContent).toContain(
      '1 graduated student',
    );

    await user.click(screen.getByTestId('button-purge-history'));
    expect(screen.getByTestId('text-retention-cost').textContent).toContain('1 tap');
    await user.click(screen.getByTestId('button-retention-confirm'));

    await waitFor(() =>
      expect(screen.getByTestId('text-retention-done').textContent).toMatch(
        /^Deleted 1 tap from 1 session before /,
      ),
    );
    expect(
      (await attendanceStore.listTapRecords()).some((tap) => tap.sessionId === 'last-year'),
    ).toBe(false);
    await waitFor(() =>
      expect(screen.getByTestId('text-retention-history').textContent).toBe(
        'Nothing older than this school year.',
      ),
    );
    expect(screen.getByTestId('button-purge-history').hasAttribute('disabled')).toBe(true);
    expect(
      within(screen.getByTestId('list-activity')).getAllByRole('listitem')[0].textContent,
    ).toContain('Deleted attendance');

    await user.click(screen.getByTestId('button-remove-alumni'));
    expect(screen.getByTestId('text-retention-cost').textContent).toContain(
      '1 graduated student',
    );
    await user.click(screen.getByTestId('button-retention-confirm'));

    await waitFor(() =>
      expect(screen.getByTestId('text-retention-done').textContent).toBe(
        'Removed 1 graduated student and 1 tap.',
      ),
    );
    expect(
      (await attendanceStore.listPersons()).some((person) => person.id === grace.id),
    ).toBe(false);
    await waitFor(() =>
      expect(screen.getByTestId('text-retention-alumni').textContent).toBe(
        'No graduated students on this device.',
      ),
    );
    expect(screen.getByTestId('button-remove-alumni').hasAttribute('disabled')).toBe(true);
    expect(
      within(screen.getByTestId('list-activity')).getAllByRole('listitem')[0].textContent,
    ).toContain('Removed graduated students');
    const logged = await attendanceStore.listActivity();
    expect(logged[0]).toMatchObject({ kind: 'remove-alumni', students: 1, taps: 1 });
    expect(logged[1]).toMatchObject({ kind: 'purge-history', taps: 1, sessions: 1 });
    expect(typeof logged[1].before).toBe('string');
    expect(JSON.stringify(logged)).not.toContain('Grace');
  });

  it('disables both actions when there is nothing to do', async () => {
    await seedTwoSessions();
    renderPage();

    expect((await screen.findByTestId('text-retention-history')).textContent).toBe(
      'Nothing older than this school year.',
    );
    expect(screen.getByTestId('text-retention-alumni').textContent).toBe(
      'No graduated students on this device.',
    );
    expect(screen.getByTestId('button-purge-history').hasAttribute('disabled')).toBe(true);
    expect(screen.getByTestId('button-remove-alumni').hasAttribute('disabled')).toBe(true);
  });
});
