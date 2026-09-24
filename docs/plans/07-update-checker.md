# Plan 07-update-checker — Update checker

**Design:** [design/07-update-checker.md](../design/07-update-checker.md) · **Blueprint:** [blueprint-final.md](../blueprint-final.md)

## Amendment — in-place replacement (2026-09-24)

The original plan said the app path opens instructions or a downloaded artifact and does not replace itself. That is withdrawn. The macOS app downloads the public arm64 disk image, verifies SHA-256, replaces the installed `.app`, and relaunches. The teacher confirms by using the PIN-gated Check for updates control and then Install and relaunch. Theme packs are unchanged.

No central server. Each device pulls `Thirdline-LLC/NFC-Attendance-Scanner` Releases on its own. The repository is public; a token is not required. Do not add `electron-updater`. Do not set `publish` to anything but `null`.

## Dependencies

- Public GitHub Releases on `Thirdline-LLC/NFC-Attendance-Scanner`
- Theme verifier (Plan 04)
- Packaged macOS app for the in-place swap (`hdiutil`, a detached helper). Linux CI does not mount disk images.

## What landed

1. `lib/update` (`@workspace/update`) — release metadata, semver decision, SHA-256, arm64 asset choice, install progress state machine, bundle-path resolution, helper scripts, and the in-place sequence behind a fakeable host.
2. Dashboard Update card — PIN already gates `/dashboard`. Labels: Checking for updates, Downloading, Installing, Relaunching, Up to date. Errors stay on the card.
3. Theme path still calls `downloadVerifiedAsset` and Plan 04's activator.
4. Electron main process — `attendance:install-app-update` plus `attendance:update-progress`. The helper waits for the app pid, swaps the bundle, clears quarantine, and opens the new app.
5. `docs/update-token-ops.md` — public repo needs no token; a device-ops token is only for a private repo or a shared NAT that is rate-limited. It is not student data.

## Acceptance criteria

- Checksum failure refuses install and does not mount or quit.
- No student data in requests, responses, or the helper script.
- Offline shows a manual Releases link and does not crash.
- A newer arm64 release is selected over an x64 disk image.
- Progress labels match the state machine.
- The installed bundle is resolved from `process.execPath`, not only `/Applications`.

## Copy-pasteable commands

```bash
pnpm --filter @workspace/update run test
pnpm --filter @workspace/nfc-attendance-scanner run test
pnpm --filter @workspace/nfc-attendance-scanner run typecheck
gh release view --repo Thirdline-LLC/NFC-Attendance-Scanner
```

## End-to-end on a Mac (CoS) — 1.0.0 → 1.0.1

This environment is Linux. It cannot mount a DMG or sign a Mac app. Do **not** delete the existing GitHub Release `v1.0.0`. The asset already attached to that release was built before in-place install existed, so it will not replace itself. The 1.0.0 you install for this test has to be built from a tree that contains this change, with `package.json` still at `1.0.0`.

On the school M2 Air (arm64 only — do not run `:both` or `:universal`):

```bash
# Tree that contains the in-place updater. version stays 1.0.0.
pnpm install
pnpm --filter @workspace/update run test
pnpm --filter @workspace/nfc-attendance-scanner run package:mac:arm64

# Install that build (drag to /Applications, or):
hdiutil attach "artifacts/nfc-attendance-scanner/dist/desktop/SJC Attendance-1.0.0-arm64.dmg" -nobrowse
cp -R "/Volumes/SJC Attendance/SJC Attendance.app" /Applications/
hdiutil detach "/Volumes/SJC Attendance"
xattr -dr com.apple.quarantine "/Applications/SJC Attendance.app"
open "/Applications/SJC Attendance.app"
```

Confirm the running app says v1.0.0 and that a roster is present (export first if this is a machine you care about). Quit it.

Then build **1.0.1** from the same tree after bumping only the scanner version:

```bash
# artifacts/nfc-attendance-scanner/package.json → "version": "1.0.1"
pnpm --filter @workspace/nfc-attendance-scanner run package:mac:arm64

DMG="artifacts/nfc-attendance-scanner/dist/desktop/SJC Attendance-1.0.1-arm64.dmg"
shasum -a 256 "$DMG" | tee "${DMG}.sha256"

# Sidecar name must be the disk image name plus .sha256.
# Bare hex or "hex  filename" both verify.

git tag v1.0.1
git push origin v1.0.1
gh release create v1.0.1 \
  "$DMG" \
  "${DMG}.sha256" \
  --repo Thirdline-LLC/NFC-Attendance-Scanner \
  --title "v1.0.1" \
  --notes "In-place update test. Leave v1.0.0 in place."
```

On the Mac that has the locally built 1.0.0 in `/Applications`:

1. Open SJC Attendance (from Applications, not from the disk image).
2. Teacher PIN → Dashboard → **Check for updates**. The card says Checking for updates, then that v1.0.1 is available.
3. **Install and relaunch.** The card moves through Downloading, Installing, Relaunching. The app quits and comes back.
4. Version reads v1.0.1. The roster is still there (`~/Library/Application Support/SJC Attendance` was not replaced).
5. Check again. The card says **Up to date**.

If the copy was opened from the DMG or from a quarantined download (App Translocation), the card refuses and tells you to move the app to Applications. A standard account that cannot write `/Applications` gets one macOS administrator prompt during the swap.

`publish` in `electron-builder.yml` stays `null`. Do not add `electron-updater`.
