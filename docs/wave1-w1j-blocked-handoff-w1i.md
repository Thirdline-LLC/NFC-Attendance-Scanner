# W1-J blocked handoff → Asher W1-I (notarized Cap Mac DMG)

**Status:** Apple credentials for Wave 1 are **UNVERIFIED**.  
**Audience:** Asher (build Mac = school M2 Air, arm64, 8 GB).  
**Slice:** W1-J Cap Mac packaging scaffold is in-repo; notarized binary is **not**.

## Hard fact

**Linux CPM / this agent cannot ship an installable notarized DMG.**  
electron-builder cannot produce a real `.icns`/signed Mac app off Darwin.  
An **unsigned/ad-hoc DMG** also requires Asher to run the package script **on the M2 Air**.

CI green ≠ notarized binary. Do not invent credentials.

## Exact Asher asks (W1-I)

| # | Ask | Done when | Custody |
|---|---|---|---|
| 1 | **Apple Developer Program** membership in the **school’s** name | Membership active; **Team ID** known | School org account |
| 2 | **Developer ID Application** certificate installed in M2 Air **login** keychain | `security find-identity -v -p codesigning` lists `Developer ID Application: … (TEAMID)` | **M2 Air holds cert for Wave 1** |
| 3 | **App-specific password** (appleid.apple.com) for notarization | Password in password manager / keychain only | **Local only — never git, chat, or CI** |
| 4 | Custody note: which machine holds creds, who owns them | Short note (may live outside this repo) | M2 Air = Wave 1 build Mac |

Env vars once ready (export in shell; **never commit**):

```bash
export SJC_SIGNING_IDENTITY="Developer ID Application: <school> (TEAMID)"
export APPLE_ID="…"
export APPLE_APP_SPECIFIC_PASSWORD="…"
export APPLE_TEAM_ID="…"
```

## What Asher can do now (unsigned / ad-hoc) without W1-I

On the M2 Air, after checkout + `pnpm install` at repo root:

```bash
pnpm --filter @workspace/nfc-attendance-scanner run package:mac:unsigned
# alias: package:mac:arm64
pnpm --filter @workspace/nfc-attendance-scanner run verify:mac
```

Expect Gatekeeper quarantine on copies that left the build Mac — clear once with
`xattr -dr com.apple.quarantine "/Applications/SJC Attendance.app"` (details in
[`wave1-mac-dmg-runbook.md`](wave1-mac-dmg-runbook.md) § W1-J unsigned first).

Upload the resulting DMG + SHA-256 to a GitHub Release when ready (`publish: null`
stays; no `electron-updater`).

## What remains blocked until W1-I

- `package:mac:signed` / notarize / staple / `spctl` “Notarized Developer ID”
- Flipping checked-in `identity: "-"` / `notarize: false` in `electron-builder.yml`
- Any Actions workflow holding Apple secrets

Operator path after W1-I: [`wave1-mac-dmg-runbook.md`](wave1-mac-dmg-runbook.md)
§ signed (optional, gated on W1-I). Background:
[`deferred-apple-developer.md`](deferred-apple-developer.md).

## Guards

- No Apple secrets in git, chat, or GitHub Actions (Wave 1).
- No Live Update / `electron-updater`; keep `publish: null`.
- No student PII / card UIDs in Release notes.
- Origin hard gate: preserve `app://attendance` **or** export-then-reinstall.
