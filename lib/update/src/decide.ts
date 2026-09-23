import { isNewerVersion, stripVersionPrefix } from './version';
import type { ReleaseAsset, ReleaseMetadata } from './types';

export type AppTarget = 'web' | 'capacitor' | 'electron';

const APP_ASSET_EXTENSION: Record<AppTarget, string | null> = {
  web: null,
  capacitor: '.apk',
  electron: '.dmg',
};

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The `.sha256` sidecar this repo's `pack.mjs` publishes beside every packed asset. */
export function findSidecarAsset(
  assets: ReleaseAsset[],
  forAssetName: string,
): ReleaseAsset | undefined {
  return assets.find((asset) => asset.name === `${forAssetName}.sha256`);
}

/** The installer asset for this build's shell — `null` for `web`, which has no installer to fetch. */
export function findAppAsset(assets: ReleaseAsset[], target: AppTarget): ReleaseAsset | undefined {
  const extension = APP_ASSET_EXTENSION[target];
  if (!extension) return undefined;
  return assets.find((asset) => asset.name.toLowerCase().endsWith(extension));
}

export type ThemeAssetMatch = {
  asset: ReleaseAsset;
  version: string;
};

/**
 * The newest `.nfc-theme` asset for `themeId`, matching this repo's packing
 * convention (`<theme-id>-v<version>.nfc-theme`, from `lib/themes/scripts/pack.mjs`).
 * Several versions may be attached to one release; the newest wins.
 */
export function findThemeAsset(assets: ReleaseAsset[], themeId: string): ThemeAssetMatch | undefined {
  const pattern = new RegExp(`^${escapeForRegex(themeId)}-v(.+)\\.nfc-theme$`);
  let best: ThemeAssetMatch | undefined;

  for (const asset of assets) {
    const match = asset.name.match(pattern);
    if (!match) continue;
    const version = match[1];
    if (!best || isNewerVersion(version, best.version)) {
      best = { asset, version };
    }
  }

  return best;
}

export type AppUpdateDecision =
  | {
      available: true;
      latestVersion: string;
      asset: ReleaseAsset;
      sidecarAsset: ReleaseAsset | undefined;
      releaseUrl: string;
    }
  | { available: false; reason: 'not-applicable' | 'no-asset' | 'up-to-date' };

/**
 * `web` is never "available": a PWA has no separate installer to fetch, and
 * ships itself. `capacitor`/`electron` compare the release tag against the
 * running app's version and, when newer, point at the matching installer
 * asset (and its sidecar, if published).
 */
export function decideAppUpdate(
  currentVersion: string,
  target: AppTarget,
  release: ReleaseMetadata,
): AppUpdateDecision {
  if (target === 'web') return { available: false, reason: 'not-applicable' };

  const asset = findAppAsset(release.assets, target);
  if (!asset) return { available: false, reason: 'no-asset' };

  const latestVersion = stripVersionPrefix(release.tag);
  if (!isNewerVersion(latestVersion, currentVersion)) {
    return { available: false, reason: 'up-to-date' };
  }

  return {
    available: true,
    latestVersion,
    asset,
    sidecarAsset: findSidecarAsset(release.assets, asset.name),
    releaseUrl: release.htmlUrl,
  };
}

export type ThemeUpdateDecision =
  | {
      available: true;
      latestVersion: string;
      asset: ReleaseAsset;
      sidecarAsset: ReleaseAsset | undefined;
      releaseUrl: string;
    }
  | { available: false; reason: 'default-theme' | 'no-asset' | 'up-to-date' };

/**
 * Metadata-only decision: whether a newer pack for the *currently active*
 * theme id is attached to the release. Whether that pack's `minAppVersion`
 * permits installing it on this app version can only be known after the pack
 * is downloaded and parsed — see the app-layer install flow, which checks it
 * before calling `installPack`.
 */
export function decideThemeUpdate(
  currentThemeId: string,
  currentThemeVersion: string,
  release: ReleaseMetadata,
): ThemeUpdateDecision {
  if (currentThemeId === 'default') return { available: false, reason: 'default-theme' };

  const found = findThemeAsset(release.assets, currentThemeId);
  if (!found) return { available: false, reason: 'no-asset' };

  if (!isNewerVersion(found.version, currentThemeVersion)) {
    return { available: false, reason: 'up-to-date' };
  }

  return {
    available: true,
    latestVersion: found.version,
    asset: found.asset,
    sidecarAsset: findSidecarAsset(release.assets, found.asset.name),
    releaseUrl: release.htmlUrl,
  };
}
