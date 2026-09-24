/**
 * Where the running macOS app lives, and which disk image to take from a
 * Release. Pure: no Electron, no `hdiutil`, no filesystem. The main process
 * passes `process.execPath` in and gets a bundle path back — `/Applications`
 * is the common case, not the only one.
 */

import path from 'node:path';

export const EXPECTED_MAC_APP_NAME = 'SJC Attendance.app';

export type HostArch = 'arm64' | 'x64';

/**
 * Packaged macOS layout:
 * `/Applications/SJC Attendance.app/Contents/MacOS/SJC Attendance`
 * The bundle is three directories above the executable.
 */
export function resolveInstalledAppBundle(execPath: string): string | null {
  if (typeof execPath !== 'string' || execPath.length === 0) return null;
  if (execPath.includes('\0')) return null;

  const normalized = path.normalize(execPath);
  const macosDir = path.dirname(normalized);
  const contentsDir = path.dirname(macosDir);
  const bundle = path.dirname(contentsDir);

  if (path.basename(macosDir) !== 'MacOS') return null;
  if (path.basename(contentsDir) !== 'Contents') return null;
  if (!path.basename(bundle).endsWith('.app')) return null;
  return bundle;
}

export type BundleRefusal = 'bundle-unresolved' | 'translocated' | 'read-only-volume';

export type BundleAssessment =
  | { ok: true; bundlePath: string }
  | { ok: false; reason: BundleRefusal };

/**
 * Whether this process may replace its own bundle.
 *
 * App Translocation (a quarantined app opened from Downloads) and a copy
 * still sitting on the DMG are read-only locations. Replacing them would
 * either fail or update a throwaway path. The teacher moves the app to
 * Applications — or any other writable folder — and checks again.
 */
export function assessInstalledBundle(execPath: string): BundleAssessment {
  const bundlePath = resolveInstalledAppBundle(execPath);
  if (!bundlePath) return { ok: false, reason: 'bundle-unresolved' };
  if (bundlePath.includes('/AppTranslocation/')) {
    return { ok: false, reason: 'translocated' };
  }
  if (bundlePath.startsWith('/Volumes/')) {
    return { ok: false, reason: 'read-only-volume' };
  }
  return { ok: true, bundlePath };
}

/** Prefer `SJC Attendance.app`. A disk image with exactly one other `.app` is accepted. */
export function chooseBundledApp(entries: readonly string[]): string | null {
  const apps = entries.filter((name) => {
    if (!name.endsWith('.app')) return false;
    if (name.includes('/') || name.includes('\\') || name.includes('..')) return false;
    return true;
  });
  if (apps.includes(EXPECTED_MAC_APP_NAME)) return EXPECTED_MAC_APP_NAME;
  if (apps.length === 1) return apps[0];
  return null;
}

/**
 * `hdiutil attach -plist` prints one `mount-point` per filesystem. The
 * volume under `/Volumes` is the one that holds the `.app`.
 */
export function parseHdiutilMountPoint(plistXml: string): string | null {
  const points: string[] = [];
  for (const match of plistXml.matchAll(/<key>mount-point<\/key>\s*<string>([^<]*)<\/string>/g)) {
    const point = match[1]?.trim() ?? '';
    if (point.startsWith('/')) points.push(point);
  }
  return points.find((point) => point.startsWith('/Volumes/')) ?? points[0] ?? null;
}

export function hdiutilAttachArgs(dmgPath: string): string[] {
  return ['attach', '-nobrowse', '-readonly', '-plist', dmgPath];
}

export function hdiutilDetachArgs(mountPoint: string): string[] {
  return ['detach', mountPoint, '-force'];
}

function namesArch(name: string, arch: HostArch): boolean {
  if (arch === 'arm64') return /arm64/i.test(name);
  return /(?:^|[^a-z0-9])(x64|x86_64|intel)(?:[^a-z0-9]|$)/i.test(name);
}

/**
 * Installer asset for this shell.
 *
 * For `electron`, an explicit `arch` prefers the matching disk image
 * (`…-arm64.dmg` on the school Macs). A release that published only one
 * unscoped `.dmg` is still used. A release that published only the other
 * architecture is refused — installing it would not run.
 */
export function selectInstallerName(
  names: readonly string[],
  target: 'web' | 'capacitor' | 'electron',
  arch?: HostArch,
): string | undefined {
  const extension = target === 'capacitor' ? '.apk' : target === 'electron' ? '.dmg' : null;
  if (!extension) return undefined;
  const matches = names.filter((name) => name.toLowerCase().endsWith(extension));
  if (matches.length === 0) return undefined;
  if (target !== 'electron' || !arch) return matches[0];

  const preferred = matches.filter((name) => namesArch(name, arch));
  if (preferred.length > 0) return preferred[0];

  const generic = matches.filter((name) => !namesArch(name, 'arm64') && !namesArch(name, 'x64'));
  if (generic.length === 1) return generic[0];
  return undefined;
}
