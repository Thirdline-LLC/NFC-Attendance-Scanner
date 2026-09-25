import { describe, expect, it } from 'vitest';
import { describeActivity } from './activity-wording';

const AT = '2026-09-15T21:00:00.000Z';
const FILE = 'attendance-2026-09-15-20260915T210000Z.xlsx';

describe('describeActivity', () => {
  it('names a session export by file and where it went', () => {
    expect(
      describeActivity({
        at: AT,
        kind: 'export-session',
        filename: FILE,
        delivery: 'saved',
        taps: 12,
        sessions: 1,
      }),
    ).toEqual({ action: 'Exported this session', detail: `${FILE}, saved` });
    expect(
      describeActivity({
        at: AT,
        kind: 'export-session',
        filename: FILE,
        delivery: 'file',
        taps: 1,
        sessions: 1,
      }),
    ).toEqual({
      action: 'Exported this session',
      detail: `${FILE}, saved to Documents`,
    });
    expect(
      describeActivity({
        at: AT,
        kind: 'export-session',
        filename: FILE,
        delivery: 'download',
        taps: 1,
        sessions: 1,
      }),
    ).toEqual({
      action: 'Exported this session',
      detail: `${FILE}, handed to the browser`,
    });
  });

  it('counts taps and sessions for a full-history export', () => {
    expect(
      describeActivity({
        at: AT,
        kind: 'export-all',
        filename: FILE,
        delivery: 'download',
        taps: 240,
        sessions: 9,
      }),
    ).toEqual({
      action: 'Exported all history',
      detail: `240 taps from 9 sessions — ${FILE}, handed to the browser`,
    });
  });

  it('names the range, not the people, for a date-range export', () => {
    expect(
      describeActivity({
        at: AT,
        kind: 'export-range',
        filename: 'English 11 - Period 3 - 2026-09-01 to 2026-09-24.xlsx',
        delivery: 'saved',
        taps: 40,
        sessions: 5,
        rangeFrom: '2026-09-01',
        rangeTo: '2026-09-24',
      }),
    ).toEqual({
      action: 'Exported a date range',
      detail:
        'Sep 1, 2026 – Sep 24, 2026: 40 taps from 5 sessions — English 11 - Period 3 - 2026-09-01 to 2026-09-24.xlsx, saved',
    });
    expect(
      describeActivity({
        at: AT,
        kind: 'export-range',
        filename: 'Chess - 2026-09-02.xlsx',
        delivery: 'download',
        taps: 1,
        sessions: 1,
        rangeFrom: '2026-09-02',
        rangeTo: '2026-09-02',
      }).detail,
    ).toBe('Sep 2, 2026: 1 tap from 1 session — Chess - 2026-09-02.xlsx, handed to the browser');
  });

  it('describes a roster import and export by count only', () => {
    expect(
      describeActivity({
        at: AT,
        kind: 'import-roster',
        added: 1,
        updated: 3,
        skipped: 120,
        rejected: 2,
      }),
    ).toEqual({
      action: 'Imported a roster',
      detail: '1 student added, 3 updated, 120 unchanged, 2 refused',
    });
    expect(
      describeActivity({
        at: AT,
        kind: 'export-roster',
        filename: 'roster-2026-09-15-20260915T210000Z.xlsx',
        delivery: 'download',
        students: 126,
      }),
    ).toEqual({
      action: 'Exported the roster',
      detail:
        '126 students — roster-2026-09-15-20260915T210000Z.xlsx, handed to the browser',
    });
  });

  it('describes removals and purges by count only, singular and plural', () => {
    expect(
      describeActivity({ at: AT, kind: 'remove-student', taps: 1, sessions: 1 }),
    ).toEqual({ action: 'Removed a student', detail: '1 tap from 1 session' });
    expect(
      describeActivity({ at: AT, kind: 'remove-student', taps: 0, sessions: 0 }),
    ).toEqual({ action: 'Removed a student', detail: '0 taps from 0 sessions' });
    expect(
      describeActivity({
        at: AT,
        kind: 'purge-history',
        taps: 300,
        sessions: 12,
        before: '2026-08-01',
      }),
    ).toEqual({
      action: 'Deleted attendance',
      detail: '300 taps from 12 sessions before Aug 1, 2026',
    });
    expect(
      describeActivity({ at: AT, kind: 'remove-alumni', students: 2, taps: 40 }),
    ).toEqual({
      action: 'Removed graduated students',
      detail: '2 students and 40 taps',
    });
  });

  it('says only that the PIN changed', () => {
    expect(describeActivity({ at: AT, kind: 'pin-set' })).toEqual({
      action: 'Teacher PIN set',
      detail: '',
    });
    expect(describeActivity({ at: AT, kind: 'pin-changed' })).toEqual({
      action: 'Teacher PIN changed',
      detail: '',
    });
    expect(describeActivity({ at: AT, kind: 'body-reparent' })).toEqual({
      action: 'Moved a body in the tree',
      detail: '',
    });
    expect(describeActivity({ at: AT, kind: 'body-archive' })).toEqual({
      action: 'Archived a body',
      detail: '',
    });
  });

  it('has no field it could print a name, an email or a UID from', () => {
    const wording = describeActivity({
      at: AT,
      kind: 'remove-student',
      taps: 2,
      sessions: 1,
    });
    expect(`${wording.action} ${wording.detail}`).not.toMatch(/@|[0-9A-F]{14}/);
  });

  it('names a scanner period switch by body names only', () => {
    expect(
      describeActivity({
        at: AT,
        kind: 'body-switch',
        fromBodyId: 2,
        fromBodyName: 'Period 1',
        toBodyId: 3,
        toBodyName: 'Period 3',
      }),
    ).toEqual({ action: 'Switched on the scanner', detail: 'Period 1 → Period 3' });
  });

  it('names the switch-PIN setting changes', () => {
    expect(describeActivity({ at: AT, kind: 'switch-pin-enabled' })).toEqual({
      action: 'PIN to switch periods turned on',
      detail: '',
    });
    expect(describeActivity({ at: AT, kind: 'switch-pin-disabled' })).toEqual({
      action: 'PIN to switch periods turned off',
      detail: '',
    });
  });

  it('says when an export covered the body and its descendants, by count only', () => {
    expect(
      describeActivity({
        at: AT,
        kind: 'export-range',
        filename: 'English 11 - All periods - 2026-09-01 to 2026-09-24.xlsx',
        delivery: 'saved',
        taps: 120,
        sessions: 20,
        rangeFrom: '2026-09-01',
        rangeTo: '2026-09-24',
        scope: 'subtree',
        bodies: 5,
      }),
    ).toEqual({
      action: 'Exported a date range, with descendants',
      detail:
        'Sep 1, 2026 – Sep 24, 2026: 120 taps from 20 sessions across 5 bodies — English 11 - All periods - 2026-09-01 to 2026-09-24.xlsx, saved',
    });
    expect(
      describeActivity({ at: AT, kind: 'export-all', filename: FILE, delivery: 'saved', taps: 1, sessions: 1, scope: 'subtree', bodies: 1 }),
    ).toEqual({
      action: 'Exported all history, with descendants',
      detail: `1 tap from 1 session across 1 body — ${FILE}, saved`,
    });
  });
});
