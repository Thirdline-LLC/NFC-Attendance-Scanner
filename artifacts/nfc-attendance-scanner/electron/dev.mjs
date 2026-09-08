#!/usr/bin/env node
/**
 * Runs the desktop app against the Vite dev server.
 *
 * Two processes have to start in order — Vite first, Electron once the port
 * answers — and nothing here should be a dependency to do it, so this replaces
 * the usual `concurrently` + `wait-on` pair with about forty lines. It also
 * means the launch rules live somewhere they can be read: the renderer URL is
 * passed in the environment, and `main.ts` refuses to honour it in a packaged
 * build.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, '..');
const port = Number(process.env.PORT ?? 5173);
const url = `http://localhost:${port}`;

const children = [];
let shuttingDown = false;

function run(command, args, env) {
  const child = spawn(command, args, {
    cwd: packageRoot,
    stdio: 'inherit',
    env: { ...process.env, ...env },
    shell: process.platform === 'win32',
  });
  children.push(child);
  return child;
}

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  }
  process.exit(code);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

async function waitForServer(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fetch(url, { method: 'HEAD' });
      return true;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  return false;
}

// The renderer is served by Vite; the main and preload bundles still have to be
// built, because Electron loads them from disk either way.
const bundle = run(process.execPath, [path.join(here, 'build.mjs')]);
await new Promise((resolve) => bundle.on('exit', resolve));

run('node', [
  path.join(packageRoot, 'node_modules', 'vite', 'bin', 'vite.js'),
  '--config',
  'vite.config.ts',
], { BUILD_TARGET: 'electron', PORT: String(port) });

if (!(await waitForServer())) {
  console.error(`Vite did not answer on ${url} within 60s.`);
  shutdown(1);
}

const electronBinary = (await import('electron')).default;
const electron = run(electronBinary, [packageRoot], {
  ELECTRON_RENDERER_URL: url,
});

electron.on('exit', (code) => shutdown(code ?? 0));
