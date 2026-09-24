import { describe, expect, it } from 'vitest';
import {
  decideAppUpdate,
  decideThemeUpdate,
  findAppAsset,
  findSidecarAsset,
  findThemeAsset,
} from '../src/decide';
import type { ReleaseAsset, ReleaseMetadata } from '../src/types';

function asset(name: string, overrides: Partial<ReleaseAsset> = {}): ReleaseAsset {
  return {
    name,
    apiUrl: `https://api.github.com/repos/Thirdline-LLC/NFC-Attendance-Scanner/releases/assets/${name}`,
    browserDownloadUrl: `https://github.com/Thirdline-LLC/NFC-Attendance-Scanner/releases/download/v1.2.0/${name}`,
    size: 1024,
    ...overrides,
  };
}

function release(assets: ReleaseAsset[], tag = 'v1.2.0'): ReleaseMetadata {
  return {
    tag,
    htmlUrl: 'https://github.com/Thirdline-LLC/NFC-Attendance-Scanner/releases/tag/' + tag,
    publishedAt: null,
    assets,
  };
}

describe('findAppAsset', () => {
  it('picks the .dmg for electron and the .apk for capacitor', () => {
    const assets = [asset('tapin.dmg'), asset('tapin.apk'), asset('tapin-sjc-v1.0.0.nfc-theme')];
    expect(findAppAsset(assets, 'electron')?.name).toBe('tapin.dmg');
    expect(findAppAsset(assets, 'capacitor')?.name).toBe('tapin.apk');
  });

  it('never returns an asset for web — a PWA has no installer', () => {
    const assets = [asset('tapin.dmg'), asset('tapin.apk')];
    expect(findAppAsset(assets, 'web')).toBeUndefined();
  });

  it('prefers the arm64 disk image when both architectures were published', () => {
    const assets = [
      asset('SJC Attendance-1.0.1-x64.dmg'),
      asset('SJC Attendance-1.0.1-arm64.dmg'),
      asset('SJC Attendance-1.0.1-arm64.dmg.sha256'),
    ];
    expect(findAppAsset(assets, 'electron', 'arm64')?.name).toBe(
      'SJC Attendance-1.0.1-arm64.dmg',
    );
    expect(findAppAsset(assets, 'electron', 'x64')?.name).toBe(
      'SJC Attendance-1.0.1-x64.dmg',
    );
  });

  it('refuses an x64-only disk image on an arm64 Mac', () => {
    const assets = [asset('SJC Attendance-1.0.1-x64.dmg')];
    expect(findAppAsset(assets, 'electron', 'arm64')).toBeUndefined();
  });

  it('accepts a single unscoped disk image for arm64', () => {
    const assets = [asset('SJC Attendance-1.0.1.dmg')];
    expect(findAppAsset(assets, 'electron', 'arm64')?.name).toBe('SJC Attendance-1.0.1.dmg');
  });
});

describe('findThemeAsset', () => {
  it('matches this repo\'s pack.mjs naming convention and picks the newest version', () => {
    const assets = [
      asset('tapin-sjc-v1.0.0.nfc-theme'),
      asset('tapin-sjc-v1.2.0.nfc-theme'),
      asset('tapin-sjc-v1.1.0.nfc-theme'),
      asset('other-org-v9.0.0.nfc-theme'),
    ];
    const found = findThemeAsset(assets, 'tapin-sjc');
    expect(found?.version).toBe('1.2.0');
    expect(found?.asset.name).toBe('tapin-sjc-v1.2.0.nfc-theme');
  });

  it('returns undefined when no pack matches the theme id', () => {
    expect(findThemeAsset([asset('other-org-v1.0.0.nfc-theme')], 'tapin-sjc')).toBeUndefined();
  });
});

describe('findSidecarAsset', () => {
  it('finds the .sha256 sidecar by exact name', () => {
    const assets = [asset('tapin.dmg'), asset('tapin.dmg.sha256')];
    expect(findSidecarAsset(assets, 'tapin.dmg')?.name).toBe('tapin.dmg.sha256');
  });

  it('returns undefined when no sidecar was published', () => {
    expect(findSidecarAsset([asset('tapin.dmg')], 'tapin.dmg')).toBeUndefined();
  });
});

describe('decideAppUpdate', () => {
  it('is never available for web', () => {
    const rel = release([asset('tapin.dmg')]);
    expect(decideAppUpdate('1.0.0', 'web', rel)).toEqual({
      available: false,
      reason: 'not-applicable',
    });
  });

  it('is available when the release tag is newer than the running app', () => {
    const rel = release([asset('tapin.dmg'), asset('tapin.dmg.sha256')], 'v2.0.0');
    const decision = decideAppUpdate('1.0.0', 'electron', rel);
    expect(decision).toEqual({
      available: true,
      latestVersion: '2.0.0',
      asset: asset('tapin.dmg'),
      sidecarAsset: asset('tapin.dmg.sha256'),
      releaseUrl: rel.htmlUrl,
    });
  });

  it('is up-to-date when the release tag is not newer', () => {
    const rel = release([asset('tapin.dmg')], 'v1.0.0');
    expect(decideAppUpdate('1.0.0', 'electron', rel)).toEqual({
      available: false,
      reason: 'up-to-date',
    });
  });

  it('reports no-asset when the target has no matching installer attached', () => {
    const rel = release([asset('tapin.apk')], 'v2.0.0');
    expect(decideAppUpdate('1.0.0', 'electron', rel)).toEqual({
      available: false,
      reason: 'no-asset',
    });
  });

  it('reports no-asset when the only disk image is the wrong architecture', () => {
    const rel = release([asset('SJC Attendance-1.0.1-x64.dmg')], 'v1.0.1');
    expect(decideAppUpdate('1.0.0', 'electron', rel, 'arm64')).toEqual({
      available: false,
      reason: 'no-asset',
    });
  });

  it('points an arm64 Mac at the arm64 disk image and its sidecar', () => {
    const dmg = 'SJC Attendance-1.0.1-arm64.dmg';
    const rel = release([asset(dmg), asset(`${dmg}.sha256`), asset('SJC Attendance-1.0.1-x64.dmg')], 'v1.0.1');
    const decision = decideAppUpdate('1.0.0', 'electron', rel, 'arm64');
    expect(decision).toEqual({
      available: true,
      latestVersion: '1.0.1',
      asset: asset(dmg),
      sidecarAsset: asset(`${dmg}.sha256`),
      releaseUrl: rel.htmlUrl,
    });
  });
});

describe('decideThemeUpdate', () => {
  it('is never available for the default theme — nothing to compare against', () => {
    const rel = release([asset('tapin-sjc-v2.0.0.nfc-theme')]);
    expect(decideThemeUpdate('default', '1.0.0', rel)).toEqual({
      available: false,
      reason: 'default-theme',
    });
  });

  it('is available when a newer pack for the active theme id is attached', () => {
    const rel = release([
      asset('tapin-sjc-v1.1.0.nfc-theme'),
      asset('tapin-sjc-v1.1.0.nfc-theme.sha256'),
    ]);
    const decision = decideThemeUpdate('tapin-sjc', '1.0.0', rel);
    expect(decision).toEqual({
      available: true,
      latestVersion: '1.1.0',
      asset: asset('tapin-sjc-v1.1.0.nfc-theme'),
      sidecarAsset: asset('tapin-sjc-v1.1.0.nfc-theme.sha256'),
      releaseUrl: rel.htmlUrl,
    });
  });

  it('is up-to-date when the attached pack is the same version already active', () => {
    const rel = release([asset('tapin-sjc-v1.0.0.nfc-theme')]);
    expect(decideThemeUpdate('tapin-sjc', '1.0.0', rel)).toEqual({
      available: false,
      reason: 'up-to-date',
    });
  });

  it('reports no-asset when this release has no pack for the active theme', () => {
    const rel = release([asset('other-org-v1.0.0.nfc-theme')]);
    expect(decideThemeUpdate('tapin-sjc', '1.0.0', rel)).toEqual({
      available: false,
      reason: 'no-asset',
    });
  });
});
