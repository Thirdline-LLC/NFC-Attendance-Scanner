# Design 07 — Update checker (binaries + themes)

**Status:** Amended 2026-09-24 — macOS app updates replace the installed bundle in place  
**Plan:** [plans/07-update-checker.md](../plans/07-update-checker.md)  
**Aligns with:** D1 — GitHub Releases distribution; no Live Update / `electron-updater` / peer sync.  
**Override:** The 2026-09-23 line “hand to OS installer / open DMG, no silent in-place” is withdrawn. Asher requires a confirmed in-place replace of the running `.app`.

## Overview

Optional teacher PIN-gated “Check for updates” reads **public GitHub Releases** on `Thirdline-LLC/NFC-Attendance-Scanner` for a newer app disk image and `.nfc-theme` assets, verifies SHA-256, and then:

- **macOS app:** downloads the arm64 `.dmg`, checks it, replaces the installed bundle (the one this process is running from — usually `/Applications/SJC Attendance.app`), and relaunches.
- **Theme pack:** writes nothing to the bundle; the verified pack goes through the existing theme activator.

The check is not silent. The teacher opens Dashboard (already PIN-gated) and presses Check for updates, then Install and relaunch. Many devices each pull the public Release on their own. There is no central update server.

**Never** uploads or downloads student databases. The network path is binaries and theme packs only.

## UI notes

- Dashboard card: current app version, active theme id/version, last checked.
- Progress labels, in order: **Checking for updates**, **Downloading**, **Installing**, **Relaunching**.
- **Up to date** when the latest release is not newer.
- Clear separation: “App update” vs “Theme pack.”
- A network or checksum failure shows a message on the card. The app keeps running. Checksum mismatch installs nothing.
- Fail closed on checksum mismatch.

## Data flow

1. GET `https://api.github.com/repos/Thirdline-LLC/NFC-Attendance-Scanner/releases/latest` with no token. The repo is public. A device-ops token remains optional if a school NAT hits the unauthenticated rate limit; it is never stored with student data.
2. Compare the release tag with the running app version. On macOS, choose the **arm64** `.dmg` when the release published more than one. An x64-only disk image is not offered to an arm64 Mac.
3. Download the asset and its `.sha256` sibling from the public release URL. Verify SHA-256 in memory. Mismatch → stop. Do not mount, do not write the bundle.
4. **App (packaged macOS):** mount the disk image read-only (`hdiutil`), copy `SJC Attendance.app` to a staging directory, detach, spawn a detached helper, quit. The helper waits until this process has exited, moves the old bundle aside, copies the new one into the same path, clears the quarantine attribute, and opens the new app. If the copy fails, the previous bundle is put back. If the folder is not writable, macOS asks for an administrator password once — still local, still no upload.
5. **Theme:** verified text → existing ed25519 / pack loader → activate or keep the previous theme. `minAppVersion` still refuses a pack this app is too old to run.

The bundle path comes from `process.execPath`, three directories up from `Contents/MacOS`. A copy installed on the Desktop is replaced there. A copy still running from the disk image, or from macOS App Translocation, is refused with a message to move it into Applications first.

## Edge cases

- Offline / firewall — show the manual Releases URL. Do not crash.
- GitHub rate limit (60 unauthenticated REST calls/hour/IP, shared by every kiosk behind one school NAT) — the card says so. Asset bytes use the public download URL so the disk image itself is not an API call. Metadata still is.
- minAppVersion on a theme newer than the app — refuse the theme, prompt the app update first.
- **D-T3 (2026-09-23):** School Wi‑Fi → GitHub Releases is **allowed**.
- Tamper/corrupt asset → refuse. Nothing is installed.
- Ad-hoc signed builds (the default, `identity: "-"`) are quarantined when they come from the internet. The helper runs `xattr -dr com.apple.quarantine` on the replaced bundle. A notarized Developer ID build does not need that; clearing the attribute is harmless.
- Gatekeeper can still refuse a damaged or half-copied bundle. The helper rolls back to the previous `.app` and opens that if the copy fails.
- `/Applications` may not be writable for a standard account. The helper retries the swap with an administrator prompt. Cancelling the prompt leaves the previous app in place and reopens it.
- Replacing the `.app` does not touch `~/Library/Application Support/SJC Attendance`. Rosters and taps stay on the machine. Bundle id, `app://attendance`, and the data directory do not change.
- Development and unpackaged Electron builds refuse in-place install. They are not the installed app.
- This is **not** `electron-updater` and **not** Capacitor Live Update. `electron-builder.yml` keeps `publish: null`. There is no update feed.

## FERPA

Network path is binaries and themes only — never student DBs. The helper script has no network and does not read Application Support.

## Out of scope

Peer sync; pushing rosters via Releases; replacing the app without the teacher pressing Check for updates and Install and relaunch; deleting or replacing the existing `v1.0.0` GitHub Release from this change.
