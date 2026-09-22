# Wave 1 — notarized Mac DMG operator runbook

**Audience:** Asher (or the person at the M2 Air) after W1-I procurement.  
**Shell:** Electron, locked **D1-a** —
[`docs/decisions/2026-09-22-wave1-mac-shell-d1.md`](decisions/2026-09-22-wave1-mac-shell-d1.md).  
**Machine:** school M2 Air, **arm64 only** (8 GB — no universal / parallel heavy builds).  
**This Linux agent cannot notarize.** Do not treat any CI green check as a
notarized binary.

Full background: [`docs/desktop-macos.md`](desktop-macos.md) §§6–9,
[`docs/deferred-apple-developer.md`](deferred-apple-developer.md).

## 0. Preconditions (W1-I)

- [ ] Apple Developer Program active (school account)
- [ ] Developer ID Application cert in **login** keychain
- [ ] `security find-identity -v -p codesigning` lists it
- [ ] App-specific password created; stored outside git
- [ ] Repo checked out on the M2; `pnpm install` at root

## 1. Env vars (shell only — never commit)

```bash
export SJC_SIGNING_IDENTITY="Developer ID Application: <school> (TEAMID)"
export APPLE_ID="…"
export APPLE_APP_SPECIFIC_PASSWORD="…"
export APPLE_TEAM_ID="…"
```

## 2. Build, notarize, staple

From the repository root on the M2:

```bash
pnpm --filter @workspace/nfc-attendance-scanner run test
pnpm --filter @workspace/nfc-attendance-scanner run typecheck
pnpm --filter @workspace/nfc-attendance-scanner run package:mac:signed
pnpm --filter @workspace/nfc-attendance-scanner run verify:mac
```

Expected artefact (version may differ):

`artifacts/nfc-attendance-scanner/dist/desktop/SJC Attendance-<version>-arm64.dmg`

If stapling did not happen automatically:

```bash
xcrun stapler staple "artifacts/nfc-attendance-scanner/dist/desktop/SJC Attendance-<version>-arm64.dmg"
xcrun stapler validate "artifacts/nfc-attendance-scanner/dist/desktop/SJC Attendance-<version>-arm64.dmg"
```

## 3. Verify Gatekeeper outcome

Install from the DMG, then:

```bash
codesign --verify --deep --strict --verbose=2 "/Applications/SJC Attendance.app"
spctl --assess --type execute --verbose "/Applications/SJC Attendance.app"
# want: accepted / source=Notarized Developer ID
```

On a Mac that has **never** seen the app: double-click must open with **no**
`xattr -dr com.apple.quarantine` step.

## 4. Checksum

```bash
shasum -a 256 "artifacts/nfc-attendance-scanner/dist/desktop/SJC Attendance-<version>-arm64.dmg"
```

Record the hash in the Release notes (and optionally a sibling `.sha256` text
file attached to the Release).

## 5. Upload to GitHub Release (W1-L)

1. Tag the commit that produced the build (or the `main` tip that matches it).
2. Create a GitHub Release; attach the `.dmg` and the SHA-256.
3. Confirm `artifacts/nfc-attendance-scanner/electron-builder.yml` still has
   `publish: null`.
4. Confirm no updater dependency:

   ```bash
   rg -i 'electron-updater|autoUpdater|live.?update' artifacts/nfc-attendance-scanner
   ```

   Expect no matches that wire an in-app feed.

### Private-repo download note

The repo is **private**. A Release asset is not a public anonymous URL.
Operators need GitHub org access (or a person with access downloads and
AirDrops / USBs the DMG). Say that explicitly in the Release notes so nobody
assumes a cold link works from a phone browser without auth.

## 6. Guards (do not violate)

| Guard | Why |
|---|---|
| Do not flip checked-in `identity: "-"` / `notarize: false` until W1-J intentionally does | Breaks unsigned CI |
| Do not add Apple secrets to Actions workflows in Wave 1 | Must #12; local keychain only |
| Do not add `electron-updater` or change `publish: null` | Must #11 — no automatic update network path |
| Do not put student PII, real card UIDs, or secrets in Release notes | Must #3 / #4 / #12 |
| arm64 only on the M2 Air | Memory / time; no universal merge on 8 GB |

## 7. After the first notarized Release

- Optionally remove `identity: "-"` from `electron-builder.yml` so plain
  `package:mac` on a cert-bearing Mac does not stay ad-hoc by accident (W1-J
  product follow-up, not this prep).
- Point operators at the Release URL; retire the quarantine one-liner from
  day-to-day handouts (`README` polish can land with W1-K after the binary
  exists).
