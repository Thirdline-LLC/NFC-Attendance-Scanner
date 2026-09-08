#!/usr/bin/env node
/**
 * `node scripts/build.mjs <web|capacitor|electron>`
 *
 * Runs `vite build` with `BUILD_TARGET` set. A wrapper rather than a
 * `BUILD_TARGET=… vite build` prefix in package.json because that syntax is a
 * shell feature: it works on macOS and Linux and silently is not a thing on
 * Windows `cmd`, where Android Studio is perfectly happy to live. This costs
 * one file and no dependency.
 *
 * `--mode` would have been the idiomatic Vite answer and is wrong here: it
 * also decides `import.meta.env.PROD`, and a target called anything other than
 * "production" would turn a production build into a development one — which is
 * exactly the flag the service-worker rule reads.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const TARGETS = new Set(['web', 'capacitor', 'electron']);
const target = process.argv[2];

if (!TARGETS.has(target)) {
  console.error(
    `Usage: node scripts/build.mjs <${[...TARGETS].join('|')}>\n` +
      `Received: ${target ?? '(nothing)'}`,
  );
  process.exit(1);
}

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

const vite = spawn(
  process.execPath,
  [
    path.join(packageRoot, 'node_modules', 'vite', 'bin', 'vite.js'),
    'build',
    '--config',
    'vite.config.ts',
  ],
  {
    cwd: packageRoot,
    stdio: 'inherit',
    env: { ...process.env, BUILD_TARGET: target },
  },
);

vite.on('exit', (code) => process.exit(code ?? 1));
