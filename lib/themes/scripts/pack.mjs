#!/usr/bin/env node
/**
 * pack.mjs — theme pack bundler
 *
 * Usage:
 *   node scripts/pack.mjs <org-id>
 *   node scripts/pack.mjs tapin-sjc
 *
 * Reads `orgs/<org-id>/manifest.json`, embeds assets as base64 data URIs,
 * computes SHA-256 checksums, and writes the packed `.nfc-theme` file plus a
 * `.sha256` sidecar.
 *
 * The `signature` field is left absent in the output (pilot, D-T1 — unsigned).
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const ORGS_DIR = join(ROOT, 'orgs');
const DIST_DIR = join(ROOT, 'dist');

const orgId = process.argv[2];
if (!orgId) {
  console.error('Usage: node scripts/pack.mjs <org-id>  (e.g. tapin-sjc)');
  process.exit(1);
}

const orgDir = join(ORGS_DIR, orgId);
const manifestPath = join(orgDir, 'manifest.json');

let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
} catch (err) {
  console.error(`Cannot read manifest at ${manifestPath}: ${err.message}`);
  process.exit(1);
}

const version = manifest.meta?.version ?? '0.0.0';
const outName = `${orgId}-v${version}.nfc-theme`;

/** Embed an asset path as a base64 data URI and return { dataUri, sha256Hex }. */
function embedAsset(relPath) {
  const absPath = join(orgDir, relPath);
  let bytes;
  try {
    bytes = readFileSync(absPath);
  } catch {
    console.warn(`  ⚠ asset not found: ${relPath} — skipping`);
    return null;
  }
  const ext = extname(relPath).toLowerCase();
  const mimeMap = {
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
  };
  const mime = mimeMap[ext] ?? 'application/octet-stream';
  const sha256Hex = createHash('sha256').update(bytes).digest('hex');
  const dataUri = `data:${mime};base64,${bytes.toString('base64')}`;
  return { dataUri, sha256Hex };
}

const packed = structuredClone(manifest);
const checksums = {};

function processAssets(assets) {
  if (!assets || typeof assets !== 'object') return assets;
  const result = {};
  for (const [key, value] of Object.entries(assets)) {
    if (typeof value === 'string' && !value.startsWith('data:') && value !== '') {
      const embedded = embedAsset(value);
      if (embedded) {
        result[key] = embedded.dataUri;
        checksums[value] = `sha256:${embedded.sha256Hex}`;
        console.log(`  ✓ ${value} (sha256:${embedded.sha256Hex.slice(0, 12)}…)`);
      } else {
        result[key] = value;
      }
    } else {
      result[key] = value;
    }
  }
  return result;
}

packed.assets = processAssets(manifest.assets);
packed.checksums = checksums;

// Remove signature — unsigned pilot (D-T1 seam present in schema but not applied)
delete packed.signature;

mkdirSync(DIST_DIR, { recursive: true });

const outPath = join(DIST_DIR, outName);
const outJson = JSON.stringify(packed, null, 2);
writeFileSync(outPath, outJson, 'utf-8');
console.log(`\n→ ${outPath}`);

const sha256 = createHash('sha256').update(outJson, 'utf-8').digest('hex');
const sidecarPath = `${outPath}.sha256`;
writeFileSync(sidecarPath, `${sha256}  ${outName}\n`, 'utf-8');
console.log(`→ ${sidecarPath} (sha256:${sha256.slice(0, 16)}…)`);

console.log('\nPack complete. No student records embedded — themes are branding only.');
