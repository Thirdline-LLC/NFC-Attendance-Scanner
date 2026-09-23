/**
 * Theme persistence via localStorage.
 *
 * Keys:
 *   `nfc-theme:active`          – JSON of the currently active pack, or absent for default.
 *   `nfc-theme:installed:{id}`  – JSON of each installed pack, keyed by meta.id.
 *
 * IndexedDB (Dexie) is never touched — theme install must not wipe student records.
 */

const PREFIX = 'nfc-theme:';
const ACTIVE_KEY = `${PREFIX}active`;

function installedKey(id: string): string {
  return `${PREFIX}installed:${id}`;
}

/** Persist a packed theme as the active theme (replaces any previous active). */
export function storeActiveTheme(packJson: string): void {
  localStorage.setItem(ACTIVE_KEY, packJson);
}

/** Read the active theme JSON, or null if none is stored (use default). */
export function readActiveThemeJson(): string | null {
  return localStorage.getItem(ACTIVE_KEY);
}

/** Remove the active theme override — subsequent boot will use the default. */
export function clearActiveTheme(): void {
  localStorage.removeItem(ACTIVE_KEY);
}

/** Store an installed pack by its id for later listing/activation. */
export function storeInstalledPack(id: string, packJson: string): void {
  localStorage.setItem(installedKey(id), packJson);
}

/** Read a stored pack by id, or null if not installed. */
export function readInstalledPack(id: string): string | null {
  return localStorage.getItem(installedKey(id));
}

/** Remove an installed pack from storage. */
export function removeInstalledPack(id: string): void {
  localStorage.removeItem(installedKey(id));
}

/** List all installed pack ids. */
export function listInstalledPackIds(): string[] {
  const ids: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(`${PREFIX}installed:`)) {
      ids.push(key.slice(`${PREFIX}installed:`.length));
    }
  }
  return ids;
}

/** Read the active theme id from the stored JSON without full parse. */
export function readActiveThemeId(): string {
  const json = readActiveThemeJson();
  if (!json) return 'default';
  try {
    const partial = JSON.parse(json) as { meta?: { id?: string } };
    return partial?.meta?.id ?? 'default';
  } catch {
    return 'default';
  }
}
