import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { renderInPlaceHelperScript, renderInPlaceSwapScript } from '../src/in-place-helper';

const execFileAsync = promisify(execFile);

/**
 * Partial swap: mv TARGET→BACKUP succeeds, cp fails, restoring BACKUP→TARGET
 * fails. BACKUP is the only previous app. A second run of swap.sh (the old
 * admin re-entry) must not `rm -rf` it. The helper elevates only when the
 * first mv never happened (exit 4).
 */
describe('in-place swap backup lifetime', () => {
  it('does not delete the only previous app when swap is re-run after a partial failure', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'tapin-swap-'));
    try {
      const target = path.join(root, 'Applications', 'SJC Attendance.app');
      const staged = path.join(root, 'staged', 'SJC Attendance.app');
      const backup = `${target}.tapin-previous`;
      await mkdir(path.join(target, 'Contents'), { recursive: true });
      await mkdir(path.join(staged, 'Contents'), { recursive: true });
      await writeFile(path.join(target, 'Contents', 'Info.plist'), 'previous-bundle');
      await writeFile(path.join(staged, 'Contents', 'Info.plist'), 'staged-bundle');
      const swap = path.join(root, 'swap.sh');
      await writeFile(swap, renderInPlaceSwapScript(), { mode: 0o755 });

      const userBin = path.join(root, 'user-bin');
      await mkdir(userBin);
      await writeFile(path.join(userBin, 'mv'), restoreMvFails(backup, target), { mode: 0o755 });
      await writeFile(path.join(userBin, 'cp'), '#!/bin/bash\nexit 1\n', { mode: 0o755 });

      const userCode = await exitCode(['bash', swap, target, staged, backup], withPath(userBin));
      expect(userCode).toBe(1);
      expect(await plist(backup)).toBe('previous-bundle');
      expect(await plist(target)).toBeNull();

      const adminBin = path.join(root, 'admin-bin');
      const logPath = path.join(root, 'rm.log');
      await mkdir(adminBin);
      await writeFile(path.join(adminBin, 'cp'), '#!/bin/bash\nexit 1\n', { mode: 0o755 });
      await writeFile(path.join(adminBin, 'rm'), logBackupRemoval(backup, logPath), { mode: 0o755 });

      const adminCode = await exitCode(['bash', swap, target, staged, backup], withPath(adminBin));
      expect(adminCode).toBe(1);
      expect(await readLog(logPath)).not.toContain('rm-rf-backup');
      expect([await plist(target), await plist(backup)]).toContain('previous-bundle');

      const helper = renderInPlaceHelperScript();
      const guard = helper.indexOf('[ "$status" -eq 4 ]');
      expect(guard).toBeGreaterThan(-1);
      expect(guard).toBeLessThan(helper.indexOf('with administrator privileges'));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

function bashQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function withPath(bin: string): NodeJS.ProcessEnv {
  return { ...process.env, PATH: `${bin}:${process.env.PATH ?? ''}` };
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

/** Real mv, except the rollback mv BACKUP → TARGET fails. */
function restoreMvFails(backup: string, target: string): string {
  return `#!/bin/bash
if [ "$1" = ${bashQuote(backup)} ] && [ "$2" = ${bashQuote(target)} ]; then
  exit 1
fi
exec /bin/mv "$@"
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
