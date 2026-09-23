# NFC Attendance Scanner — Final Blueprint

**Product:** Tapin / SJC Attendance (configurable per theme)  
**Repo:** `Thirdline-LLC/NFC-Attendance-Scanner`  
**Status:** Blueprint locked 2026-09-23 (docs only — no app code in this change)  
**Authority:** Asher Mills → Chief of Staff voice lock 2026-09-23  

This document is the single source of truth for architecture going forward. It folds existing shipped behavior (`docs/data-and-backup.md`, `docs/data-protection.md`, `docs/operating-the-kiosk.md`) and Wave 1 decisions (`docs/decisions/2026-09-22-wave1-mac-shell-d1.md`). Feature detail lives in `docs/design/`; build order lives in `docs/plans/`. Review: `docs/blueprint-review.md`.

---

## 1. Purpose

A **local-only** NFC attendance kiosk for school use: scan cards, manage one attendance body (club, class, faculty, or custom), import rosters in bulk, export session/history workbooks into the school OneDrive system of record, and brand the app at runtime with signed theme packs — without any cloud database or automatic sync of student records.

## 2. Non-goals

- Cloud Postgres / Supabase / any remote education-records store
- Peer-device sync of taps or rosters
- Live Update / `electron-updater` binary push (forbidden by D1)
- Multi-body simultaneous operation on one device
- Baking school branding into the build
- Stripe / Resend for attendance data paths
- Tauri rewrite of the Wave 1 shell

## 3. Locked stack

| Layer | Choice |
|---|---|
| Shell | **Capacitor** web + Android + Cap-compatible Mac DMG (D1) |
| UI | shadcn/ui + Tailwind; anti-slop typography/layout |
| Local DB | Dexie IndexedDB (`attendance-scanner-local`) |
| NFC | Platform adapters (keyboard wedge today; NDEF adapters in `packages/nfc`) |
| Distribution | **GitHub Releases** (APK, DMG, `.nfc-theme` assets + SHA-256) |
| SoR | School workbook (OneDrive) via human export/import |

Electron hand-written shell is a **hard-wall fallback only** (D1). Tauri is **not** the Wave path.

### Anti-slop (enforced in themes + `packages/ui`)

- Intentional font pairings (e.g. Playfair Display + Plus Jakarta Sans) — not Inter-only
- No purple/indigo gradient “AI default” look
- High-contrast editorial / asymmetric layouts; sharp borders (`border-zinc-200/80`); `shadow-sm`; pixel-perfect padding
- Theme packs supply tokens; UI primitives stay neutral

### Free-tier CI gates (document; wire in plans)

1. Strict TypeScript + lint  
2. `npm audit --audit-level=high`  
3. VibeDoctor  
4. Semgrep OSS  
5. GitHub Code Scanning and/or GitGuardian on diff  
6. PACT AI compliance on preview/user-facing surfaces when applicable  
7. Existing `verify` check on `main` remains required  

## 4. Target folder tree

```
NFC-Attendance-Scanner/
  artifacts/nfc-attendance-scanner/   # Cap app (current home of runtime)
  packages/
    ui/                 # primitives + CSS variable hooks
    domain/             # AttendanceBody, Member, Session, Tap, Zod
    local-db/           # Dexie schema/migrations — NO cloud client
    nfc/                # read/write + platform adapters
    roster-import/      # CSV / xlsx / .nfc-pack parsers
    update/             # GitHub Releases metadata + checksum verify
    themes/             # schema, verifier, default/, orgs/sjc/
  templates/
    roster-template.csv
    roster-template.xlsx
    body-pack.nfc-pack.example.json
    theme-pack.nfc-theme.example.json
  docs/
    blueprint-final.md
    blueprint-review.md
    design/…
    plans/…
    data-and-backup.md          # keep
    data-protection.md          # keep
    decisions/…                 # keep D1
  .github/workflows/
```

Migration is incremental: new packages wrap existing modules under `artifacts/…` without a big-bang move.

## 5. One-device–one-body model

Each physical kiosk is bound to **exactly one** `AttendanceBody` at a time.

```
AttendanceBody { id, name, typeLabel, createdAt }
  typeLabel ∈ "club" | "class" | "faculty" | custom string
Member { id, bodyId, firstName, lastName, gradYear?, email?, cardUid? }
Session { id, bodyId, startedAt, endedAt? }
Tap { id, bodyId, sessionId, cardUid, memberId?, scannedAt, counted }
```

- Desk UX never switches bodies mid-queue.  
- Changing body is **teacher PIN-gated reconfiguration**: KEEP existing taps and reassign; export remains available but is **not** required before swap (D-T2, 2026-09-23).  
- Theme `bodyTypePresets` supply **labels only**, not rosters.

## 6. Local FERPA data map

| Store | Contents | Leaves device? |
|---|---|---|
| IndexedDB `persons` / members | Roster for **this** body | Only via PIN-gated export |
| `taps` | Attendance events | Same |
| `settings` | PIN hash, targets, active body, theme id | Never as student PII |
| `activity` | Counts, filenames, kinds | Export sheet — no names/UIDs |
| Theme file on disk | Branding/copy/tokens | N/A (not student data) |

**Hard rules**

- No automatic network of student records (`fetch` of education data forbidden).  
- Exports: mask card to last 4; notice “school account only.”  
- Retention: teacher-triggered purge; one school year taps (existing schedule).  
- COPPA: St. John’s 9–12; on-device-only interaction is not FTC “collection”; no under-13 product mode.  
- Encryption at rest = device OS (FileVault / FBE); PIN is a screen gate, not encryption.

## 7. Roster import

PIN-gated; scoped to the **active body**.

| Format | Role |
|---|---|
| CSV / `.xlsx` | Day-to-day from school workbook |
| `.nfc-pack` | Signed multi-member pack + body metadata; **no taps** |

**Columns:** `first_name`, `last_name`, `grad_year`, `email` (optional). Optional `body_name` / `body_type` must match active body or refuse. **Card column ignored.**  

**Semantics:** add / update / unchanged / refused (by line #). **Never deletes** missing rows. Cards bind on first tap (“Whose card?”). Manual Enroll remains for mid-year joins.

Templates: `templates/roster-template.csv` (+ xlsx twin).

## 8. Runtime themes

- One **neutral** core binary.  
- Active theme = signed `.nfc-theme` on device (or bundled `default`).  
- Pilot: packs may ship **unsigned** (D-T1). Keep signature/checksum fields as a seam; implement signing later for multi-school. Optional local SHA-256 of assets if present.  
- Admin PIN-gated install/activate/revert — **no rebuild**.  
- Packs ship as **GitHub Release assets** beside installers.  
- **Forbidden in packs:** members, emails, UIDs, taps, sessions, PIN material.

Schema + SJC sample: `docs/design/04-theme-system.md`.

## 9. Multi-device update path

| What | How |
|---|---|
| App binary | GitHub Release APK/DMG + SHA-256; MDM / sideload / `adb install -r` (same app id + signing key preserves IndexedDB) |
| Theme | Same Release, `themes/*.nfc-theme` + `.sha256` |
| Roster | Human import from SoR / pack — not from Releases |
| Attendance taps | **Never** synced between devices |

Optional in-app “Check for update” may read **public release metadata** and download installers/themes only. D1: no Live Update auto-swap of the running binary without an explicit packaging decision later.

## 10. Roles (unchanged spirit)

- **Desk:** check-in, enroll (card-present), bind card to pre-enrolled member.  
- **Teacher (PIN):** End Session, Students, Dashboard, import/export, retention, theme, body reconfiguration, PIN change.

## 11. Conflicts with earlier drafts (resolved)

| Draft idea | Resolution |
|---|---|
| Tauri desktop | **Dropped** — Capacitor D1 wins |
| Supabase / cloud DB | **Forbidden** |
| Many bodies per device day-to-day | **Dropped** — one-device–one-body |
| Theme baked at build | **Dropped** — runtime `.nfc-theme` |
| Peer sync of records | **Forbidden** (existing docs) |

## 12. Decided (2026-09-23) — see `docs/decisions/2026-09-23-tapin-pilot-decisions.md`

1. **Theme signing:** UNSIGNED for pilot (local admin install). Keep `signature` / `checksums` seam; do not implement signing yet. Add keys when multi-school.  
2. **Body-replace:** KEEP old taps; reassign on club/class switch. Export optional — do **not** block swap for export.  
3. **GitHub Releases on school Wi‑Fi:** allowed for app + theme updates.  

### Still open (school / brand, not blocking docs)

1. Confirm school FERPA policy ownership of exports.  
2. Official SJC brand licensing if/when school-owned marks are used (current Tapin · SJC pack uses original mark).  

## 13. Index of specs and plans

| Design | Plan |
|---|---|
| [01 Scan engine](design/01-scan-engine.md) | [plan](plans/01-scan-engine.md) |
| [02 Bodies / sessions / taps](design/02-attendance-bodies-sessions-taps.md) | [plan](plans/02-attendance-bodies-sessions-taps.md) |
| [03 Roster import](design/03-roster-import.md) | [plan](plans/03-roster-import.md) |
| [04 Theme system](design/04-theme-system.md) | [plan](plans/04-theme-system.md) |
| [05 PIN and roles](design/05-pin-and-roles.md) | [plan](plans/05-pin-and-roles.md) |
| [06 Export and SoR](design/06-export-and-sor.md) | [plan](plans/06-export-and-sor.md) |
| [07 Update checker](design/07-update-checker.md) | [plan](plans/07-update-checker.md) |