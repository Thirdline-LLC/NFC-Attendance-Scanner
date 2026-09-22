# Wave 1 — Cap Mac DMG operator runbook

**Audience:** Asher (or the person at the M2 Air).  
**Shell:** Capacitor (D1 Cap) — Cap-managed web + Cap-compatible desktop
packaging → DMG from Releases. Supersedes prior D1-a Electron keep; hand-written
`electron/` is Cap-owned packaging substrate for Wave 1 until Cap desktop
platform cutover is proven. Origin hard gate: preserve `app://attendance` **or**
export-then-reinstall before cutover —
[`docs/decisions/2026-09-22-wave1-mac-shell-d1.md`](decisions/2026-09-22-wave1-mac-shell-d1.md).  
**Machine:** school M2 Air, **arm64 only** (8 GB — no universal / parallel heavy builds).  
**This Linux agent cannot build or notarize a Mac DMG.** Do not treat any CI
green check as an installable binary.

Status / ownership pointers: [`docs/wave1-w1j-cap-mac-status.md`](wave1-w1j-cap-mac-status.md).  
W1-I blockers: [`docs/wave1-w1j-blocked-handoff-w1i.md`](wave1-w1j-blocked-handoff-w1i.md).  
Full background: [`docs/desktop-macos.md`](desktop-macos.md) §§6–9,
[`docs/deferred-apple-developer.md`](deferred-apple-developer.md).

---

## W1-J — Unsigned / ad-hoc first (M2 Air, arm64)

**Do this path first.** It needs **no** Apple Developer account. W1-I creds are
UNVERIFIED; the notarized path below stays optional and blocked until they land.

### Preconditions (unsigned)

- [ ] Repo checked out on the M2 Air; `pnpm install` at repository root
- [ ] Node matches `engines` in app `package.json` (^22.12 / ^24 / >=26)
- [ ] Build on **arm64 only** (do **not** use `package:mac:both` or
      `package:mac:universal` on 8 GB)

### Build ad-hoc DMG

From the repository root on the M2:

```bash
pnpm --filter @workspace/nfc-attendance-scanner run test
pnpm --filter @workspace/nfc-attendance-scanner run typecheck
pnpm --filter @workspace/nfc-attendance-scanner run package:mac:unsigned
# equivalent Cap-ownership alias:
# pnpm --filter @workspace/nfc-attendance-scanner run package:mac:arm64
pnpm --filter @workspace/nfc-attendance-scanner run verify:mac
```

`package:mac:unsigned` / `package:mac:arm64` build an **arm64** DMG with the
checked-in defaults (`identity: "-"`, `notarize: false`). Do **not** flip those
defaults in `electron-builder.yml` from Linux CI.

Expected artefact (version may differ):

`artifacts/nfc-attendance-scanner/dist/desktop/SJC Attendance-<version>-arm64.dmg`

### Gatekeeper expectation (unsigned / ad-hoc)

- Ad-hoc signature lets Apple Silicon **launch** the app (bare unsigned dies).
- Gatekeeper **still quarantines** a copy that arrived from another machine
  (download, AirDrop, USB, Release asset).
- On the **build Mac**, a freshly built `.app` usually opens without the
  quarantine dance; on a **recipient** Mac, clear once:

```bash
xattr -dr com.apple.quarantine "/Applications/SJC Attendance.app"
```

Or: open once → System Settings → Privacy & Security → **Open Anyway**.

`spctl --assess` will **not** say “Notarized Developer ID” for this path — that
is expected until W1-I + signed build.

### Checksum

```bash
shasum -a 256 "artifacts/nfc-attendance-scanner/dist/desktop/SJC Attendance-<version>-arm64.dmg"
```

### Upload to GitHub Releases

1. Tag the commit that produced the build (or the `main` tip that matches it).
2. Create a GitHub Release; attach the `.dmg` **and** the SHA-256 (notes and/or
   sibling `.sha256` text file).
3. Confirm `artifacts/nfc-attendance-scanner/electron-builder.yml` still has
   `publish: null` — uploading is a human / `gh release upload` step, **not**
   an in-app update feed.
4. Confirm no updater wiring:

   ```bash
   rg -i 'electron-updater|autoUpdater|live.?update' artifacts/nfc-attendance-scanner
   ```

   Expect no matches that wire an in-app feed. **Never** add `electron-updater`
   or Capacitor Live Update for Wave 1.

#### Private-repo download note

The repo is **private**. A Release asset is not a public anonymous URL.
Operators need GitHub org access (or a person with access downloads and
AirDrops / USBs the DMG). Say that explicitly in the Release notes.

---

## Optional — Signed / notarized (gated on W1-I)

**Blocked until W1-I is verified.** Exact Asher asks:
[`docs/wave1-w1j-blocked-handoff-w1i.md`](wave1-w1j-blocked-handoff-w1i.md).

### 0. Preconditions (W1-I)

- [ ] Apple Developer Program active (school account) + Team ID known
- [ ] Developer ID Application cert in **login** keychain on the M2 Air
- [ ] `security find-identity -v -p codesigning` lists it
- [ ] App-specific password created; stored **outside** git / chat / CI
- [ ] Custody: M2 Air holds creds for Wave 1

### 1. Env vars (shell only — never commit)

```bash
export SJC_SIGNING_IDENTITY="Developer ID Application: <school> (TEAMID)"
export APPLE_ID="…"
export APPLE_APP_SPECIFIC_PASSWORD="…"
export APPLE_TEAM_ID="…"
```

### 2. Build, notarize, staple

```bash
pnpm --filter @workspace/nfc-attendance-scanner run test
pnpm --filter @workspace/nfc-attendance-scanner run typecheck
pnpm --filter @workspace/nfc-attendance-scanner run package:mac:signed
pnpm --filter @workspace/nfc-attendance-scanner run verify:mac
```

If stapling did not happen automatically:

```bash
xcrun stapler staple "artifacts/nfc-attendance-scanner/dist/desktop/SJC Attendance-<version>-arm64.dmg"
xcrun stapler validate "artifacts/nfc-attendance-scanner/dist/desktop/SJC Attendance-<version>-arm64.dmg"
```

### 3. Verify Gatekeeper outcome (signed)

```bash
codesign --verify --deep --strict --verbose=2 "/Applications/SJC Attendance.app"
spctl --assess --type execute --verbose "/Applications/SJC Attendance.app"
# want: accepted / source=Notarized Developer ID
```

On a Mac that has **never** seen the app: double-click must open with **no**
`xattr -dr com.apple.quarantine` step.

Then repeat the **Checksum** and **Upload to GitHub Releases** steps from the
unsigned section above.

---

## Guards (do not violate)

| Guard | Why |
|---|---|
| Do not flip checked-in `identity: "-"` / `notarize: false` until notarized path is the only operator path | Breaks unsigned CI / Linux packaging attempts |
| Do not add Apple secrets to Actions workflows in Wave 1 | Must #12; local keychain only |
| Do not add `electron-updater`, Live Update, or change `publish: null` | Must #11 — no automatic update network path |
| Do not cut over Cap Mac packaging without origin preserve **or** export-then-reinstall | IndexedDB hard gate (`app://attendance`) |
| Do not put student PII, real card UIDs, or secrets in Release notes | Must #3 / #4 / #12 |
| arm64 only on the M2 Air | Memory / time; no universal merge on 8 GB |
| Do not claim Linux built a DMG | Impossible; Asher Mac only |

## After the first notarized Release

- Optionally remove `identity: "-"` from `electron-builder.yml` so plain
  `package:mac` on a cert-bearing Mac does not stay ad-hoc by accident
  (product follow-up after W1-I, not this scaffold).
- Point operators at the Release URL; retire the quarantine one-liner from
  day-to-day handouts (`README` polish can land with W1-K after the binary
  exists).
