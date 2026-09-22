import Dexie from 'dexie';
import * as XLSX from 'xlsx';
import { cleanup, render, screen, waitFor, waitForElementToBeRemoved } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as attendanceStore from '@/data/attendance-store';
import { addPerson, listPersons } from '@/data/attendance-store';
import {
  ROSTER_COLUMNS,
  ROSTER_SHEET_NAME,
  type RosterSheetRow,
} from '@/lib/roster-workbook';
import { RosterPage } from './RosterPage';

const DATABASE_NAME = 'attendance-scanner-local';

// Synthetic fixtures: invented students; card UID is fake (not a real card).
const JORDAN_CARD = '04A1B2C3D4E5F6'; // fake


function row(overrides: Partial<RosterSheetRow> = {}): Partial<RosterSheetRow> {
  return {
    'First Name': 'Jordan',
    'Last Name': 'Lee',
    'Graduation Year': '2027',
    Email: 'jlee27@stjohnschs.org',
    Grade: '12',
    'Card (last 4)': '',
    ...overrides,
  };
}

const priyaRow = row({
  'First Name': 'Priya',
  'Last Name': 'Nair',
  'Graduation Year': '2028',
  Email: 'pnair28@stjohnschs.org',
});

/** A real .xlsx, so the page exercises the same read a teacher's file gets. */
function rosterFile(
  rows: Partial<RosterSheetRow>[],
  name = 'roster.xlsx',
): File {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(rows, { header: ROSTER_COLUMNS }),
    ROSTER_SHEET_NAME,
  );
  const bytes = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  return new File([bytes], name, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

function renderPage() {
  return render(
    <MemoryRouter>
      <RosterPage />
    </MemoryRouter>,
  );
}

/** Picks a file in the import panel and waits for the page to settle. */
async function importFile(
  user: ReturnType<typeof userEvent.setup>,
  file: File,
) {
  await user.upload(screen.getByTestId('input-roster-file'), file);
  await screen.findByTestId('roster-import');
}

describe('RosterPage roster import', () => {
  beforeEach(async () => {
    localStorage.clear();
    await Dexie.delete(DATABASE_NAME);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('pre-enrolls students from a file whose card column is empty', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('roster-import');

    await importFile(user, rosterFile([row(), priyaRow]));

    const summary = await screen.findByTestId('text-import-summary');
    expect(summary.textContent).toContain('2 students added');
    expect(summary.textContent).toContain('0 updated');
    expect(summary.textContent).toContain('0 refused');
    const stored = await listPersons();
    expect(stored).toHaveLength(2);
    expect(stored.every((person) => person.cardUid === undefined)).toBe(true);
    // The table shows them, and says out loud that they have no card yet.
    expect(
      screen.getByTestId(`text-card-tail-${stored[0].id}`).textContent,
    ).toBe('No card yet');
  });

  it('changes nothing when the same file is imported twice', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('roster-import');
    await importFile(user, rosterFile([row(), priyaRow]));
    const firstSummary = await screen.findByTestId('text-import-summary');
    const afterFirst = await listPersons();

    // handleImport sets result to null before applying the second file, which
    // unmounts this node. Waiting on that specific element (not a re-query)
    // synchronises on the second import starting even when the next summary
    // mounts in the same turn — no timeout bump, no retry flag.
    await user.upload(
      screen.getByTestId('input-roster-file'),
      rosterFile([row(), priyaRow]),
    );
    // Fast path: the second import can clear+replace the summary before we
    // start waiting. Slow path: the node is still mounted — wait for unmount.
    if (firstSummary.isConnected) {
      await waitForElementToBeRemoved(firstSummary);
    }
    const secondSummary = await screen.findByTestId('text-import-summary');
    expect(secondSummary.textContent).toContain('0 students added');
    expect(secondSummary.textContent).toContain('2 already up to date');
    expect(await listPersons()).toEqual(afterFirst);
  });

  it('keeps a bound card when the file lists that student without one', async () => {
    const bound = await addPerson({
      cardUid: JORDAN_CARD,
      firstName: 'Jordan',
      lastName: 'Lee',
      gradYear: 2027,
      email: 'jlee27@stjohnschs.org',
      enrolledAt: '2026-09-01T12:00:00.000Z',
    });
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('roster-import');

    await importFile(user, rosterFile([row({ 'First Name': 'Jordy' })]));

    await screen.findByTestId('text-import-summary');
    const [stored] = await listPersons();
    expect(stored.id).toBe(bound.id);
    expect(stored.firstName).toBe('Jordy');
    // The card is still theirs. An empty card column is "no card in this
    // file", never "take the card away".
    expect(stored.cardUid).toBe(JORDAN_CARD);
    expect(screen.getByTestId(`text-card-tail-${bound.id}`).textContent).toBe(
      '••••E5F6',
    );
  });

  it('says a card column was read and ignored rather than acted on', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('roster-import');

    await importFile(user, rosterFile([row({ 'Card (last 4)': '••••E5F6' })]));

    const notice = await screen.findByTestId('text-import-cards-ignored');
    expect(notice.textContent).toContain('1 row');
    expect((await listPersons())[0].cardUid).toBeUndefined();
  });

  it('reports a refused row by line number and imports the rest', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('roster-import');

    await importFile(
      user,
      rosterFile([row(), priyaRow, row({ Email: 'someone@example.com' })]),
    );

    const rejected = await screen.findByTestId('list-import-rejected');
    expect(rejected.textContent).toContain('Row 4');
    expect(rejected.textContent).toContain('stjohnschs.org');
    // The reason points at a line, never at the person on it.
    expect(rejected.textContent).not.toContain('someone@example.com');
    expect(await listPersons()).toHaveLength(2);
  });

  it('imports nothing when the attendance export is picked by mistake', async () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet([
        { Timestamp: 'Sep 15, 2026', 'Card (last 4)': '••••E5F6', Grade: '12' },
      ]),
      'Attendance',
    );
    const bytes = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('roster-import');

    // The two exports sit side by side in a downloads folder, so this is the
    // likeliest wrong file — and it must not read as a roster of one
    // nameless student.
    await importFile(
      user,
      new File([bytes], 'attendance-2026-09-15.xlsx', {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
    );

    const failure = await screen.findByTestId('text-import-failed');
    expect(failure.textContent).toContain('Nothing was imported');
    expect(failure.textContent).toContain('First Name');
    expect(await listPersons()).toEqual([]);
    expect(screen.queryByTestId('text-import-summary')).toBeNull();
  });

  it('does not claim success when the write fails', async () => {
    vi.spyOn(attendanceStore, 'applyRosterImport').mockRejectedValue(
      new Error('storage unavailable'),
    );
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('roster-import');

    await importFile(user, rosterFile([row()]));

    const failure = await screen.findByTestId('text-import-failed');
    expect(failure.textContent).toContain('roster is unchanged');
    expect(await listPersons()).toEqual([]);
  });

  it('logs the import as counts, with nobody named in the row', async () => {
    const record = vi
      .spyOn(attendanceStore, 'recordActivity')
      .mockResolvedValue();
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('roster-import');

    await importFile(
      user,
      rosterFile([row(), priyaRow, row({ Email: 'someone@example.com' })]),
    );

    await waitFor(() => expect(record).toHaveBeenCalledTimes(1));
    const [entry] = record.mock.calls[0];
    expect(entry).toMatchObject({
      kind: 'import-roster',
      added: 2,
      updated: 0,
      skipped: 0,
      rejected: 1,
    });
    const serialised = JSON.stringify(entry);
    expect(serialised).not.toContain('Jordan');
    expect(serialised).not.toContain('stjohnschs.org');
  });

  it('still reports the import when the log entry cannot be written', async () => {
    vi.spyOn(attendanceStore, 'recordActivity').mockRejectedValue(
      new Error('quota'),
    );
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('roster-import');

    await importFile(user, rosterFile([row()]));

    expect(await screen.findByTestId('text-import-log-failed')).toBeTruthy();
    expect(screen.getByTestId('text-import-summary').textContent).toContain(
      '1 student added',
    );
    expect(await listPersons()).toHaveLength(1);
  });
});

describe('RosterPage roster export', () => {
  beforeEach(async () => {
    localStorage.clear();
    await Dexie.delete(DATABASE_NAME);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('offers the roster as the file an import expects back', async () => {
    await addPerson({
      cardUid: JORDAN_CARD,
      firstName: 'Jordan',
      lastName: 'Lee',
      gradYear: 2027,
      email: 'jlee27@stjohnschs.org',
      enrolledAt: '2026-09-01T12:00:00.000Z',
    });
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('roster-import');

    await user.click(screen.getByTestId('button-export-roster'));

    const notice = await screen.findByTestId('text-export-saved');
    expect(notice.textContent).toMatch(/roster-\d{4}-\d{2}-\d{2}/);
    // The file that just left the device names no card in full.
    expect(notice.textContent).not.toContain(JORDAN_CARD);
  });
});
