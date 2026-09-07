export function normalizeUid(value: string): string {
  return value.replace(/[\s\r\n]/g, '').toUpperCase();
}

export function isValidUid(value: string): boolean {
  return /^[0-9A-F]{14}$/.test(value);
}

/**
 * A card as it is allowed to appear on screen: the last four characters behind
 * a mask. The UID is hardware identity, so the full value never reaches the
 * DOM — every place that names a card goes through here.
 */
export function maskCardUid(uid: string): string {
  return `••••${uid.slice(-4)}`;
}
