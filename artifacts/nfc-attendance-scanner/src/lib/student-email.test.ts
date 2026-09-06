import { describe, expect, it } from 'vitest';

import {
  deriveStudentEmail,
  findEmailOwner,
  isSchoolDomainEmail,
  isValidSchoolEmail,
  nextAvailableEmail,
  normalizeGraduationYear,
  normalizeNamePart,
  SCHOOL_EMAIL_DOMAIN,
} from './student-email';

describe('normalizeNamePart', () => {
  it('lowercases and strips surrounding whitespace', () => {
    expect(normalizeNamePart('  Smith  ')).toBe('smith');
    expect(normalizeNamePart('MCDONALD')).toBe('mcdonald');
  });

  it('folds accented characters to their base letter', () => {
    expect(normalizeNamePart('Núñez')).toBe('nunez');
    expect(normalizeNamePart('Élodie')).toBe('elodie');
    expect(normalizeNamePart('Ångström')).toBe('angstrom');
  });

  it('removes spaces, hyphens, apostrophes and other punctuation', () => {
    expect(normalizeNamePart('Van Der Berg')).toBe('vanderberg');
    expect(normalizeNamePart('Smith-Jones')).toBe('smithjones');
    expect(normalizeNamePart("O'Brien")).toBe('obrien');
    expect(normalizeNamePart('St. John')).toBe('stjohn');
    expect(normalizeNamePart('Nguyen Jr.')).toBe('nguyenjr');
    expect(normalizeNamePart('Smith 2')).toBe('smith');
  });

  it('returns an empty string when there are no letters', () => {
    expect(normalizeNamePart('   ')).toBe('');
    expect(normalizeNamePart('---')).toBe('');
  });
});

describe('normalizeGraduationYear', () => {
  it('takes the last two digits of a 4-digit year', () => {
    expect(normalizeGraduationYear(2027)).toBe('27');
    expect(normalizeGraduationYear('2027')).toBe('27');
    expect(normalizeGraduationYear('2005')).toBe('05');
  });

  it('accepts 2-digit years, with or without a leading apostrophe', () => {
    expect(normalizeGraduationYear('27')).toBe('27');
    expect(normalizeGraduationYear("'27")).toBe('27');
    expect(normalizeGraduationYear(' 27 ')).toBe('27');
    expect(normalizeGraduationYear('09')).toBe('09');
  });

  it('rejects years that are neither 2 nor 4 digits', () => {
    expect(() => normalizeGraduationYear('')).toThrow(/Invalid graduation year/);
    expect(() => normalizeGraduationYear('7')).toThrow(
      /Invalid graduation year/,
    );
    expect(() => normalizeGraduationYear('202')).toThrow(
      /Invalid graduation year/,
    );
    expect(() => normalizeGraduationYear('20277')).toThrow(
      /Invalid graduation year/,
    );
    expect(() => normalizeGraduationYear('class of')).toThrow(
      /Invalid graduation year/,
    );
  });
});

describe('deriveStudentEmail', () => {
  it('builds [first initial][last name][yy]@stjohnschs.org', () => {
    expect(deriveStudentEmail('Jane', 'Smith', 2027)).toBe(
      'jsmith27@stjohnschs.org',
    );
  });

  it('lowercases the entire output', () => {
    expect(deriveStudentEmail('JANE', 'SMITH', '2027')).toBe(
      'jsmith27@stjohnschs.org',
    );
  });

  it('trims surrounding whitespace on every field', () => {
    expect(deriveStudentEmail('  Jane  ', '  Smith  ', ' 2027 ')).toBe(
      'jsmith27@stjohnschs.org',
    );
  });

  it('collapses compound last names into a single token', () => {
    expect(deriveStudentEmail('Elena', 'Van Der Berg', 2027)).toBe(
      'evanderberg27@stjohnschs.org',
    );
    expect(deriveStudentEmail('Luis', 'De La Cruz', '28')).toBe(
      'ldelacruz28@stjohnschs.org',
    );
  });

  it('collapses hyphenated last names', () => {
    expect(deriveStudentEmail('Ada', 'Smith-Jones', 2026)).toBe(
      'asmithjones26@stjohnschs.org',
    );
  });

  it('uses the initial of a compound or hyphenated first name', () => {
    expect(deriveStudentEmail('Mary Anne', 'Wilson', 2027)).toBe(
      'mwilson27@stjohnschs.org',
    );
    expect(deriveStudentEmail('Jean-Luc', 'Picard', 2029)).toBe(
      'jpicard29@stjohnschs.org',
    );
  });

  it('strips accents and apostrophes from names', () => {
    expect(deriveStudentEmail('José', 'Núñez', 2027)).toBe(
      'jnunez27@stjohnschs.org',
    );
    expect(deriveStudentEmail('Élodie', "O'Brien", '27')).toBe(
      'eobrien27@stjohnschs.org',
    );
  });

  it('treats 2-digit and 4-digit graduation years identically', () => {
    expect(deriveStudentEmail('Jane', 'Smith', '27')).toBe(
      deriveStudentEmail('Jane', 'Smith', 2027),
    );
    expect(deriveStudentEmail('Jane', 'Smith', "'27")).toBe(
      'jsmith27@stjohnschs.org',
    );
  });

  it('pads single-letter last names into a valid address', () => {
    expect(deriveStudentEmail('Malcolm', 'X', 2027)).toBe(
      'mx27@stjohnschs.org',
    );
  });

  it('throws when a name field has no usable letters', () => {
    expect(() => deriveStudentEmail('', 'Smith', 2027)).toThrow(
      /Invalid first name/,
    );
    expect(() => deriveStudentEmail('   ', 'Smith', 2027)).toThrow(
      /Invalid first name/,
    );
    expect(() => deriveStudentEmail('Jane', '  ', 2027)).toThrow(
      /Invalid last name/,
    );
    expect(() => deriveStudentEmail('Jane', '123', 2027)).toThrow(
      /Invalid last name/,
    );
  });

  it('propagates an invalid graduation year', () => {
    expect(() => deriveStudentEmail('Jane', 'Smith', '202')).toThrow(
      /Invalid graduation year/,
    );
  });

  it('always produces an address that passes validation', () => {
    const students: Array<[string, string, string | number]> = [
      ['Jane', 'Smith', 2027],
      ['José', 'Núñez', "'28"],
      ['Mary Anne', 'Van Der Berg', '29'],
      ['Jean-Luc', "O'Brien-Smith", 2030],
    ];

    for (const [first, last, year] of students) {
      expect(isValidSchoolEmail(deriveStudentEmail(first, last, year))).toBe(
        true,
      );
    }
  });
});

describe('isValidSchoolEmail', () => {
  it('accepts well-formed school addresses', () => {
    expect(isValidSchoolEmail('jsmith27@stjohnschs.org')).toBe(true);
    expect(isValidSchoolEmail('evanderberg05@stjohnschs.org')).toBe(true);
  });

  it('trims and lowercases before validating', () => {
    expect(isValidSchoolEmail('  JSmith27@StJohnsCHS.org  ')).toBe(true);
  });

  it('rejects addresses in another domain', () => {
    expect(isValidSchoolEmail('jsmith27@gmail.com')).toBe(false);
    expect(isValidSchoolEmail('jsmith27@sub.stjohnschs.org')).toBe(false);
    expect(isValidSchoolEmail('jsmith27@stjohnschs.org.evil.com')).toBe(false);
  });

  it('rejects a missing or malformed year suffix', () => {
    expect(isValidSchoolEmail('jsmith@stjohnschs.org')).toBe(false);
    expect(isValidSchoolEmail('jsmith2027@stjohnschs.org')).toBe(false);
    expect(isValidSchoolEmail('jsmith7@stjohnschs.org')).toBe(false);
  });

  it('rejects a missing name, stray characters or a missing address', () => {
    expect(isValidSchoolEmail('27@stjohnschs.org')).toBe(false);
    expect(isValidSchoolEmail('j27@stjohnschs.org')).toBe(false);
    expect(isValidSchoolEmail('j.smith27@stjohnschs.org')).toBe(false);
    expect(isValidSchoolEmail('j smith27@stjohnschs.org')).toBe(false);
    expect(isValidSchoolEmail('')).toBe(false);
    expect(isValidSchoolEmail('stjohnschs.org')).toBe(false);
  });
});

describe('SCHOOL_EMAIL_DOMAIN', () => {
  it('is the institutional domain', () => {
    expect(SCHOOL_EMAIL_DOMAIN).toBe('stjohnschs.org');
  });
});

describe('isSchoolDomainEmail', () => {
  it('accepts any well-formed local part in the school domain', () => {
    expect(isSchoolDomainEmail('jsmith27@stjohnschs.org')).toBe(true);
    expect(isSchoolDomainEmail('jane.smith@stjohnschs.org')).toBe(true);
    expect(isSchoolDomainEmail('jsmith271@stjohnschs.org')).toBe(true);
    expect(isSchoolDomainEmail('j-smith+alerts@stjohnschs.org')).toBe(true);
  });

  it('accepts everything the formula produces', () => {
    expect(isSchoolDomainEmail(deriveStudentEmail('Jane', 'Smith', 2027))).toBe(
      true,
    );
    expect(isSchoolDomainEmail(deriveStudentEmail('Malcolm', 'X', 2027))).toBe(
      true,
    );
  });

  it('trims and lowercases before validating', () => {
    expect(isSchoolDomainEmail('  Jane.Smith@StJohnsCHS.org  ')).toBe(true);
  });

  it('rejects addresses in another domain', () => {
    expect(isSchoolDomainEmail('jsmith27@gmail.com')).toBe(false);
    expect(isSchoolDomainEmail('jsmith27@sub.stjohnschs.org')).toBe(false);
    expect(isSchoolDomainEmail('jsmith27@stjohnschs.org.evil.com')).toBe(false);
  });

  it('rejects a missing or malformed local part', () => {
    expect(isSchoolDomainEmail('')).toBe(false);
    expect(isSchoolDomainEmail('stjohnschs.org')).toBe(false);
    expect(isSchoolDomainEmail('@stjohnschs.org')).toBe(false);
    expect(isSchoolDomainEmail('jane smith@stjohnschs.org')).toBe(false);
    expect(isSchoolDomainEmail('.jane@stjohnschs.org')).toBe(false);
    expect(isSchoolDomainEmail('jane..smith@stjohnschs.org')).toBe(false);
  });
});

const roster = [
  { id: 1, email: 'jsmith27@stjohnschs.org' },
  { id: 2, email: 'jsmith271@stjohnschs.org' },
  { id: 3, email: '  ALee28@StJohnsCHS.org  ' },
];

describe('findEmailOwner', () => {
  it('finds the holder of an address', () => {
    expect(findEmailOwner('jsmith27@stjohnschs.org', roster)?.id).toBe(1);
    expect(findEmailOwner('jsmith271@stjohnschs.org', roster)?.id).toBe(2);
  });

  it('returns undefined when nobody holds it', () => {
    expect(findEmailOwner('bnew30@stjohnschs.org', roster)).toBeUndefined();
  });

  it('ignores case and surrounding whitespace on both sides', () => {
    expect(findEmailOwner('  JSmith27@StJohnsCHS.org ', roster)?.id).toBe(1);
    expect(findEmailOwner('alee28@stjohnschs.org', roster)?.id).toBe(3);
  });

  it('never matches an empty address', () => {
    expect(findEmailOwner('', roster)).toBeUndefined();
    expect(findEmailOwner('   ', roster)).toBeUndefined();
  });

  it('excludes the student being edited from their own address', () => {
    expect(findEmailOwner('jsmith27@stjohnschs.org', roster, 1)).toBeUndefined();
    expect(findEmailOwner('jsmith27@stjohnschs.org', roster, 2)?.id).toBe(1);
  });

  it('searches an empty roster without complaint', () => {
    expect(findEmailOwner('jsmith27@stjohnschs.org', [])).toBeUndefined();
  });
});

describe('nextAvailableEmail', () => {
  it('returns the address unchanged when it is free', () => {
    expect(nextAvailableEmail('bnew30@stjohnschs.org', roster)).toBe(
      'bnew30@stjohnschs.org',
    );
  });

  it('appends the lowest free numeric suffix', () => {
    // jsmith27@ and jsmith271@ are both taken, so 2 is the first opening.
    expect(nextAvailableEmail('jsmith27@stjohnschs.org', roster)).toBe(
      'jsmith272@stjohnschs.org',
    );
  });

  it('skips a long run of taken suffixes', () => {
    const crowded = [
      { id: 1, email: 'jsmith27@stjohnschs.org' },
      { id: 2, email: 'jsmith271@stjohnschs.org' },
      { id: 3, email: 'jsmith272@stjohnschs.org' },
      { id: 4, email: 'jsmith273@stjohnschs.org' },
    ];

    expect(nextAvailableEmail('jsmith27@stjohnschs.org', crowded)).toBe(
      'jsmith274@stjohnschs.org',
    );
  });

  it('leaves the address alone when only the student being edited holds it', () => {
    expect(nextAvailableEmail('jsmith27@stjohnschs.org', roster, 1)).toBe(
      'jsmith27@stjohnschs.org',
    );
  });

  it('always produces an address in the school domain', () => {
    expect(
      isSchoolDomainEmail(nextAvailableEmail('jsmith27@stjohnschs.org', roster)),
    ).toBe(true);
  });

  it('passes an empty or malformed address straight through', () => {
    expect(nextAvailableEmail('', roster)).toBe('');
    expect(nextAvailableEmail('not-an-address', roster)).toBe('not-an-address');
  });
});

