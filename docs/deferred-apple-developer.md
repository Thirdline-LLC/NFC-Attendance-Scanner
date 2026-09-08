# Deferred: Apple Developer ID, notarization, and managed deployment

**Status: not done, on purpose.** Asher asked to skip this and ship an ad-hoc
signed build that installs on other MacBooks by hand. This note records what
was skipped, what it would buy, and what it would cost, so the decision can be
revisited without re-deriving it.

Nothing in the repo depends on any of this. The current build works without an
Apple account.

## What we ship today

An **ad-hoc signed** `.app` inside a `.dmg`. Ad-hoc means the binary carries a
signature but asserts no identity — nobody can tell from the app who built it.

That is enough to *run*: Apple Silicon refuses to launch a binary with no
signature at all, and the ad-hoc one satisfies that. It is not enough to arrive
*silently*: Gatekeeper quarantines any copy that came from another machine, and
the person receiving it has to clear that once, by hand.

See `docs/desktop-macos.md` for the exact steps.

## What Developer ID + notarization would buy

| | Today (ad-hoc) | With Developer ID + notarization |
|---|---|---|
| Runs on Apple Silicon | yes | yes |
| Opens on a colleague's Mac | after one manual step | **double-click, no warning** |
| Every subsequent update | the manual step again | silent |
| Recipient can verify who built it | no | yes, cryptographically |
| Works with MDM push (Jamf/Mosyle/Kandji/Intune) | not really | yes |
| Survives Apple tightening Gatekeeper further | unknown | yes |

The second and third rows are the real argument. The manual step teaches staff
to click past a security warning — which is exactly the habit that gets a
school compromised — and because it repeats on every update, people stop
updating.

## What it would cost

- **$99/year**, Apple Developer Program, in the school's name (not a personal
  Apple ID — the certificate should outlive whoever set it up).
- A one-time setup: create a *Developer ID Application* certificate, install it
  in the build Mac's login keychain, create an app-specific password.
- **A few minutes per release**: notarization is a round trip to Apple.
- One Mac that holds the certificate and does the release builds.

## What is already in place for it

The work is done; only the account is missing.

- `electron/entitlements.mac.plist` already carries what notarization requires,
  including `disable-library-validation` — which Apple accepts, so the same
  file works for both routes.
- `hardenedRuntime: true` is already on.
- `electron-builder.yml` has `notarize: false` and `identity: "-"`; the signed
  route replaces exactly those two values.
- `pnpm run package:mac:signed` exists and reads `$SJC_SIGNING_IDENTITY` plus
  the standard `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID`
  environment variables.
- `docs/desktop-macos.md` documents signing, notarization, stapling and
  verification end to end.

**To pick it up later:** buy the membership, create the certificate, then

```bash
export SJC_SIGNING_IDENTITY="Developer ID Application: <school> (TEAMID)"
export APPLE_ID=... APPLE_APP_SPECIFIC_PASSWORD=... APPLE_TEAM_ID=...
pnpm --filter @workspace/nfc-attendance-scanner run package:mac:signed
```

and delete the `identity: "-"` line from `electron-builder.yml`.

## Also deferred

- **MDM deployment** (Jamf, Mosyle, Kandji, Intune). All four want a signed
  `.pkg`, so this is blocked on the above rather than being separate work.
  Notes are in `docs/desktop-macos.md`.
- **Mac App Store.** Not wanted; it is a different signing identity, a
  different entitlement set, and a sandbox this app does not opt into.
- **Choosing a static host for the PWA.** Unrelated to any of the above, still
  open. `docs/pwa-hosting.md` covers what a host has to provide.
- **Android release signing.** The debug APK builds and installs today. A
  release keystore has not been created; `docs/android-packaging.md` §6 has the
  procedure and the warnings about never losing the key.

## The one thing that is not deferrable

Whatever route is taken later, the app's identity must not change:

```
bundle id        org.stjohnschs.attendance
renderer origin  app://attendance
data directory   ~/Library/Application Support/SJC Attendance
```

Signing an app does not change these, and switching from ad-hoc to Developer ID
will **not** cost anyone their data. Renaming any of them would.
