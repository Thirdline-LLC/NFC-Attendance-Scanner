# Apple Developer ID, notarization, and managed deployment

**Status (Wave 1):** notarization is **un-deferred**. Shipping a notarized /
sideloadable DMG from GitHub Releases is Must #9 / Phase 2. The work is
**blocked on procurement**, not on missing packaging code.

Locked shell decision: **D1-a** — keep the Electron Mac shell and deliver the
Must #9 *outcome*. See
[`docs/decisions/2026-09-22-wave1-mac-shell-d1.md`](decisions/2026-09-22-wave1-mac-shell-d1.md).

Nothing in the repo still *depends* on an Apple account for day-to-day CI: the
default `package:mac` path stays ad-hoc (`identity: "-"`, `notarize: false`) so
unsigned verify jobs keep working. The signed route is opt-in via
`package:mac:signed` on a Mac that holds the certificate.

## Blocker — exact Asher asks (W1-I)

Until these exist on the build Mac (M2 Air), **W1-J cannot produce a notarized
binary**. No Linux agent and no GitHub Actions job in this wave will notarize.

| # | Ask | Done when |
|---|---|---|
| 1 | Enrol / renew **Apple Developer Program** membership ($99/year), in the **school's** name (not a personal Apple ID — the certificate should outlive whoever set it up) | Membership active; Team ID known |
| 2 | Create a **Developer ID Application** certificate (not "Mac App Distribution") and install it in the build Mac's **login** keychain | `security find-identity -v -p codesigning` shows `Developer ID Application: … (TEAMID)` |
| 3 | Create an **app-specific password** at appleid.apple.com for notarization (not the Apple ID password) | Password stored in a password manager / keychain — **never** in git, chat, or a workflow log |
| 4 | Confirm custody: which machine holds the cert (M2 Air), who owns it, and that credentials stay local for Wave 1 (no Apple secrets in Actions yet) | Short custody note (may live outside this repo) |

Env vars the signed build expects once the above is ready (export in the shell;
never commit):

```bash
export SJC_SIGNING_IDENTITY="Developer ID Application: <school> (TEAMID)"
export APPLE_ID=...
export APPLE_APP_SPECIFIC_PASSWORD=...
export APPLE_TEAM_ID=...
```

Operator steps after that: [`docs/wave1-mac-dmg-runbook.md`](wave1-mac-dmg-runbook.md)
and [`docs/desktop-macos.md`](desktop-macos.md) §§6–9.

## What we ship today (until W1-J)

An **ad-hoc signed** `.app` inside a `.dmg`. Ad-hoc means the binary carries a
signature but asserts no identity — nobody can tell from the app who built it.

That is enough to *run*: Apple Silicon refuses to launch a binary with no
signature at all, and the ad-hoc one satisfies that. It is not enough to arrive
*silently*: Gatekeeper quarantines any copy that came from another machine, and
the person receiving it has to clear that once, by hand.

See `docs/desktop-macos.md` for the exact steps. Wave 1's goal is to retire that
manual step for operators by shipping a notarized DMG from a GitHub Release.

## What Developer ID + notarization buys

| | Today (ad-hoc) | With Developer ID + notarization |
|---|---|---|
| Runs on Apple Silicon | yes | yes |
| Opens on a colleague's Mac | after one manual step | **double-click, no warning** |
| Every subsequent update | the manual step again | silent (still manual Download of the next Release — no in-app updater) |
| Recipient can verify who built it | no | yes, cryptographically |
| Works with MDM push (Jamf/Mosyle/Kandji/Intune) | not really | yes (out of scope for v1) |
| Survives Apple tightening Gatekeeper further | unknown | yes |

The second and third rows are the real argument. The manual step teaches staff
to click past a security warning — which is exactly the habit that gets a
school compromised — and because it repeats on every update, people stop
updating.

## What is already in place

The packaging work is done; only the account / certificate / password are
missing.

- `electron/entitlements.mac.plist` already carries what notarization requires,
  including `disable-library-validation` — which Apple accepts, so the same
  file works for both routes.
- `hardenedRuntime: true` is already on.
- `electron-builder.yml` has `notarize: false` and `identity: "-"`; the signed
  route overrides those at build time via `package:mac:signed` / CLI flags.
  **Do not flip the checked-in defaults until W1-J** — that would break
  unsigned CI / Linux packaging attempts.
- `publish: null` stays — uploading a DMG to a GitHub Release is a human /
  scripted publishing step, not an in-app update feed. Never add
  `electron-updater`.
- `pnpm run package:mac:signed` exists and reads `$SJC_SIGNING_IDENTITY` plus
  the standard `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID`
  environment variables.
- `docs/desktop-macos.md` documents signing, notarization, stapling and
  verification end to end; `docs/wave1-mac-dmg-runbook.md` is the short
  operator checklist for Wave 1.

**To pick it up (W1-J), on the M2 Air only:**

```bash
export SJC_SIGNING_IDENTITY="Developer ID Application: <school> (TEAMID)"
export APPLE_ID=... APPLE_APP_SPECIFIC_PASSWORD=... APPLE_TEAM_ID=...
pnpm --filter @workspace/nfc-attendance-scanner run package:mac:signed
# then verify / staple / upload — see docs/wave1-mac-dmg-runbook.md
```

When the notarized path is the only path operators use, delete the
`identity: "-"` line from `electron-builder.yml` as part of W1-J (not this
prep PR).

## Still deferred / out of Wave 1 scope

- **MDM deployment** (Jamf, Mosyle, Kandji, Intune). Must #9: no MDM for v1.
  All four want a signed `.pkg`; notes stay in `docs/desktop-macos.md` for later.
- **Mac App Store.** Not wanted; different signing identity, entitlements, and
  sandbox.
- **Choosing a static host for the PWA.** Unrelated; `docs/pwa-hosting.md`.
- **Android release signing.** Debug APK today; `docs/android-packaging.md` §6.
- **CI notarization with Apple secrets in Actions.** Wave 1 builds on the Mac
  locally; do not add workflows that hold Apple credentials.

## The one thing that is not deferrable

Whatever route is taken, the app's identity must not change:

```
bundle id        org.stjohnschs.attendance
renderer origin  app://attendance
data directory   ~/Library/Application Support/SJC Attendance
```

Signing an app does not change these, and switching from ad-hoc to Developer ID
will **not** cost anyone their data. Renaming any of them would.
