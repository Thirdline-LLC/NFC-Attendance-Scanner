# Decision D1 — Wave 1 Mac shell

**Date:** 2026-09-22 · **Status:** locked · **Slice:** W1-H · **Product:** Tapin  
**Repo:** `Thirdline-LLC/NFC-Attendance-Scanner` · **Baseline tip:** `0a77fccf452fd2e64565012bc6e76e1d8141b206`

## Decision

**D1-a — Keep the Electron Mac shell.** Wave 1 delivers Must #9's *outcome* (a notarized / sideloadable DMG installable from GitHub Releases) without replacing the hand-written Electron packaging in `artifacts/nfc-attendance-scanner/`. Product / app code is unchanged by this lock.

## Options considered

| Option | Summary |
|---|---|
| **D1-a** (chosen) | Keep Electron; notarize + upload DMG to GitHub Releases; align packaging docs |
| **D1-b** | Adopt `@capawesome/capacitor-electron`, try to pin origin to `app://attendance` |
| **D1-c** | Adopt the Capacitor desktop platform on clean install only (export-then-reinstall) |

Source: `docs/wave1-implementation-plan.md` §3 Decision gate D1.

## Rationale

1. **Capacitor has no first-party macOS target.** Must #9's "Capacitor Mac shell" cannot mean adding a platform Capacitor ships; it would mean adopting a third-party Electron wrapper.
2. **Origin risk on D1-b.** Adopting `@capawesome/capacitor-electron` risks changing the renderer origin away from `app://attendance`. IndexedDB is origin-scoped; three docs and `capacitor.config.ts` treat that string as permanent identity. An unverified scheme change would leave every installed Mac's roster on disk and invisible to the app.
3. **Must #9's done-when is distribution**, not shell brand: a notarized Mac DMG sideloadable from GitHub Releases. D1-a reaches that without touching `src/`, the export bridge, or installed data directories.
4. **Plan recommendation.** `docs/wave1-implementation-plan.md` §3 recommends D1-a for Wave 1, with the Capacitor desktop platform evaluated later (wave 2+ maintenance), not as a Wave 1 rebuild.

## What this costs an installed Mac

**Nothing.** Bundle id `org.stjohnschs.attendance`, renderer origin `app://attendance`, and data directory `~/Library/Application Support/SJC Attendance` stay as they are. Signing/notarizing does not rename identity.

## What this does *not* do

- Does not change `identity: "-"` or `notarize: false` in `electron-builder.yml` in this slice (unsigned CI must keep working until W1-J runs on the build Mac).
- Does not add `electron-updater`, Live Update, peer sync, Apple secrets in workflows, or Replit.
- Does not start Phase 3 audits.
- Does not claim a notarized DMG was built — that is W1-J on Asher's Mac after W1-I procurement.

## Follow-on slices

| Slice | What |
|---|---|
| **W1-I** | Apple Developer Program + Developer ID Application cert + app-specific password (Asher) |
| **W1-J** | Notarized arm64 DMG on the M2 Air + Must #8 device check |
| **W1-K** | Packaging docs already aligned in this prep PR; residual checklist polish after the binary ships |
| **W1-L** | Upload DMG + SHA-256 to a GitHub Release; keep `publish: null` |

## References

- `docs/wave1-implementation-plan.md` §3 (Must #9 / D1) and §6 Phase 2
- `docs/desktop-macos.md`, `docs/deferred-apple-developer.md`, `docs/wave1-mac-dmg-runbook.md`
