# Blueprint review — consistency & FERPA/COPPA

**Date:** 2026-09-23 · **Reviewer:** Chief of Staff (docs pass before code)

## Checklist

| Check | Result |
|---|---|
| No cloud DB in blueprint/specs/plans | PASS |
| Capacitor D1 honored; Tauri not required | PASS |
| Entity-owned bodies; device attaches to active body (D-T2) | PASS |
| Themes forbid student data; separate from roster packs | PASS |
| Releases = binaries + themes; no peer sync | PASS |
| Import never-delete + card ignore preserved | PASS |
| PIN gates for import/theme/body/update documented | PASS |
| Anti-slop called in blueprint + theme + UI notes | PASS |
| Free-tier CI listed | PASS |
| Aligns with data-protection.md / data-and-backup.md | PASS with notes below |

## Decided 2026-09-23 (no longer open)

1. **Bodies:** Class/club entities own roster + tap history; device attaches; no wipe on reassignment; export optional (D-T2 revised).
2. **Theme signing:** UNSIGNED pilot; signature seam only (D-T1).
3. **School Wi‑Fi → GitHub Releases:** allowed (D-T3).

## Remaining gaps (non-blocking for docs)

1. **Private GitHub Releases token on device** (if repo stays private): ops must keep any read token out of exports/backups (`android:allowBackup` already false).
2. **Faculty `grad_year`:** Soft-required for faculty packs; student imports still require year.
3. **Unsigned CSV vs `.nfc-pack`:** Day-to-day Excel stays unsigned behind PIN.
4. **PACT in CI:** Apply when hosted preview exists; else manual checklist.
5. **COPPA:** Likely N/A (9–12, local-only); keep retention + security postures.

## Conflicts fixed in this docs set

- Dropped Tauri; clarified multi-entity-on-device with single active attachment (D-T2).
- Explicitly separated `.nfc-theme` (branding) from `.nfc-pack` (roster members).

## Verdict

**Docs are consistent enough to implement behind feature flags, starting with Plan 02 migration design spike, then 03/04.** No application code in the accompanying PR.