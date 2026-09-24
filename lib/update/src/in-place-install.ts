/**
 * Download a verified macOS release and hand it to the detached replacer.
 *
 * Checksum failure stops before anything is written or mounted. The running
 * bundle is not touched in this process — the helper does that after quit,
 * because the `.app` is in use until then.
 */

import path from 'node:path';
import { assessInstalledBundle, chooseBundledApp } from './app-bundle';
import { verifySha256 } from './checksum';
import { renderInPlaceHelperScript, renderInPlaceSwapScript } from './in-place-helper';

export type InPlaceFailureReason =
  | 'unsupported-platform'
  | 'not-packaged'
  | 'bundle-unresolved'
  | 'translocated'
  | 'read-only-volume'
  | 'network'
  | 'http-error'
  | 'checksum'
  | 'mount-failed'
  | 'no-app-in-dmg'
  | 'stage-failed'
  | 'helper-failed';

export type InPlaceInstallResult =
  | { ok: true; phase: 'relaunching'; target: string }
  | { ok: false; reason: InPlaceFailureReason; message: string };

export type FetchedAsset =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; reason: 'network' | 'http-error' };

export type InPlaceProgressPhase = 'downloading' | 'installing' | 'relaunching';

/**
 * The Electron main process fills this in. Tests pass fakes. Nothing here
 * imports Electron, `hdiutil`, or `child_process`.
 */
export type InPlaceHost = {
  platform: string;
  isPackaged: boolean;
  execPath: string;
  pid: number;
  tempRoot: string;
  /** Stamp for the staging directory. Defaults to `Date.now()` when omitted. */
  now?: () => number;
  emit: (progress: { phase: InPlaceProgressPhase }) => void;
  fetchAsset: (url: string) => Promise<FetchedAsset>;
  mkdir: (dir: string) => Promise<void>;
  writeFile: (filePath: string, data: Uint8Array | string, mode?: number) => Promise<void>;
  readDir: (dir: string) => Promise<string[]>;
  copyApp: (from: string, to: string) => Promise<void>;
  remove: (targetPath: string) => Promise<void>;
  attachDmg: (dmgPath: string) => Promise<string>;
  detachDmg: (mountPoint: string) => Promise<void>;
  spawnHelper: (scriptPath: string, args: string[]) => void;
  quit: () => void;
};

export type InPlaceInstallRequest = {
  assetUrl: string;
  sha256Url: string;
};

const MESSAGE: Record<InPlaceFailureReason, string> = {
  'unsupported-platform': 'In-place update is only available in the macOS app.',
  'not-packaged': 'In-place update runs from the installed app, not a development build.',
  'bundle-unresolved': 'Could not find the installed app bundle to replace.',
  translocated:
    'macOS is running this app from a temporary copy. Move SJC Attendance.app into Applications, then check again.',
  'read-only-volume':
    'This app is running from a disk image. Drag it to Applications and open that copy, then check again.',
  network: 'Could not reach GitHub to download this update.',
  'http-error': 'GitHub returned an error while downloading this update.',
  checksum: 'The download did not match its published checksum. Nothing was installed.',
  'mount-failed': 'The downloaded disk image could not be opened. Nothing was installed.',
  'no-app-in-dmg': 'The disk image did not contain the app. Nothing was installed.',
  'stage-failed': 'The update could not be prepared. Nothing was installed.',
  'helper-failed':
    'The update was downloaded but could not be applied. The current app was left in place.',
};

function fail(reason: InPlaceFailureReason): InPlaceInstallResult {
  return { ok: false, reason, message: MESSAGE[reason] };
}

export async function runInPlaceInstall(
  request: InPlaceInstallRequest,
  host: InPlaceHost,
): Promise<InPlaceInstallResult> {
  try {
    return await run(request, host);
  } catch {
    return fail('stage-failed');
  }
}

async function run(
  request: InPlaceInstallRequest,
  host: InPlaceHost,
): Promise<InPlaceInstallResult> {
  if (host.platform !== 'darwin') return fail('unsupported-platform');
  if (!host.isPackaged) return fail('not-packaged');

  const assessed = assessInstalledBundle(host.execPath);
  if (!assessed.ok) return fail(assessed.reason);

  host.emit({ phase: 'downloading' });

  let asset: FetchedAsset;
  let sidecar: FetchedAsset;
  try {
    [asset, sidecar] = await Promise.all([
      host.fetchAsset(request.assetUrl),
      host.fetchAsset(request.sha256Url),
    ]);
  } catch {
    return fail('network');
  }
  if (!asset.ok) return fail(asset.reason);
  if (!sidecar.ok) return fail(sidecar.reason);

  const sidecarText = new TextDecoder().decode(sidecar.bytes);
  const verification = await verifySha256(asset.bytes, sidecarText);
  if (!verification.ok) return fail('checksum');

  host.emit({ phase: 'installing' });

  const stamp = host.now ? host.now() : Date.now();
  const staging = path.join(host.tempRoot, `tapin-update-${host.pid}-${stamp}`);
  const payload = path.join(staging, 'payload');
  const dmgPath = path.join(payload, 'update.dmg');
  const helperPath = path.join(staging, 'replace.sh');
  const swapPath = path.join(staging, 'swap.sh');
  const logPath = path.join(staging, 'replace.log');

  let mountPoint: string | null = null;

  const discard = async () => {
    if (mountPoint) {
      const mounted = mountPoint;
      mountPoint = null;
      try {
        await host.detachDmg(mounted);
      } catch {
        // Already detached, or it never finished mounting.
      }
    }
    try {
      await host.remove(staging);
    } catch {
      // Best effort. A leftover staging dir holds no student data.
    }
  };

  try {
    await host.mkdir(payload);
    await host.writeFile(dmgPath, asset.bytes);
    await host.writeFile(helperPath, renderInPlaceHelperScript(), 0o755);
    await host.writeFile(swapPath, renderInPlaceSwapScript(), 0o755);
  } catch {
    await discard();
    return fail('stage-failed');
  }

  try {
    mountPoint = await host.attachDmg(dmgPath);
  } catch {
    await discard();
    return fail('mount-failed');
  }

  let appName: string | null;
  try {
    appName = chooseBundledApp(await host.readDir(mountPoint));
  } catch {
    await discard();
    return fail('mount-failed');
  }
  if (!appName) {
    await discard();
    return fail('no-app-in-dmg');
  }

  const stagedApp = path.join(payload, appName);
  try {
    await host.copyApp(path.join(mountPoint, appName), stagedApp);
  } catch {
    await discard();
    return fail('stage-failed');
  }

  try {
    await host.detachDmg(mountPoint);
    mountPoint = null;
  } catch {
    await discard();
    return fail('mount-failed');
  }

  try {
    await host.remove(dmgPath);
  } catch {
    // The disk image is optional once the app has been copied out of it.
  }

  host.emit({ phase: 'relaunching' });

  try {
    host.spawnHelper(helperPath, [
      String(host.pid),
      assessed.bundlePath,
      stagedApp,
      logPath,
      swapPath,
    ]);
  } catch {
    await discard();
    return fail('helper-failed');
  }

  host.quit();
  return { ok: true, phase: 'relaunching', target: assessed.bundlePath };
}
