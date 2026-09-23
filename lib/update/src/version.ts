/** Strips a leading `v` — Release tags are `v1.2.0`; app/theme `meta.version` fields are not. */
export function stripVersionPrefix(version: string): string {
  return version.startsWith('v') || version.startsWith('V') ? version.slice(1) : version;
}

/**
 * Compares two `major.minor.patch`-shaped versions. Missing segments count as
 * zero, so `1.2` equals `1.2.0`. Non-numeric segments fall back to a string
 * comparison rather than throwing — a malformed version should compare
 * consistently, not crash the update check.
 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const segmentsA = stripVersionPrefix(a).split('.');
  const segmentsB = stripVersionPrefix(b).split('.');
  const length = Math.max(segmentsA.length, segmentsB.length);

  for (let i = 0; i < length; i++) {
    const rawA = segmentsA[i] ?? '0';
    const rawB = segmentsB[i] ?? '0';
    const numA = Number(rawA);
    const numB = Number(rawB);

    if (Number.isFinite(numA) && Number.isFinite(numB)) {
      if (numA !== numB) return numA < numB ? -1 : 1;
    } else if (rawA !== rawB) {
      return rawA < rawB ? -1 : 1;
    }
  }

  return 0;
}

/** True when `candidate` is a strictly newer version than `current`. */
export function isNewerVersion(candidate: string, current: string): boolean {
  return compareVersions(candidate, current) > 0;
}
