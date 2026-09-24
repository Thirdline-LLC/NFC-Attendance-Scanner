import { describe, expect, it } from 'vitest';
import {
  assessInstalledBundle,
  chooseBundledApp,
  hdiutilAttachArgs,
  hdiutilDetachArgs,
  parseHdiutilMountPoint,
  resolveInstalledAppBundle,
} from '../src/app-bundle';

const APPLICATIONS = '/Applications/SJC Attendance.app/Contents/MacOS/SJC Attendance';

describe('resolveInstalledAppBundle', () => {
  it('resolves the primary /Applications install', () => {
    expect(resolveInstalledAppBundle(APPLICATIONS)).toBe('/Applications/SJC Attendance.app');
  });

  it('resolves an app that was installed somewhere other than /Applications', () => {
    expect(
      resolveInstalledAppBundle(
        '/Users/teacher/Desktop/SJC Attendance.app/Contents/MacOS/SJC Attendance',
      ),
    ).toBe('/Users/teacher/Desktop/SJC Attendance.app');
  });

  it('returns null for an unpackaged electron binary', () => {
    expect(resolveInstalledAppBundle('/usr/local/lib/node_modules/electron/dist/electron')).toBeNull();
    expect(resolveInstalledAppBundle('')).toBeNull();
  });
});

describe('assessInstalledBundle', () => {
  it('accepts a normal installed bundle', () => {
    expect(assessInstalledBundle(APPLICATIONS)).toEqual({
      ok: true,
      bundlePath: '/Applications/SJC Attendance.app',
    });
  });

  it('refuses App Translocation and a copy still running from the disk image', () => {
    expect(
      assessInstalledBundle(
        '/private/var/folders/ab/AppTranslocation/SJC Attendance.app/Contents/MacOS/SJC Attendance',
      ).ok,
    ).toBe(false);
    expect(
      assessInstalledBundle(
        '/private/var/folders/ab/AppTranslocation/SJC Attendance.app/Contents/MacOS/SJC Attendance',
      ),
    ).toMatchObject({ reason: 'translocated' });

    expect(
      assessInstalledBundle('/Volumes/SJC Attendance/SJC Attendance.app/Contents/MacOS/SJC Attendance'),
    ).toMatchObject({ reason: 'read-only-volume' });
  });
});

describe('chooseBundledApp', () => {
  it('prefers SJC Attendance.app when the disk image also has something else', () => {
    expect(chooseBundledApp(['Applications', 'SJC Attendance.app', 'Other.app'])).toBe(
      'SJC Attendance.app',
    );
  });

  it('accepts a single other .app and refuses path tricks', () => {
    expect(chooseBundledApp(['Tapin.app', 'background.png'])).toBe('Tapin.app');
    expect(chooseBundledApp(['../Evil.app', 'Nice.app', 'Also.app'])).toBeNull();
    expect(chooseBundledApp(['../Evil.app'])).toBeNull();
  });
});

describe('hdiutil plist', () => {
  it('reads the /Volumes mount point and asks for a read-only nobrowse attach', () => {
    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
  <key>system-entities</key>
  <array>
    <dict>
      <key>mount-point</key>
      <string>/dev/disk4</string>
    </dict>
    <dict>
      <key>mount-point</key>
      <string>/Volumes/SJC Attendance</string>
    </dict>
  </array>
</dict></plist>`;
    expect(parseHdiutilMountPoint(plist)).toBe('/Volumes/SJC Attendance');
    expect(hdiutilAttachArgs('/tmp/update.dmg')).toEqual([
      'attach',
      '-nobrowse',
      '-readonly',
      '-plist',
      '/tmp/update.dmg',
    ]);
    expect(hdiutilDetachArgs('/Volumes/SJC Attendance')).toEqual([
      'detach',
      '/Volumes/SJC Attendance',
      '-force',
    ]);
  });

  it('returns null when hdiutil printed no mount point', () => {
    expect(parseHdiutilMountPoint('<plist></plist>')).toBeNull();
  });
});
