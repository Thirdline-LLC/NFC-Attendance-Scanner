/**
 * Plan 03 — Roster import: CSV parsing, .nfc-pack parsing, and body-scope
 * validation. All fixtures are synthetic: invented names, fake card UIDs.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import Dexie from 'dexie';

import type { AttendanceBody } from '@/data/attendance-store';
import {
  parseRosterCsvText,
  parseNfcPackJson,
  RosterFormatError,
} from './roster-workbook';

const DATABASE_NAME = 'attendance-scanner-local';

const roboticsBody: AttendanceBody = {
  id: 1,
  name: 'Robotics',
  typeLabel: 'club',
  createdAt: '2026-09-01T00:00:00.000Z',
};

// ---------------------------------------------------------------------------
// CSV parsing
// ---------------------------------------------------------------------------

describe('parseRosterCsvText', () => {
  beforeEach(async () => {
    await Dexie.delete(DATABASE_NAME);
  });

  it('parses a minimal CSV with snake_case headers', () => {
    const csv = [
      'first_name,last_name,grad_year,email',
      'Avery,Chen,2028,achen28@stjohnschs.org',
      'Jordan,Lee,2027,jlee27@stjohnschs.org',
    ].join('\n');

    const result = parseRosterCsvText(csv);

    expect(result.entries).toHaveLength(2);
    expect(result.rejected).toHaveLength(0);
    expect(result.cardsIgnored).toBe(0);
    expect(result.entries[0]).toEqual({
      firstName: 'Avery',
      lastName: 'Chen',
      gradYear: 2028,
      email: 'achen28@stjohnschs.org',
    });
  });

  it('includes body_name and body_type columns without error when they match', () => {
    const csv = [
      'first_name,last_name,grad_year,email,body_name,body_type',
      'Avery,Chen,2028,achen28@stjohnschs.org,Robotics,club',
    ].join('\n');

    const result = parseRosterCsvText(csv, roboticsBody);

    expect(result.entries).toHaveLength(1);
    expect(result.rejected).toHaveLength(0);
  });

  it('refuses the entire file when body_name does not match the active body', () => {
    const csv = [
      'first_name,last_name,grad_year,email,body_name,body_type',
      'Avery,Chen,2028,achen28@stjohnschs.org,Chess Club,club',
    ].join('\n');

    expect(() => parseRosterCsvText(csv, roboticsBody)).toThrow(RosterFormatError);
    expect(() => parseRosterCsvText(csv, roboticsBody)).toThrow('Chess Club');
    expect(() => parseRosterCsvText(csv, roboticsBody)).toThrow('Robotics');
  });

  it('refuses the entire file when body_type does not match', () => {
    const csv = [
      'first_name,last_name,grad_year,email,body_name,body_type',
      'Avery,Chen,2028,achen28@stjohnschs.org,Robotics,team',
    ].join('\n');

    expect(() => parseRosterCsvText(csv, roboticsBody)).toThrow(RosterFormatError);
    expect(() => parseRosterCsvText(csv, roboticsBody)).toThrow('team');
    expect(() => parseRosterCsvText(csv, roboticsBody)).toThrow('club');
  });

  it('accepts body_name and body_type case-insensitively', () => {
    const csv = [
      'first_name,last_name,grad_year,email,body_name,body_type',
      'Avery,Chen,2028,achen28@stjohnschs.org,ROBOTICS,CLUB',
    ].join('\n');

    const result = parseRosterCsvText(csv, roboticsBody);
    expect(result.entries).toHaveLength(1);
  });

  it('skips body validation when body columns are present but empty', () => {
    const csv = [
      'first_name,last_name,grad_year,email,body_name,body_type',
      'Avery,Chen,2028,achen28@stjohnschs.org,,',
    ].join('\n');

    const result = parseRosterCsvText(csv, roboticsBody);
    expect(result.entries).toHaveLength(1);
  });

  it('matches the active body even when its name carries a trailing space', () => {
    const paddedBody: AttendanceBody = { ...roboticsBody, name: 'Robotics ' };
    const csv = [
      'first_name,last_name,grad_year,email,body_name,body_type',
      'Avery,Chen,2028,achen28@stjohnschs.org,Robotics,club',
    ].join('\n');

    const result = parseRosterCsvText(csv, paddedBody);

    expect(result.rejected).toEqual([]);
    expect(result.entries).toHaveLength(1);
  });

  it('skips body validation entirely when no activeBody is supplied', () => {
    const csv = [
      'first_name,last_name,grad_year,email,body_name,body_type',
      'Avery,Chen,2028,achen28@stjohnschs.org,Chess Club,team',
    ].join('\n');

    const result = parseRosterCsvText(csv);
    expect(result.entries).toHaveLength(1);
  });

  it('derives an email when the column is absent or blank', () => {
    const csv = ['first_name,last_name,grad_year', 'Avery,Chen,2028'].join('\n');

    const result = parseRosterCsvText(csv);
    expect(result.entries[0].email).toBe('achen28@stjohnschs.org');
  });

  it('refuses a row with a bad graduation year', () => {
    const csv = [
      'first_name,last_name,grad_year,email',
      'Avery,Chen,not-a-year,achen28@stjohnschs.org',
    ].join('\n');

    const result = parseRosterCsvText(csv);
    expect(result.entries).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].row).toBe(2);
  });

  it('refuses a row with a non-school-domain email', () => {
    const csv = [
      'first_name,last_name,grad_year,email',
      'Avery,Chen,2028,avery@gmail.com',
    ].join('\n');

    const result = parseRosterCsvText(csv);
    expect(result.entries).toHaveLength(0);
    expect(result.rejected[0].reason).toContain('stjohnschs.org');
    // Reason must not name the student
    expect(result.rejected[0].reason).not.toContain('avery@gmail.com');
    expect(result.rejected[0].reason).not.toContain('Avery');
  });

  it('refuses a row with a duplicate email within the file', () => {
    const csv = [
      'first_name,last_name,grad_year,email',
      'Avery,Chen,2028,achen28@stjohnschs.org',
      'Avery,Chen,2028,achen28@stjohnschs.org',
    ].join('\n');

    const result = parseRosterCsvText(csv);
    expect(result.entries).toHaveLength(1);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].row).toBe(3);
  });

  it('skips blank lines without counting them as refused', () => {
    const csv = [
      'first_name,last_name,grad_year,email',
      'Avery,Chen,2028,achen28@stjohnschs.org',
      '',
      '   ',
    ].join('\n');

    const result = parseRosterCsvText(csv);
    expect(result.entries).toHaveLength(1);
    expect(result.rejected).toHaveLength(0);
  });

  it('handles CRLF line endings', () => {
    const csv =
      'first_name,last_name,grad_year,email\r\nAvery,Chen,2028,achen28@stjohnschs.org\r\n';

    const result = parseRosterCsvText(csv);
    expect(result.entries).toHaveLength(1);
  });

  it('handles quoted fields containing commas', () => {
    const csv = [
      'first_name,last_name,grad_year,email',
      '"Van, Ness",Avery,2028,achen28@stjohnschs.org',
    ].join('\n');

    const result = parseRosterCsvText(csv);
    expect(result.entries[0].firstName).toBe('Van, Ness');
  });

  it('throws RosterFormatError for an empty file', () => {
    expect(() => parseRosterCsvText('')).toThrow(RosterFormatError);
  });

  it('throws RosterFormatError when required columns are missing', () => {
    const csv = ['name,year', 'Avery,2028'].join('\n');
    expect(() => parseRosterCsvText(csv)).toThrow(RosterFormatError);
    expect(() => parseRosterCsvText(csv)).toThrow('first_name');
  });

  it('also accepts Title Case and xlsx-style header spellings', () => {
    const csv = [
      'First Name,Last Name,Graduation Year,Email',
      'Avery,Chen,2028,achen28@stjohnschs.org',
    ].join('\n');

    const result = parseRosterCsvText(csv);
    expect(result.entries).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// .nfc-pack JSON parsing
// ---------------------------------------------------------------------------

describe('parseNfcPackJson', () => {
  it('parses a valid v1 pack', () => {
    const pack = {
      v: 1,
      body: { name: 'Robotics', typeLabel: 'club' },
      members: [
        { first_name: 'Avery', last_name: 'Chen', grad_year: 2028, email: 'achen28@stjohnschs.org' },
        { first_name: 'Jordan', last_name: 'Lee', grad_year: 2027, email: 'jlee27@stjohnschs.org' },
      ],
    };

    const result = parseNfcPackJson(pack, roboticsBody);

    expect(result.entries).toHaveLength(2);
    expect(result.rejected).toHaveLength(0);
    expect(result.cardsIgnored).toBe(0);
    expect(result.entries[0]).toEqual({
      firstName: 'Avery',
      lastName: 'Chen',
      gradYear: 2028,
      email: 'achen28@stjohnschs.org',
    });
  });

  it('accepts an unsigned pack without error', () => {
    const pack = {
      v: 1,
      body: { name: 'Robotics', typeLabel: 'club' },
      members: [{ first_name: 'Avery', last_name: 'Chen', grad_year: 2028, email: 'achen28@stjohnschs.org' }],
    };

    expect(() => parseNfcPackJson(pack)).not.toThrow();
  });

  it('accepts a pack with a signature field without throwing', () => {
    const pack = {
      v: 1,
      body: { name: 'Robotics', typeLabel: 'club' },
      members: [{ first_name: 'Avery', last_name: 'Chen', grad_year: 2028, email: 'achen28@stjohnschs.org' }],
      signature: { alg: 'ed25519', keyId: 'thirdline-roster-1', sig: 'fake-sig' },
    };

    // Signature verification is a no-op until a key store is wired in.
    expect(() => parseNfcPackJson(pack)).not.toThrow();
  });

  it('refuses the entire pack when body name does not match', () => {
    const pack = {
      v: 1,
      body: { name: 'Chess Club', typeLabel: 'club' },
      members: [{ first_name: 'Avery', last_name: 'Chen', grad_year: 2028, email: 'achen28@stjohnschs.org' }],
    };

    expect(() => parseNfcPackJson(pack, roboticsBody)).toThrow(RosterFormatError);
    expect(() => parseNfcPackJson(pack, roboticsBody)).toThrow('Chess Club');
    expect(() => parseNfcPackJson(pack, roboticsBody)).toThrow('Robotics');
  });

  it('refuses the entire pack when body typeLabel does not match', () => {
    const pack = {
      v: 1,
      body: { name: 'Robotics', typeLabel: 'team' },
      members: [{ first_name: 'Avery', last_name: 'Chen', grad_year: 2028, email: 'achen28@stjohnschs.org' }],
    };

    expect(() => parseNfcPackJson(pack, roboticsBody)).toThrow(RosterFormatError);
  });

  it('accepts body name and typeLabel case-insensitively', () => {
    const pack = {
      v: 1,
      body: { name: 'ROBOTICS', typeLabel: 'CLUB' },
      members: [{ first_name: 'Avery', last_name: 'Chen', grad_year: 2028, email: 'achen28@stjohnschs.org' }],
    };

    const result = parseNfcPackJson(pack, roboticsBody);
    expect(result.entries).toHaveLength(1);
  });

  it('derives email when absent from a member entry', () => {
    const pack = {
      v: 1,
      body: { name: 'Robotics', typeLabel: 'club' },
      members: [{ first_name: 'Avery', last_name: 'Chen', grad_year: 2028 }],
    };

    const result = parseNfcPackJson(pack);
    expect(result.entries[0].email).toBe('achen28@stjohnschs.org');
  });

  it('refuses a member entry with a bad grad_year type', () => {
    const pack = {
      v: 1,
      body: { name: 'Robotics', typeLabel: 'club' },
      members: [{ first_name: 'Avery', last_name: 'Chen', grad_year: 'twenty-twenty-eight', email: 'achen28@stjohnschs.org' }],
    };

    const result = parseNfcPackJson(pack);
    expect(result.entries).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
  });

  it('refuses a member entry with duplicate email within the pack', () => {
    const pack = {
      v: 1,
      body: { name: 'Robotics', typeLabel: 'club' },
      members: [
        { first_name: 'Avery', last_name: 'Chen', grad_year: 2028, email: 'achen28@stjohnschs.org' },
        { first_name: 'Avery', last_name: 'Chen', grad_year: 2028, email: 'achen28@stjohnschs.org' },
      ],
    };

    const result = parseNfcPackJson(pack);
    expect(result.entries).toHaveLength(1);
    expect(result.rejected).toHaveLength(1);
  });

  it('throws RosterFormatError for non-v1 input', () => {
    expect(() => parseNfcPackJson({ v: 2, body: {}, members: [] })).toThrow(RosterFormatError);
    expect(() => parseNfcPackJson(null)).toThrow(RosterFormatError);
    expect(() => parseNfcPackJson('not an object')).toThrow(RosterFormatError);
  });

  it('throws RosterFormatError when body field is missing', () => {
    expect(() => parseNfcPackJson({ v: 1, members: [] })).toThrow(RosterFormatError);
    expect(() => parseNfcPackJson({ v: 1, members: [] })).toThrow('body');
  });

  it('throws RosterFormatError when members field is missing', () => {
    expect(() =>
      parseNfcPackJson({ v: 1, body: { name: 'Robotics', typeLabel: 'club' } }),
    ).toThrow(RosterFormatError);
    expect(() =>
      parseNfcPackJson({ v: 1, body: { name: 'Robotics', typeLabel: 'club' } }),
    ).toThrow('members');
  });

  it('never includes a student name in a rejected reason', () => {
    const pack = {
      v: 1,
      body: { name: 'Robotics', typeLabel: 'club' },
      members: [
        { first_name: 'Avery', last_name: 'Chen', grad_year: 2028, email: 'achen28@gmail.com' },
      ],
    };

    const result = parseNfcPackJson(pack);
    const reasons = result.rejected.map((r) => r.reason).join(' ');
    expect(reasons).not.toContain('Avery');
    expect(reasons).not.toContain('Chen');
    expect(reasons).not.toContain('achen28@gmail.com');
  });
});
