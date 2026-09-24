import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { renderInPlaceHelperScript, renderInPlaceSwapScript } from '../src/in-place-helper';

const execFileAsync = promisify(execFile);

/**
 * Reviewer REQUEST CHANGES on #16: after mv TARGET→BACKUP succeeds, cp fails,
 * and restoring BACKUP→TARGET also fails, BACKUP is the only previous app.
 * The helper's admin re-entry runs swap.sh again. That re-run must not
 * `rm -rf` the backup while it is still the only good bundle.
 */
describe('in-place swap backup lifetime', () => {
  it('admin re-entry after a partial swap does not delete the only previous app', async () => {
    const fx = await fixture();
    try {
      const userBin = path.join(fx.root, 'user-bin');
      await mkdir(userBin);
      await writeExecutable(
        path.join(userBin, 'mv'),
        restoreMvFails(fx.backup, fx.target),
      );
      await writeExecutable(path.join(userBin, 'cp'), '#!/bin/bash\nexit 1\n');

      const userCode = await exitCode(
        ['bash', fx.swap, fx.target, fx.staged, fx.backup],
        withPath(userBin),
      );
      expect(userCode).not.toBe(0);
      expect(await plist(fx.backup)).toBe('previous-bundle');
      expect(await plist(fx.target)).toBeNull();

      const adminBin = path.join(fx.root, 'admin-bin');
      const logPath = path.join(fx.root, 'rm.log');
      await mkdir(adminBin);
      await writeExecutable(path.join(adminBin, 'cp'), '#!/bin/bash\nexit 1\n');
      await writeExecutable(path.join(adminBin, 'rm'), logBackupRemoval(fx.backup, logPath));

      const adminCode = await exitCode(
        ['bash', fx.swap, fx.target, fx.staged, fx.backup],
        withPath(adminBin),
      );
      expect(adminCode).not.toBe(0);
      expect(await readLog(logPath)).not.toContain('rm-rf-backup');
      expect([await plist(fx.target), await plist(fx.backup)]).toContain('previous-bundle');
    } finally {
      await rm(fx.root, { recursive: true, force: true });
    }
  });

  it('admin re-entry installs the staged app without removing the backup first', async () => {
    const fx = await fixture();
    try {
      const userBin = path.join(fx.root, 'user-bin');
      await mkdir(userBin);
      await writeExecutable(
        path.join(userBin, 'mv'),
        restoreMvFails(fx.backup, fx.target),
      );
      await writeExecutable(path.join(userBin, 'cp'), '#!/bin/bash\nexit 1\n');

      const userCode = await exitCode(
        ['bash', fx.swap, fx.target, fx.staged, fx.backup],
        withPath(userBin),
      );
      expect(userCode).not.toBe(0);
      expect(await plist(fx.backup)).toBe('previous-bundle');
      expect(await plist(fx.target)).toBeNull();

      const adminBin = path.join(fx.root, 'admin-bin');
      const logPath = path.join(fx.root, 'rm.log');
      await mkdir(adminBin);
      await writeExecutable(
        path.join(adminBin, 'rm'),
        refuseEarlyBackupRemoval(fx.backup, fx.target, logPath),
      );

      const adminCode = await exitCode(
        ['bash', fx.swap, fx.target, fx.staged, fx.backup],
        withPath(adminBin),
      );
      expect(adminCode).toBe(0);
      expect(await readLog(logPath)).not.toContain('rm-rf-backup-before-new-bundle');
      expect(await plist(fx.target)).toBe('staged-bundle');
    } finally {
      await rm(fx.root, { recursive: true, force: true });
    }
  });

  it('keeps the previous app when a partial target is left beside the backup', async () => {
    const fx = await fixture();
    try {
      const userBin = path.join(fx.root, 'user-bin');
      await mkdir(userBin);
      await writeExecutable(
        path.join(userBin, 'mv'),
        restoreMvFails(fx.backup, fx.target),
      );
      await writeExecutable(path.join(userBin, 'cp'), partialCopy(fx.target));
      await writeExecutable(path.join(userBin, 'rm'), refuseTargetRemoval(fx.target));

      const userCode = await exitCode(
        ['bash', fx.swap, fx.target, fx.staged, fx.backup],
        withPath(userBin),
      );
      expect(userCode).not.toBe(0);
      expect(await plist(fx.backup)).toBe('previous-bundle');
      expect(await plist(fx.target)).toBe('partial-bundle');

      const adminBin = path.join(fx.root, 'admin-bin');
      const logPath = path.join(fx.root, 'rm.log');
      await mkdir(adminBin);
      await writeExecutable(path.join(adminBin, 'cp'), '#!/bin/bash\nexit 1\n');
      await writeExecutable(path.join(adminBin, 'rm'), logBackupRemoval(fx.backup, logPath));

      const adminCode = await exitCode(
        ['bash', fx.swap, fx.target, fx.staged, fx.backup],
        withPath(adminBin),
      );
      expect(adminCode).not.toBe(0);
      expect(await readLog(logPath)).not.toContain('rm-rf-backup');
      expect([await plist(fx.target), await plist(fx.backup)]).toContain('previous-bundle');
    } finally {
      await rm(fx.root, { recursive: true, force: true });
    }
  });

  it('replaces the bundle on a normal swap and removes the backup only afterward', async () => {
    const fx = await fixture();
    try {
      const code = await exitCode(
        ['bash', fx.swap, fx.target, fx.staged, fx.backup],
        process.env,
      );
      expect(code).toBe(0);
      expect(await plist(fx.target)).toBe('staged-bundle');
      expect(await plist(fx.backup)).toBeNull();
      await expect(readFile(`${fx.backup}.incomplete`)).rejects.toThrow();
    } finally {
      await rm(fx.root, { recursive: true, force: true });
    }
  });

  it('retries after a permission failure on mv without losing the installed app', async () => {
    const fx = await fixture();
    try {
      const userBin = path.join(fx.root, 'user-bin');
      await mkdir(userBin);
      await writeExecutable(path.join(userBin, 'mv'), '#!/bin/bash\nexit 1\n');

      const userCode = await exitCode(
        ['bash', fx.swap, fx.target, fx.staged, fx.backup],
        withPath(userBin),
      );
      expect(userCode).not.toBe(0);
      expect(await plist(fx.target)).toBe('previous-bundle');
      expect(await plist(fx.backup)).toBeNull();

      const adminCode = await exitCode(
        ['bash', fx.swap, fx.target, fx.staged, fx.backup],
        process.env,
      );
      expect(adminCode).toBe(0);
      expect(await plist(fx.target)).toBe('staged-bundle');
      expect(await plist(fx.backup)).toBeNull();
    } finally {
      await rm(fx.root, { recursive: true, force: true });
    }
  });

  it('the helper re-enters swap and does not remove the backup itself', () => {
    const helper = renderInPlaceHelperScript();
    expect(helper).toContain('user-swap-failed');
    expect(helper).toContain('with administrator privileges');
    expect(helper).not.toContain('rm -rf "$BACKUP"');
    const swap = renderInPlaceSwapScript();
    expect(swap.indexOf('Incomplete swap')).toBeLessThan(swap.indexOf('rm -rf "$BACKUP"'));
    expect(swap.indexOf('cp -R "$STAGED" "$TARGET"')).toBeLessThan(
      swap.lastIndexOf('rm -rf "$BACKUP"'),
    );
  });
});

function bashQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function withPath(bin: string): NodeJS.ProcessEnv {
  return { ...process.env, PATH: `${bin}:${process.env.PATH ?? ''}` };
}

async function writeExecutable(filePath: string, body: string): Promise<void> {
  await writeFile(filePath, body, { mode: 0o755 });
}

async function exitCode(args: string[], env: NodeJS.ProcessEnv): Promise<number> {
  try {
    await execFileAsync(args[0], args.slice(1), { env });
    return 0;
  } catch (error) {
    const code = (error as { code?: number | string }).code;
    if (typeof code === 'number') return code;
    throw error;
  }
}

async function plist(appPath: string): Promise<string | null> {
  try {
    return await readFile(path.join(appPath, 'Contents', 'Info.plist'), 'utf8');
  } catch {
    return null;
  }
}

async function readLog(logPath: string): Promise<string> {
  try {
    return await readFile(logPath, 'utf8');
  } catch {
    return '';
  }
}

async function fixture(): Promise<{
  root: string;
  target: string;
  staged: string;
  backup: string;
  swap: string;
}> {
  const root = await mkdtemp(path.join(tmpdir(), 'tapin-swap-'));
  const target = path.join(root, 'Applications', 'SJC Attendance.app');
  const staged = path.join(root, 'staged', 'SJC Attendance.app');
  const backup = `${target}.tapin-previous`;
  await mkdir(path.join(target, 'Contents'), { recursive: true });
  await mkdir(path.join(staged, 'Contents'), { recursive: true });
  await writeFile(path.join(target, 'Contents', 'Info.plist'), 'previous-bundle');
  await writeFile(path.join(staged, 'Contents', 'Info.plist'), 'staged-bundle');
  const swap = path.join(root, 'swap.sh');
  await writeExecutable(swap, renderInPlaceSwapScript());
  return { root, target, staged, backup, swap };
}

/** Real mv, except the rollback mv BACKUP → TARGET fails. */
function restoreMvFails(backup: string, target: string): string {
  return `#!/bin/bash
if [ "$1" = ${bashQuote(backup)} ] && [ "$2" = ${bashQuote(target)} ]; then
  exit 1
fi
exec /bin/mv "$@"
`;
}

function partialCopy(target: string): string {
  const plistPath = path.join(target, 'Contents', 'Info.plist');
  return `#!/bin/bash
mkdir -p ${bashQuote(path.dirname(plistPath))}
printf '%s' 'partial-bundle' > ${bashQuote(plistPath)}
exit 1
`;
}

function refuseTargetRemoval(target: string): string {
  return `#!/bin/bash
if [ "$1" = "-rf" ] && [ "$2" = ${bashQuote(target)} ]; then
  exit 1
fi
exec /bin/rm "$@"
`;
}

function logBackupRemoval(backup: string, logPath: string): string {
  return `#!/bin/bash
if [ "$1" = "-rf" ] && [ "$2" = ${bashQuote(backup)} ]; then
  printf '%s\\n' 'rm-rf-backup' >> ${bashQuote(logPath)}
fi
exec /bin/rm "$@"
`;
}

/**
 * Records and refuses `rm -rf` of the backup until the new bundle is already
 * at TARGET. A re-run that deletes the only previous app fails this wrapper.
 */
function refuseEarlyBackupRemoval(backup: string, target: string, logPath: string): string {
  const plistPath = path.join(target, 'Contents', 'Info.plist');
  return `#!/bin/bash
if [ "$1" = "-rf" ] && [ "$2" = ${bashQuote(backup)} ]; then
  contents=$(cat ${bashQuote(plistPath)} 2>/dev/null || true)
  if [ "$contents" != "staged-bundle" ]; then
    printf '%s\\n' 'rm-rf-backup-before-new-bundle' >> ${bashQuote(logPath)}
    exit 1
  fi
fi
exec /bin/rm "$@"
`;
}
