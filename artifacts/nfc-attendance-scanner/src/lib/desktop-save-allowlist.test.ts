import { describe, expect, it } from 'vitest';

import type { AttendanceBody } from '@/data/attendance-store';
import { buildRosterTemplateCsv, buildRosterTemplateWorkbook } from '@/lib/roster-template';
import { buildRosterWorkbook } from '@/lib/roster-workbook';
// A relative import into electron/, not the other way around: electron/tsconfig.json
// type-checks everything directly under electron/ (including its own tests) against
// a deliberately narrow, Electron-free project with no `@/...` alias, so the builders
// this file needs cannot be imported from there. This file is a plain vitest spec
// under src/lib/, outside both `tsc -p tsconfig.json` (which excludes *.test.ts) and
// `tsc -p electron/tsconfig.json` (which only looks inside electron/), so it is free
// to import in both directions and prove the two sides actually agree.
import { parseSaveRequest } from '../../electron/validation';

const ROBOTICS: AttendanceBody = {
  id: 1,
  name: 'Robotics Club',
  typeLabel: 'club',
  createdAt: '2026-09-01T00:00:00.000Z',
};

/** Well-formed base64: length a multiple of four, alphabet respected. */
const VALID_BASE64 = 'UEsDBBQAAAAIAA==';

describe('the desktop save allowlist against real generated filenames', () => {
  it('accepts the filename buildRosterWorkbook actually generates', () => {
    const { filename } = buildRosterWorkbook([], new Date('2026-09-15T21:00:00.000Z'));

    expect(filename).toBe('roster-2026-09-15-20260915T210000Z.xlsx');
    expect(parseSaveRequest({ filename, base64: VALID_BASE64 })).toEqual({
      filename,
      base64: VALID_BASE64,
    });
  });

  it('accepts the filename buildRosterTemplateWorkbook actually generates', () => {
    const { filename } = buildRosterTemplateWorkbook(ROBOTICS);

    expect(filename).toBe('tapin-roster-template-robotics-club.xlsx');
    expect(parseSaveRequest({ filename, base64: VALID_BASE64 })).toEqual({
      filename,
      base64: VALID_BASE64,
    });
  });

  it('accepts the filename buildRosterTemplateCsv actually generates', () => {
    const { filename } = buildRosterTemplateCsv(ROBOTICS);

    expect(filename).toBe('tapin-roster-template-robotics-club.csv');
    expect(parseSaveRequest({ filename, base64: VALID_BASE64 })).toEqual({
      filename,
      base64: VALID_BASE64,
    });
  });

  it('still accepts a template filename with no active body', () => {
    const { filename } = buildRosterTemplateWorkbook();

    expect(filename).toBe('tapin-roster-template-roster.xlsx');
    expect(parseSaveRequest({ filename, base64: VALID_BASE64 })).toEqual({
      filename,
      base64: VALID_BASE64,
    });
  });

  it('accepts a template filename generated from a body name over 64 characters, capped by bodySlug', () => {
    const longName: AttendanceBody = { ...ROBOTICS, name: 'a'.repeat(200) };
    const { filename } = buildRosterTemplateWorkbook(longName);

    expect(parseSaveRequest({ filename, base64: VALID_BASE64 })).toEqual({
      filename,
      base64: VALID_BASE64,
    });
  });
});
