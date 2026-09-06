export function normalizeUid(value: string): string {
  return value.replace(/[\s\r\n]/g, '').toUpperCase();
}

export function isValidUid(value: string): boolean {
  return /^[0-9A-F]{14}$/.test(value);
}