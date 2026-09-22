# Decision D1 — Wave 1 Mac shell

**Date:** 2026-09-22 · **Status:** locked (revised) · **Slice:** W1-H · **Product:** Tapin  
**Repo:** `Thirdline-LLC/NFC-Attendance-Scanner` · **Baseline tip:** `0a77fccf452fd2e64565012bc6e76e1d8141b206`  
**Authority:** Asher → CoS 2026-09-22 Cap-vs-Electron grill lock → **Capacitor**

## Decision

**Lock Capacitor for the Wave 1 Mac DMG.** Must #9's Cap Mac path is the Wave 1 shell decision. This revision **supersedes the prior D1-a “keep Electron” lock** that briefly landed on this branch.

**Cap has no first-party macOS target.** “Cap Mac” for Wave 1 means:

1. a **Capacitor-managed web build** (same Cap `webDir` / `build:native` bundle story as Android/iOS), and  
2. **Cap-compatible desktop packaging** that yields a notarized / sideloadable **DMG published from GitHub Releases**.

It does **not** mean Capacitor ships `cap add macos`. Desktop packaging may use a Cap-compatible Electron runtime under Cap ownership (e.g. `@capawesome/capacitor-electron` or equivalent Cap-managed packaging); that is still the Cap path, not a “keep the hand-written Electron shell” decision.

**Electron (hand-written shell keep) is a hard-wall fallback only** — reopen only if Cap hits a hard wall later (origin cannot be preserved *and* export-then-reinstall is unacceptable for installed Macs). Do not treat Electron keep as the default.

## Options considered

| Option | Summary | Status |
|---|---|---|
| **D1-a** | Keep hand-written Electron; notarize + upload DMG; Cap stays Android/iOS only | **Superseded** (prior lock; honor grill → Cap) |
| **D1 Cap** (chosen) | Cap-managed web + Cap-compatible desktop packaging → DMG from Releases; Electron only if Cap hard-walls | **Locked** |
| **D1-b** (implementation mode) | Cap desktop platform with origin pinned to `app://attendance` when verifiable | Preferred cutover mode under the Cap lock |
| **D1-c** (implementation mode) | Cap desktop on clean install only; documented export-then-reinstall | Allowed if preserve fails the hard gate |

Source: Asher/CoS Cap-vs-Electron lock; `docs/wave1-implementation-plan.md` §3 Decision gate D1.

## Hard gate — `app://attendance` / IndexedDB

IndexedDB is origin-scoped. Bundle id `org.stjohnschs.attendance`, renderer origin `app://attendance`, and data directory `~/Library/Application Support/SJC Attendance` are permanent identity.

**Before any Cap Mac cutover that replaces a running install:**

- **Verify preserve** — Cap-compatible packaging keeps renderer origin `app://attendance` (and the same data directory / bundle id), **or**
- **Export-then-reinstall** — document and run the existing export-first migration (`docs/data-and-backup.md`) so no Mac carrying records is cut over blind.

If neither preserve nor an accepted export-then-reinstall is possible, that is a Cap **hard wall** → Electron fallback only with a fresh Asher/CoS note. Do not orphan on-disk rosters.

## Rationale

1. **Grill lock.** Asher delegated Cap-vs-Electron → Capacitor; Wave 1 honors that letter and Must #9’s Cap Mac wording.
2. **Cap has no first-party macOS.** Cap Mac is defined operationally (Cap web build + Cap-compatible desktop packaging → Releases DMG), not as a fictional `cap add macos`.
3. **Must #9 done-when is distribution.** A notarized Mac DMG sideloadable from GitHub Releases — Cap owns that story; packaging details follow the Cap path.
4. **Electron stays available as escape hatch.** Hard-wall fallback only; not the locked Wave 1 choice.
5. **Origin gate is non-negotiable.** Preserve or export-then-reinstall before cutover; never silent origin change.

## What this costs an installed Mac

- **If origin / identity are preserved:** nothing material to IndexedDB; signing/notarizing alone does not rename identity.
- **If preserve fails and D1-c applies:** every cut-over Mac must export first; on-device history is not assumed to migrate. Acceptable only when operators can run that procedure (or no Mac yet carries records that matter).

## What this does *not* do

- Does not change `identity: "-"` or `notarize: false` in `electron-builder.yml` in this slice (unsigned CI must keep working until W1-J on the build Mac). Cap-compatible packaging may still use those scripts; flipping checked-in signing defaults is W1-J, not this prep.
- Does not add Live Update, `electron-updater`, peer sync, Apple secrets in workflows, or Replit.
- Does not start Phase 3 audits.
- Does not claim a notarized DMG was built — that is W1-J on Asher’s Mac after W1-I procurement.
- Does not add Cap desktop platform dependencies in this docs-only prep PR.

## Follow-on slices

| Slice | What |
|---|---|
| **W1-I** | Apple Developer Program + Developer ID Application cert + app-specific password (Asher) — **still the notarize blocker** |
| **W1-J** | Cap-compatible notarized arm64 DMG on the M2 Air + Must #8 device check; origin hard gate answered (preserve **or** export-then-reinstall) before cutover |
| **W1-K** | Packaging docs already Cap-first in this prep PR; residual checklist polish after the binary ships |
| **W1-L** | Upload DMG + SHA-256 to a GitHub Release; keep `publish: null`; never Live Update / `electron-updater` |

## References

- `docs/wave1-implementation-plan.md` §3 (Must #9 / D1) and §6 Phase 2
- `docs/capacitor-native.md`, `docs/desktop-macos.md`, `docs/deferred-apple-developer.md`, `docs/wave1-mac-dmg-runbook.md`
