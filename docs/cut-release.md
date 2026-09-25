# Cutting a Mac release

The operator checklist for producing and publishing a GitHub Release of the
macOS build. This mirrors the path already used for v1.0.0 and v1.0.1 (see
[docs/wave1-mac-dmg-runbook.md](wave1-mac-dmg-runbook.md) for the fuller Wave 1
version of this, including the notarized path). This doc **describes** the
commands; running them, tagging, and publishing is a separate, manual step —
not something this repo's CI does for you.

**Must build on a Mac.** electron-builder can only produce an `.icns`, sign
with a Developer ID certificate, or notarize on macOS. There is no CI job that
produces the DMG (see [Why no Apple secrets in Actions](#why-no-apple-secrets-in-actions)
below) — a real Mac runs every step here.

## 0. Preconditions

- [ ] `version` bumped in `artifacts/nfc-attendance-scanner/package.json`
- [ ] `pnpm --filter @workspace/nfc-attendance-scanner run test` passes
- [ ] `pnpm --filter @workspace/nfc-attendance-scanner run typecheck` passes
- [ ] `docs/releases/v<version>.md` written (operator-facing notes for this cut)
- [ ] Node matches `engines` in the app's `package.json`; pnpm matches the
      `packageManager` field at the repo root

## 1. Build the DMG (unsigned / ad-hoc — the pilot path)

From the repository root, on the Mac that will do the build:

```bash
pnpm install
pnpm --filter @workspace/nfc-attendance-scanner run test
pnpm --filter @workspace/nfc-attendance-scanner run typecheck
pnpm --filter @workspace/nfc-attendance-scanner run package:mac:unsigned
pnpm --filter @workspace/nfc-attendance-scanner run verify:mac
```

`package:mac:unsigned` builds **arm64 only** with the checked-in ad-hoc
defaults (`identity: "-"`, `notarize: false`) — do not flip those defaults in
`electron-builder.yml` for this path. `verify:mac` is read-only and checks the
bundle id, name and version, that the signature verifies, and that nothing
Replit-related or any service worker made it into the bundle. Do not skip it.

Output:

```
artifacts/nfc-attendance-scanner/dist/desktop/SJC Attendance-<version>-arm64.dmg
```

If a signed, notarized build is available instead (Developer ID certificate
and app-specific password already in the build Mac's keychain, never in a
commit or CI secret), use `package:mac:signed` in place of
`package:mac:unsigned` — see [docs/desktop-macos.md §§6–8](desktop-macos.md).
That path is gated on
[docs/deferred-apple-developer.md](deferred-apple-developer.md) and is not
required for this cut.

## 2. Compute the DMG's SHA-256 sidecar

The in-place updater (`docs/plans/07-update-checker.md`) and a manual
`shasum -a 256 -c` both expect a bare-filename sidecar in `shasum`'s own
format — generate it from inside the output directory so the sidecar doesn't
carry a path:

```bash
cd artifacts/nfc-attendance-scanner/dist/desktop
shasum -a 256 "SJC Attendance-<version>-arm64.dmg" > "SJC Attendance-<version>-arm64.dmg.sha256"
cd -
```

## 3. Pack and checksum the theme

Only needed if the theme changed since the last release (check
`lib/themes/orgs/tapin-sjc/manifest.json`'s `meta.version` against the last
released `tapin-sjc-v<version>.nfc-theme` asset):

```bash
pnpm --filter @workspace/themes run pack tapin-sjc
```

Writes `lib/themes/fixtures/tapin-sjc-v<version>.nfc-theme` and its
`.sha256` sidecar (pack script computes both; see
`lib/themes/scripts/pack.mjs`). Themes carry branding only — never a checksum
covers student data, because none is ever embedded.

## 4. Assemble the release assets

You should now have, for this cut:

| File | From |
|---|---|
| `SJC Attendance-<version>-arm64.dmg` | step 1 |
| `SJC Attendance-<version>-arm64.dmg.sha256` | step 2 |
| `tapin-sjc-v<version>.nfc-theme` | step 3 (if changed) |
| `tapin-sjc-v<version>.nfc-theme.sha256` | step 3 (if changed) |

If the theme did not change, reuse the previous release's theme asset names
in the notes so the update checker's theme-version comparison still has
something to compare against.

## 5. Create a draft Release, verify, then publish

**This PR does not tag or publish anything.** When it's time to actually cut
the release:

```bash
gh release create "v<version>" \
  --repo Thirdline-LLC/NFC-Attendance-Scanner \
  --title "Tapin / SJC Attendance <version>" \
  --notes-file docs/releases/v<version>.md \
  --draft \
  "SJC Attendance-<version>-arm64.dmg" \
  "SJC Attendance-<version>-arm64.dmg.sha256" \
  "tapin-sjc-v<version>.nfc-theme" \
  "tapin-sjc-v<version>.nfc-theme.sha256"
```

`--draft` lets you download the assets back and verify them (`shasum -a 256
-c`, install on a clean Mac, confirm the update checker on a v1.0.1 install
sees this as newer) before anyone else can see it. Then:

```bash
gh release edit "v<version>" --repo Thirdline-LLC/NFC-Attendance-Scanner --draft=false
```

Do not delete the previous release when publishing a new one — the update
checker's "known good" fallback and anyone still on an older install depend on
past Release pages staying reachable.

## Guards (do not violate)

| Guard | Why |
|---|---|
| No Apple secrets (`APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, signing identity) in any GitHub Actions workflow | This repo's only workflow (`.github/workflows/verify.yml`) runs on `ubuntu-latest` and has no code path that needs them; adding them would put Apple credentials in CI secrets for no reason, and any macOS runner added later must still keep signing local-keychain-only, per `docs/desktop-macos.md` §7 |
| `electron-builder.yml` keeps `publish: null`; never add `electron-updater`, Capacitor Live Update, or any in-app update feed | The in-place updater is a teacher-initiated, PIN-gated helper this repo owns — not an automatic feed. See `docs/wave1-mac-dmg-runbook.md` |
| Do not tag or publish a Release from an agent session or from this PR | Publishing is a human, verified step — see step 5 |
| No student PII, real card UIDs, or secrets in Release notes | Same rule as everywhere else in this repo — see `CLAUDE.md` |
| arm64 only unless a real Intel Mac is available to build and test on | Universal/`:both` builds pull a second Electron runtime; avoid on constrained hardware |

## Why no Apple secrets in Actions

There is deliberately no macOS CI runner and no signing step in
`.github/workflows/verify.yml`. Signing credentials belong in the build Mac's
keychain or a password manager, never in repository secrets, per
[docs/desktop-macos.md §7](desktop-macos.md#7-notarization) ("Never put these
in a file in the repository, a commit, a CI log, or a chat message"). If a
signed, notarized CI pipeline is ever wanted, that is a separate decision with
its own review — not something to add quietly while bumping a version.
