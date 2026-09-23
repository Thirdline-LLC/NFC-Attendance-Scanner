# Design 07 — Update checker (binaries + themes)

**Status:** Spec 2026-09-23 · **Plan:** [plans/07-update-checker.md](../plans/07-update-checker.md)  
**Aligns with:** D1 — Releases distribution; no Live Update / electron-updater / peer sync.

## Overview

Optional teacher PIN-gated “Check for updates” reads **GitHub Releases** for newer app installers and `.nfc-theme` assets, verifies SHA-256, and prompts install/activate. **Never** uploads or downloads student databases.

## UI notes

- Dashboard card: current app version, active theme id/version, last checked.  
- Clear separation: “App update” vs “Theme pack.”  
- Fail closed on checksum mismatch.

## Data flow

1. GET Release metadata (public or tokenless for public assets; private repo may need release token stored as **device ops secret**, never with student data).  
2. Compare semver / theme version.  
3. Download asset → verify SHA-256 against Release checksum file.  
4. App: hand to OS installer / open DMG instructions (no silent in-place Live Update).  
5. Theme: write pending file → verify ed25519 → activate or keep previous.

## Edge cases

- Offline / school firewall — show manual Releases URL.  
- minAppVersion on theme newer than app — refuse theme, prompt app update first.  
- Tamper → refuse + activity `update-refused` counts only.

## FERPA

Network path is binaries/themes only. Document that enabling check requires school IT acceptance of GitHub egress.

## Out of scope

Peer sync; pushing rosters via Releases; auto-restart into new binary without teacher confirmation.