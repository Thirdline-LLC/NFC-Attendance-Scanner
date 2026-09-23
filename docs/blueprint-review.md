# Blueprint review — consistency & FERPA/COPPA

**Date:** 2026-09-23 · **Reviewer:** Chief of Staff (docs pass before code)

## Checklist

| Check | Result |
|---|---|
| No cloud DB in blueprint/specs/plans | PASS |
| Capacitor D1 honored; Tauri not required | PASS |
| One-device–one-body consistent across 02/03/blueprint | PASS |
| Themes forbid student data; separate from roster packs | PASS |
| Releases = binaries + themes; no peer sync | PASS |
| Import never-delete + card ignore preserved | PASS |
| PIN gates for import/theme/body/update documented | PASS |
| Anti-slop called in blueprint + theme + UI notes | PASS |
| Free-tier CI listed | PASS |
| Aligns with data-protection.md / data-and-backup.md | PASS with notes below |

## Gaps / flags (non-blocking for docs; block code until decided)

1. **Body replace semantics:** Spec 02 prefers blocking replace until export; exact migration of historical taps with old `bodyId` needs a product call before coding the migration (backfill vs freeze).
2. **Private GitHub Releases + school Wi-Fi:** Update checker may need a read token on device — ops design must keep that token out of exports and backups (`android:allowBackup` already false).
3. **Faculty `grad_year`:** Soft-required rule must be implemented carefully so student imports still require year.
4. **Unsigned CSV vs signed `.nfc-pack`:** Day-to-day school files stay unsigned behind PIN; do not accidentally require signatures for teacher Excel.
5. **Theme private key custody:** Not in repo; Asher must designate holder before first SJC pack ships.
6. **PACT in CI:** User-facing PWA preview may not exist in Cap-only kiosk mode — apply PACT when a hosted preview exists; otherwise manual checklist.
7. **COPPA:** Docs correctly say COPPA likely N/A (9–12, local-only); still keep retention + security program postures.

## Conflicts fixed in this docs set

- Dropped Tauri and multi-body-per-device day-to-day from voice drafts.
- Explicitly separated `.nfc-theme` (branding) from `.nfc-pack` (roster members).

## Verdict

**Docs are consistent enough to implement behind feature flags, starting with Plan 02 migration design spike, then 03/04.** No application code in the accompanying PR.