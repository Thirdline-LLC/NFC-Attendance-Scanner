/**
 * The real filesystem and `hdiutil` behind `runInPlaceInstall`.
 *
 * Kept apart from `main.ts` so the install sequence itself can live in
 * `@workspace/update`, where it is tested without Electron. This file is the
 * only place that mounts a disk image or spawns the relaunch helper.
 */

import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import { promisify } from 'node:util';

import { app } from 'electron';
import {
  hdiutilAttachArgs,
  hdiutilDetachArgs,
  parseHdiutilMountPoint,
  type InPlaceHost,
  type InPlaceProgressPhase,
} from '@workspace/update';

const execFileAsync = promisify(execFile);

/**
 * Fetches one Release asset's bytes.
 *
 * API asset URLs need `Accept: application/octet-stream` or GitHub returns
 * JSON metadata. Public `browser_download_url`s are ordinary GETs and are
 * what the in-place path uses, so a room of Macs is not spending the
 * unauthenticated REST budget on the disk image itself. A redirect to the
 * release CDN is expected; the SHA-256 check is what decides the bytes are
 * the ones that were published.
 */
export async function fetchReleaseAssetBytes(url: string): Promise<Uint8Array> {
  const token = process.env.TAPIN_UPDATE_TOKEN;
  const headers: Record<string, string> = {};
  if (url.startsWith('https://api.github.com/')) {
    headers.Accept = 'application/octet-stream';
  }
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`http-error:${response.status}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

export function createInPlaceHost(
  emit: (progress: { phase: InPlaceProgressPhase }) => void,
): InPlaceHost {
  return {
    platform: process.platform,
    isPackaged: app.isPackaged,
    execPath: process.execPath,
    pid: process.pid,
    tempRoot: app.getPath('temp'),
    emit,

    async fetchAsset(url) {
      try {
        return { ok: true, bytes: await fetchReleaseAssetBytes(url) };
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        return { ok: false, reason: message.startsWith('http-error:') ? 'http-error' : 'network' };
      }
    },

    async mkdir(dir) {
      await fs.mkdir(dir, { recursive: true });
    },

    async writeFile(filePath, data, mode) {
      await fs.writeFile(filePath, data, { mode: mode ?? 0o644 });
    },

    async readDir(dir) {
      return fs.readdir(dir);
    },

    async copyApp(from, to) {
      // `cp -R` keeps the symlinks inside an Electron `.app`. A copy that
      // followed them would break the framework layout.
      await execFileAsync('/bin/cp', ['-R', from, to], { timeout: 180_000 });
    },

    async remove(target) {
      await fs.rm(target, { recursive: true, force: true });
    },

    async attachDmg(dmgPath) {
      const { stdout } = await execFileAsync('/usr/bin/hdiutil', hdiutilAttachArgs(dmgPath), {
        timeout: 120_000,
        maxBuffer: 1024 * 1024,
      });
      const mountPoint = parseHdiutilMountPoint(stdout);
      if (!mountPoint) {
        throw new Error('mount-point-missing');
      }
      return mountPoint;
    },

    async detachDmg(mountPoint) {
      await execFileAsync('/usr/bin/hdiutil', hdiutilDetachArgs(mountPoint), {
        timeout: 60_000,
      });
    },

    spawnHelper(scriptPath, args) {
      const child = spawn('/bin/bash', [scriptPath, ...args], {
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
    },

    quit() {
      app.quit();
    },
  };
}
