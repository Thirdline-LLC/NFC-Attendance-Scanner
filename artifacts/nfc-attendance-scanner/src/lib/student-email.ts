/**
 * Derivation and validation of institutional student email addresses.
 *
 * Formula: [first initial][last name][last 2 digits of graduation year]@stjohnschs.org
 * e.g. Élodie Van Der Berg, class of 2027 -> evanderberg27@stjohnschs.org
 */

export const SCHOOL_EMAIL_DOMAIN = 'stjohnschs.org';

const SCHOOL_EMAIL_PATTERN = new RegExp(
  `^[a-z]{2,}[0-9]{2}@${SCHOOL_EMAIL_DOMAIN.replace(/\./g, '\\.')}$`,
);

/**
 * Reduces a name field to the bare lowercase letters used in an address:
 * accents are folded to their base letter, and spaces, hyphens, apostrophes,
 * digits and any other punctuation are dropped.
 */
export function normalizeNamePart(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z]/g, '')
    .toLowerCase();
}

/**
 * Reduces a graduation year to the two digits used in an address. Accepts both
 * 4-digit (2027, "2027") and 2-digit ("27", "'27") forms.
 */
export function normalizeGraduationYear(value: string | number): string {
  const digits = String(value).replace(/[^0-9]/g, '');

  if (digits.length === 2 || digits.length === 4) {
    return digits.slice(-2);
  }

  throw new Error(
    `Invalid graduation year: "${value}". Expected a 2- or 4-digit year.`,
  );
}

/**
 * Builds the institutional email address for a student. Throws when either
 * name field contains no usable letters or the graduation year is unparseable.
 */
export function deriveStudentEmail(
  firstName: string,
  lastName: string,
  graduationYear: string | number,
): string {
  const first = normalizeNamePart(firstName);
  const last = normalizeNamePart(lastName);

  if (!first) {
    throw new Error(`Invalid first name: "${firstName}".`);
  }

  if (!last) {
    throw new Error(`Invalid last name: "${lastName}".`);
  }

  const year = normalizeGraduationYear(graduationYear);

  return `${first[0]}${last}${year}@${SCHOOL_EMAIL_DOMAIN}`;
}

/** True when `email` is a well-formed address in the school's domain. */
export function isValidSchoolEmail(email: string): boolean {
  return SCHOOL_EMAIL_PATTERN.test(email.trim().toLowerCase());
}
