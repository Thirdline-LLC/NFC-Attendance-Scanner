import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';

import type { AttendanceBody } from '@/data/attendance-store';
import {
  buildRosterTemplateCsv,
  buildRosterTemplateWorkbook,
  deliverRosterTemplateCsv,
  deliverRosterTemplateWorkbook,
  INSTRUCTIONS_SHEET_NAME,
} from '@/lib/roster-template';
import {
  parseRosterCsvText,
  parseRosterWorkbook,
  ROSTER_SHEET_NAME,
} from '@/lib/roster-workbook';
import * as delivery from '@/lib/workbook-delivery';

const ACTIVE_BODY: AttendanceBody = {
  id: 1,
  name: 'Robotics Club',
  typeLabel: 'Club',
  createdAt: '2026-09-01T00:00:00.000Z',
  parentId: null,
};

/** Replaces the xlsx template's single example row with real student data. */
function withRealRow(
  workbook: XLSX.WorkBook,
  overrides: { firstName: string; lastName: string; gradYear: string; email?: string },
): XLSX.WorkBook {
  const sheet = workbook.Sheets[ROSTER_SHEET_NAME];
  const [row] = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, { defval: '' });
  const header = Object.keys(row);
  const realRow = {
    ...row,
    'First Name': overrides.firstName,
    'Last Name': overrides.lastName,
    'Graduation Year': overrides.gradYear,
    Email: overrides.email ?? '',
  };
  workbook.Sheets[ROSTER_SHEET_NAME] = XLSX.utils.json_to_sheet([realRow], { header });
  return workbook;
}

function withRealCsvRow(text: string, overrides: { firstName: string; lastName: string; gradYear: string }): string {
  const [header] = text.split('\n');
  return `${header}\n${overrides.firstName},${overrides.lastName},${overrides.gradYear},,${'Robotics Club'},${'Club'}\n`;
}

describe('buildRosterTemplateWorkbook', () => {
  it('ships exactly the headers the importer reads, omitting Grade and Card', () => {
    const { workbook } = buildRosterTemplateWorkbook(ACTIVE_BODY);
    const [row] = XLSX.utils.sheet_to_json<Record<string, string>>(
      workbook.Sheets[ROSTER_SHEET_NAME],
      { defval: '' },
    );

    expect(Object.keys(row)).toEqual([
      'First Name',
      'Last Name',
      'Graduation Year',
      'Email',
      'Body Name',
      'Body Type',
    ]);
  });

  it('pre-fills the example row with the active body', () => {
    const { workbook, filename } = buildRosterTemplateWorkbook(ACTIVE_BODY);
    const [row] = XLSX.utils.sheet_to_json<Record<string, string>>(
      workbook.Sheets[ROSTER_SHEET_NAME],
      { defval: '' },
    );

    expect(row['Body Name']).toBe('Robotics Club');
    expect(row['Body Type']).toBe('Club');
    expect(row['First Name']).toBe('Avery');
    expect(row.Email).toContain('example.com');
    expect(filename).toBe('tapin-roster-template-robotics-club.xlsx');
  });

  it('leaves the body columns blank when there is no active body', () => {
    const { workbook, filename } = buildRosterTemplateWorkbook();
    const [row] = XLSX.utils.sheet_to_json<Record<string, string>>(
      workbook.Sheets[ROSTER_SHEET_NAME],
      { defval: '' },
    );

    expect(row['Body Name']).toBe('');
    expect(row['Body Type']).toBe('');
    expect(filename).toBe('tapin-roster-template-roster.xlsx');
  });

  it('ships an Instructions sheet the importer never reads', () => {
    const { workbook } = buildRosterTemplateWorkbook(ACTIVE_BODY);

    expect(workbook.SheetNames).toEqual([ROSTER_SHEET_NAME, INSTRUCTIONS_SHEET_NAME]);

    const instructions = XLSX.utils.sheet_to_csv(workbook.Sheets[INSTRUCTIONS_SHEET_NAME]);
    expect(instructions).toContain('Required columns');
    expect(instructions).toContain('Card');

    // The importer selects its sheet by name and must land on Roster even
    // with Instructions present — proving the extra sheet is inert to it.
    const parsed = parseRosterWorkbook(workbook, ACTIVE_BODY);
    expect(parsed.entries).toEqual([]);
    // The lone example row is refused (not silently accepted), because its
    // email is not a school address.
    expect(parsed.rejected).toHaveLength(1);
  });

  it('imports successfully once the example row is replaced with real data', () => {
    const { workbook } = buildRosterTemplateWorkbook(ACTIVE_BODY);
    withRealRow(workbook, {
      firstName: 'Jordan',
      lastName: 'Lee',
      gradYear: '2027',
      email: 'jlee27@stjohnschs.org',
    });

    const parsed = parseRosterWorkbook(workbook, ACTIVE_BODY);

    expect(parsed.rejected).toEqual([]);
    expect(parsed.entries).toEqual([
      {
        firstName: 'Jordan',
        lastName: 'Lee',
        gradYear: 2027,
        email: 'jlee27@stjohnschs.org',
      },
    ]);
  });

  it('the active-body pre-fill never trips the body-mismatch refusal', () => {
    const { workbook } = buildRosterTemplateWorkbook(ACTIVE_BODY);
    withRealRow(workbook, {
      firstName: 'Jordan',
      lastName: 'Lee',
      gradYear: '2027',
      email: 'jlee27@stjohnschs.org',
    });

    expect(() => parseRosterWorkbook(workbook, ACTIVE_BODY)).not.toThrow();
  });

  it('leaves both body columns blank without a body, so a fresh file matches any active body', () => {
    const { workbook } = buildRosterTemplateWorkbook();
    withRealRow(workbook, {
      firstName: 'Jordan',
      lastName: 'Lee',
      gradYear: '2027',
      email: 'jlee27@stjohnschs.org',
    });

    const parsed = parseRosterWorkbook(workbook, ACTIVE_BODY);
    expect(parsed.entries).toHaveLength(1);
  });
});

describe('buildRosterTemplateCsv', () => {
  it('matches the snake_case headers the CSV importer and templates/roster-template.csv use', () => {
    const { text, filename } = buildRosterTemplateCsv(ACTIVE_BODY);
    const [header] = text.split('\n');

    expect(header.trim()).toBe('first_name,last_name,grad_year,email,body_name,body_type');
    expect(text).toContain('Robotics Club');
    expect(text).toContain('Club');
    expect(filename).toBe('tapin-roster-template-robotics-club.csv');
  });

  it('imports successfully once the example row is replaced with real data', () => {
    const { text } = buildRosterTemplateCsv(ACTIVE_BODY);
    const realText = withRealCsvRow(text, {
      firstName: 'Jordan',
      lastName: 'Lee',
      gradYear: '2027',
    });

    const parsed = parseRosterCsvText(realText, ACTIVE_BODY);

    expect(parsed.rejected).toEqual([]);
    expect(parsed.entries).toEqual([
      {
        firstName: 'Jordan',
        lastName: 'Lee',
        gradYear: 2027,
        email: 'jlee27@stjohnschs.org',
      },
    ]);
  });

  it('falls back to a generic filename with no active body', () => {
    const { filename } = buildRosterTemplateCsv();
    expect(filename).toBe('tapin-roster-template-roster.csv');
  });
});

describe('delivering the templates', () => {
  beforeEach(() => {
    vi.spyOn(delivery, 'deliverWorkbook').mockResolvedValue({
      filename: 'tapin-roster-template-robotics-club.xlsx',
      delivery: 'download',
    });
  });

  it('delivers the xlsx template through deliverWorkbook, in xlsx format', async () => {
    await deliverRosterTemplateWorkbook(ACTIVE_BODY);

    expect(delivery.deliverWorkbook).toHaveBeenCalledTimes(1);
    const [request] = vi.mocked(delivery.deliverWorkbook).mock.calls[0];
    expect(request.filename).toBe('tapin-roster-template-robotics-club.xlsx');
    expect(request.format ?? 'xlsx').toBe('xlsx');
    expect(request.workbook.SheetNames).toEqual([ROSTER_SHEET_NAME, INSTRUCTIONS_SHEET_NAME]);
  });

  it('delivers the CSV template through deliverWorkbook in csv format', async () => {
    await deliverRosterTemplateCsv(ACTIVE_BODY);

    const [request] = vi.mocked(delivery.deliverWorkbook).mock.calls[0];
    expect(request.filename).toBe('tapin-roster-template-robotics-club.csv');
    expect(request.format).toBe('csv');
  });
});
