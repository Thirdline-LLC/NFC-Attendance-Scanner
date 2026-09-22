# W1-J — Cap Mac shell status (Wave 1)

**Slice:** W1-J · **Product:** Tapin · **Shell lock:** D1 Cap  
**Baseline tip at assign:** `395fdd181fc05395abf4e02db9969536f4d81fb6` (#5 Cap decision merged)  
**App root:** `artifacts/nfc-attendance-scanner/`

## Ownership (what “Cap Mac” means)

Capacitor has **no first-party macOS target**. Wave 1 Cap Mac is operational:

1. **Cap-managed webDir** — same Capacitor web bundle as Android/iOS  
   (`capacitor.config.ts` → `webDir: 'dist/public'`; `pnpm run build:native`).
2. **Cap-compatible desktop packaging** → arm64 DMG uploaded to **GitHub Releases**.

The hand-written `electron/` tree is the **packaging substrate under Cap ownership**
for Wave 1 until `@capawesome/capacitor-electron` (or equivalent Cap desktop
platform) cutover is proven on Asher’s M2 Air. That cutover is **not** done in
this slice: installing Cap desktop from a Linux API-only agent risks breaking
Android/iOS sync; Asher Mac steps for a future cutover are listed below.

Decision: [`docs/decisions/2026-09-22-wave1-mac-shell-d1.md`](decisions/2026-09-22-wave1-mac-shell-d1.md).

## Code / script pointers

| Path | Role |
|---|---|
| `artifacts/nfc-attendance-scanner/capacitor.config.ts` | Cap appId / webDir (shared with Android/iOS) |
| `artifacts/nfc-attendance-scanner/electron/` | Cap-owned packaging substrate (main, preload, resources) |
| `artifacts/nfc-attendance-scanner/electron-builder.yml` | DMG packaging; **`identity: "-"`**, **`notarize: false`**, **`publish: null`** stay checked-in |
| `package.json` scripts | `package:mac:unsigned` / `package:mac:arm64` (W1-J aliases); `package:mac:signed` (gated on W1-I) |
| `scripts/verify-mac-build.sh` | Post-package checks (must run on macOS) |
| [`docs/wave1-mac-dmg-runbook.md`](wave1-mac-dmg-runbook.md) | Operator runbook — **unsigned first**, then optional notarized |
| [`docs/wave1-w1j-blocked-handoff-w1i.md`](wave1-w1j-blocked-handoff-w1i.md) | Exact Asher W1-I asks blocking notarized DMG |

## Origin hard gate

Renderer origin **`app://attendance`**, bundle id `org.stjohnschs.attendance`, and
data dir `~/Library/Application Support/SJC Attendance` are permanent.

Before any Cap desktop platform cutover that replaces a running install:

- **Preserve** `app://attendance` (and identity / data dir), **or**
- **Export-then-reinstall** per [`docs/data-and-backup.md`](data-and-backup.md).

Do not orphan IndexedDB rosters.

## What this Linux agent did / did not do

| Did | Did not |
|---|---|
| Document Cap ownership + substrate pointers | Produce a real Mac DMG (impossible on Linux) |
| Add unsigned/arm64 script aliases | Flip `identity` / `notarize` in `electron-builder.yml` |
| Tighten unsigned-first runbook + Releases upload | Add Apple secrets to Actions |
| Name exact W1-I blockers for notarize | Install `@capawesome/capacitor-electron` (API-only risk to Android/iOS) |
| | Claim a DMG was built or notarized |
| | Add Live Update / `electron-updater` / Replit / PII |

## Future Cap desktop platform (Asher Mac only)

When ready to prove `@capawesome/capacitor-electron` (or equiv) cutover:

1. On the M2 Air, from app root, install the Cap desktop package **and** add the
   minimal Cap config files that package requires — without changing Android/iOS
   `webDir` / schemes / hostname.
2. Re-verify renderer origin is still `app://attendance` (or run export-then-reinstall).
3. Re-point `package:mac:*` scripts only after a green local unsigned DMG +
   `verify:mac`.
4. Keep `publish: null`; never add `electron-updater`.

Until that is proven, keep using the Cap-owned `electron/` substrate scripts.

## Done-when for W1-J

- Cap Mac DMG **installable from Releases**, **or**
- Blocked handoff naming exact Asher W1-I asks (see
  [`wave1-w1j-blocked-handoff-w1i.md`](wave1-w1j-blocked-handoff-w1i.md)).

Unsigned DMG for M2 Air → Asher runs `package:mac:unsigned` on macOS (see runbook).
Notarized path remains blocked until W1-I procurement is verified.
