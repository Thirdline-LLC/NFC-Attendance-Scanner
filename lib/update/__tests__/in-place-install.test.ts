import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it, vi } from 'vitest';
import { sha256Hex } from '../src/checksum';
import { renderInPlaceHelperScript, renderInPlaceSwapScript } from '../src/in-place-helper';
import {
  runInPlaceInstall,
  type FetchedAsset,
  type InPlaceHost,
  type InPlaceProgressPhase,
} from '../src/in-place-install';

const execFileAsync = promisify(execFile);

const EXEC_PATH = '/Applications/SJC Attendance.app/Contents/MacOS/SJC Attendance';

function bytesOf(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

async function assetOf(text: string, sidecar?: string): Promise<{
  asset: FetchedAsset;
  sidecar: FetchedAsset;
}> {
  const bytes = bytesOf(text);
  const digest = sidecar ?? (await sha256Hex(bytes));
  return {
    asset: { ok: true, bytes },
    sidecar: { ok: true, bytes: bytesOf(`${digest}\n`) },
  };
}

function createHost(overrides: Partial<InPlaceHost> = {}): {
  host: InPlaceHost;
  calls: string[];
  phases: InPlaceProgressPhase[];
  written: Map<string, Uint8Array | string>;
} {
  const calls: string[] = [];
  const phases: InPlaceProgressPhase[] = [];
  const written = new Map<string, Uint8Array | string>();
  const note = (name: string) => {
    calls.push(name);
  };

  const host: InPlaceHost = {
    platform: 'darwin',
    isPackaged: true,
    execPath: EXEC_PATH,
    pid: 4242,
    tempRoot: '/tmp',
    now: () => 1000,
    emit: (progress) => {
      phases.push(progress.phase);
    },
    fetchAsset: vi.fn(async () => ({ ok: true, bytes: bytesOf('') }) as FetchedAsset),
    mkdir: async () => {
      note('mkdir');
    },
    writeFile: async (filePath, data) => {
      note(`write:${filePath.split('/').pop()}`);
      written.set(filePath, data);
    },
    readDir: async () => {
      note('readDir');
      return ['SJC Attendance.app', 'Applications'];
    },
    copyApp: async () => {
      note('copyApp');
    },
    remove: async (target) => {
      note(`remove:${target.split('/').pop()}`);
    },
    attachDmg: async () => {
      note('attachDmg');
      return '/Volumes/SJC Attendance';
    },
    detachDmg: async () => {
      note('detachDmg');
    },
    spawnHelper: () => {
      note('spawnHelper');
    },
    quit: () => {
      note('quit');
    },
    ...overrides,
  };

  return { host, calls, phases, written };
}

describe('runInPlaceInstall', () => {
  it('verifies, mounts, stages, then quits so the helper can replace the running bundle', async () => {
    const files = await assetOf('dmg-bytes');
    const { host, calls, phases } = createHost({
      fetchAsset: vi
        .fn()
        .mockResolvedValueOnce(files.asset)
        .mockResolvedValueOnce(files.sidecar),
    });

    const result = await runInPlaceInstall(
      {
        assetUrl: 'https://github.com/Thirdline-LLC/NFC-Attendance-Scanner/releases/download/v1.0.1/SJC%20Attendance-1.0.1-arm64.dmg',
        sha256Url: 'https://github.com/Thirdline-LLC/NFC-Attendance-Scanner/releases/download/v1.0.1/SJC%20Attendance-1.0.1-arm64.dmg.sha256',
      },
      host,
    );

    expect(result).toEqual({
      ok: true,
      phase: 'relaunching',
      target: '/Applications/SJC Attendance.app',
    });
    expect(phases).toEqual(['downloading', 'installing', 'relaunching']);
    expect(calls).toEqual([
      'mkdir',
      'write:update.dmg',
      'write:replace.sh',
      'write:swap.sh',
      'attachDmg',
      'readDir',
      'copyApp',
      'detachDmg',
      'remove:update.dmg',
      'spawnHelper',
      'quit',
    ]);
    const spawnIndex = calls.indexOf('spawnHelper');
    expect(calls.indexOf('quit')).toBe(spawnIndex + 1);
    expect(calls.indexOf('attachDmg')).toBeGreaterThan(calls.indexOf('write:update.dmg'));
  });

  it('fails closed on a checksum mismatch and does not mount, copy, or quit', async () => {
    const files = await assetOf('dmg-bytes', 'ab'.repeat(32));
    const { host, calls, phases } = createHost({
      fetchAsset: vi
        .fn()
        .mockResolvedValueOnce(files.asset)
        .mockResolvedValueOnce(files.sidecar),
    });

    const result = await runInPlaceInstall(
      { assetUrl: 'https://example.invalid/a', sha256Url: 'https://example.invalid/b' },
      host,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('checksum');
      expect(result.message).toMatch(/checksum/);
      expect(result.message).toMatch(/Nothing was installed/);
    }
    expect(phases).toEqual(['downloading']);
    expect(calls).not.toContain('attachDmg');
    expect(calls).not.toContain('copyApp');
    expect(calls).not.toContain('spawnHelper');
    expect(calls).not.toContain('quit');
    expect(calls.some((call) => call.startsWith('write:'))).toBe(false);
  });

  it('does not replace a dev binary or a translocated bundle', async () => {
    const unpackaged = createHost({ isPackaged: false });
    const dev = await runInPlaceInstall(
      { assetUrl: 'a', sha256Url: 'b' },
      unpackaged.host,
    );
    expect(dev).toMatchObject({ ok: false, reason: 'not-packaged' });
    expect(unpackaged.calls).toEqual([]);

    const translocated = createHost({
      execPath:
        '/private/var/folders/ab/AppTranslocation/SJC Attendance.app/Contents/MacOS/SJC Attendance',
    });
    const moved = await runInPlaceInstall(
      { assetUrl: 'a', sha256Url: 'b' },
      translocated.host,
    );
    expect(moved).toMatchObject({ ok: false, reason: 'translocated' });
    expect(translocated.host.fetchAsset).not.toHaveBeenCalled();
  });

  it('returns a network error instead of throwing when the download rejects', async () => {
    const { host } = createHost({
      fetchAsset: vi.fn().mockRejectedValue(new Error('socket hang up')),
    });
    const result = await runInPlaceInstall({ assetUrl: 'a', sha256Url: 'b' }, host);
    expect(result).toMatchObject({ ok: false, reason: 'network' });
    expect(result.ok === false && result.message.length > 0).toBe(true);
  });

  it('detaches and leaves the installed app in place when the disk image has no app', async () => {
    const files = await assetOf('dmg-bytes');
    const { host, calls } = createHost({
      fetchAsset: vi
        .fn()
        .mockResolvedValueOnce(files.asset)
        .mockResolvedValueOnce(files.sidecar),
      readDir: async () => ['background.png'],
    });
    const result = await runInPlaceInstall({ assetUrl: 'a', sha256Url: 'b' }, host);
    expect(result).toMatchObject({ ok: false, reason: 'no-app-in-dmg' });
    expect(calls).toContain('detachDmg');
    expect(calls).not.toContain('quit');
    expect(calls).toContain('remove:tapin-update-4242-1000');
  });
});

describe('in-place helper scripts', () => {
  it('parse as bash and only replace a local bundle', async () => {
    const helper = renderInPlaceHelperScript();
    const swap = renderInPlaceSwapScript();
    await execFileAsync('bash', ['-n', '-c', helper]);
    await execFileAsync('bash', ['-n', '-c', swap]);

    expect(helper).toContain('kill -0');
    expect(helper).toContain('with administrator privileges');
    expect(helper).toContain('open "$TARGET"');
    expect(swap).toContain('cp -R');
    expect(swap).toContain('rm -rf');
    expect(swap).toContain('xattr -dr com.apple.quarantine');
    expect(helper + swap).not.toMatch(/\b(curl|wget|fetch|nc)\b/);
  });
});
