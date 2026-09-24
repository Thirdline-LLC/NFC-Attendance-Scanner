import { describe, expect, it } from 'vitest';

import type { AttendanceBody } from '@/data/attendance-store';
import { parseRosterCsvText } from '@/lib/roster-workbook';
// Imported as text through Vite's `?raw`, so the path is resolved from this
// file rather than from wherever the test runner was started.
import STATIC_TEMPLATE from '../../../../templates/roster-template.csv?raw';

/**
 * The static `templates/roster-template.csv` shipped in the repo. Its example
 * rows must never import as real students — not as-is, and not after a
 * teacher clears only their email (which would otherwise make the importer
 * derive a school address). Their `(example)` graduation years guarantee it.
 */
const ROBOTICS: AttendanceBody = {
  id: 1,
  name: 'Robotics',
  typeLabel: 'club',
  createdAt: '2026-09-01T00:00:00.000Z',
  parentId: null,
};

/** The file with every data row's email column (index 3) cleared. */
function withEmailsCleared(text: string): string {
  const [header, ...rows] = text.trim().split('\n');
  return [
    header,
    ...rows.map((row) => {
      const fields = row.split(',');
      fields[3] = '';
      return fields.join(',');
    }),
  ].join('\n');
}

describe('templates/roster-template.csv', () => {
  it('uses the snake_case headers the CSV importer reads', () => {
    expect(STATIC_TEMPLATE.split('\n')[0].trim()).toBe(
      'first_name,last_name,grad_year,email,body_name,body_type',
    );
  });

  it('imports nobody as-is: every example row is refused on its own', () => {
    const parsed = parseRosterCsvText(STATIC_TEMPLATE, ROBOTICS);
    expect(parsed.entries).toHaveLength(0);
    expect(parsed.rejected).toHaveLength(2);
  });

  it('still imports nobody when only the example emails are cleared', () => {
    const parsed = parseRosterCsvText(withEmailsCleared(STATIC_TEMPLATE), ROBOTICS);
    expect(parsed.entries).toHaveLength(0);
    expect(parsed.rejected).toHaveLength(2);
    for (const row of parsed.rejected) {
      expect(row.reason).toMatch(/not a four-digit year/);
    }
  });

  it('imports real rows added below the example rows (the file is not refused wholesale)', () => {
    const text = `${STATIC_TEMPLATE.trim()}\nJane,Smith,2027,,Robotics,club\n`;
    const parsed = parseRosterCsvText(text, ROBOTICS);
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.entries[0]).toMatchObject({ firstName: 'Jane', lastName: 'Smith', gradYear: 2027 });
    expect(parsed.rejected).toHaveLength(2);
  });

  it('imports once the example rows are replaced with real data', () => {
    const [header] = STATIC_TEMPLATE.split('\n');
    const parsed = parseRosterCsvText(`${header}\nJane,Smith,2027,,Robotics,club\n`, ROBOTICS);
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.rejected).toHaveLength(0);
  });
});
