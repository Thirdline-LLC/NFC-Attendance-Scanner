#!/usr/bin/env node
/**
 * Bundles the Electron main and preload processes into `dist/electron/`.
 *
 * esbuild rather than Vite because these two files are Node/Electron code, not
 * a web app: no JSX, no CSS, no asset graph. Both come out as CommonJS —
 * a sandboxed preload script must be CJS, and keeping the main process the
 * same avoids one `.mjs`/`.cjs` trap in a package that is otherwise ESM.
 *
 * `electron` itself is external: it is provided by the runtime, not bundled.
 */
import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const outdir = path.resolve(here, '..', 'dist', 'electron');

const shared = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  // Electron 44 ships Node 22; nothing here needs a downlevel.
  target: 'node22',
  external: ['electron'],
  sourcemap: true,
  minify: false,
  logLevel: 'info',
};

await Promise.all([
  build({
    ...shared,
    entryPoints: [path.join(here, 'main.ts')],
    outfile: path.join(outdir, 'main.cjs'),
  }),
  build({
    ...shared,
    entryPoints: [path.join(here, 'preload.ts')],
    outfile: path.join(outdir, 'preload.cjs'),
  }),
]);
