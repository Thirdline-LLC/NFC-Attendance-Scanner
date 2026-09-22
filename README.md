# NFC Attendance Scanner

A kiosk for taking attendance with a USB HID NFC reader. A student taps a card,
the reader types fourteen uppercase hex characters and Enter into a hidden
always-focused input, and the tap is recorded on the device.

**There is no backend.** No server, no API, no account, no cloud, no analytics,
and no network requests at runtime at all. The roster and every attendance tap
live in the browser's IndexedDB as a **device cache**. The school workbook
(OneDrive) is the system of record — see `docs/data-and-backup.md`.

One React application ships to three places:

| Target | What it is | Where it runs |
|---|---|---|
| **Web / PWA** | Installable progressive web app on any static host | Chrome, Edge, Safari |
| **Android** | Capacitor APK / AAB, installable without Google Play | Tablet at the front desk |
| **macOS** | Electron `.app` in a `.dmg`, no Mac App Store | Teacher's MacBook |

The Android and macOS apps load their assets from inside the package. Once
installed, neither needs a website, a server or an internet connection.

## Start here

```bash
corepack enable && corepack prepare pnpm@latest --activate   # if you have no pnpm
pnpm install                                                 # from this directory
pnpm --filter @workspace/nfc-attendance-scanner run dev      # http://localhost:5173
```

### Build the Mac app

On a Mac, from this directory:

```bash
pnpm install
pnpm --filter @workspace/nfc-attendance-scanner run package:mac    # → dist/desktop/*.dmg
pnpm --filter @workspace/nfc-attendance-scanner run verify:mac     # check before sending
```

The `.dmg` installs on any Mac. It is ad-hoc signed rather than Developer ID
signed, so someone receiving it clears the quarantine flag once —
`xattr -dr com.apple.quarantine "/Applications/SJC Attendance.app"`.
[Full details](docs/desktop-macos.md), and
[why signing was skipped](docs/deferred-apple-developer.md).

## Documentation

| Guide | Covers |
|---|---|
| [docs/vscode-setup.md](docs/vscode-setup.md) | **Read this first.** Tools, versions, every command, VS Code tasks, troubleshooting |
| [docs/pwa-hosting.md](docs/pwa-hosting.md) | Building the PWA, hosting it, installing it, offline behaviour, updates |
| [docs/android-packaging.md](docs/android-packaging.md) | Android Studio, APK and AAB, signing, sideloading, kiosk mode, the HID reader |
| [docs/desktop-macos.md](docs/desktop-macos.md) | **Building the Mac app and sending it to another MacBook.** Electron development, `.app` and `.dmg`, Gatekeeper |
| [docs/deferred-apple-developer.md](docs/deferred-apple-developer.md) | What was deliberately skipped: Developer ID, notarization, MDM, and what each would buy |
| [docs/data-and-backup.md](docs/data-and-backup.md) | Where data lives on each platform, what erases it, backup and device replacement |
| [docs/capacitor-native.md](docs/capacitor-native.md) | Original Capacitor notes: IndexedDB survival on iOS/Android |
| [docs/operating-the-kiosk.md](docs/operating-the-kiosk.md) | Front-desk instructions, written for a volunteer |
| [docs/data-protection.md](docs/data-protection.md) | What student data this holds and the rules around it |

## Application identity

`org.stjohnschs.attendance` — the Android `applicationId`, the iOS bundle id,
the macOS bundle id, and the key macOS uses for the app's stored data. The
Electron renderer's origin is `app://attendance` and its data directory is
named `SJC Attendance`.

**None of these may change between releases.** Each one is what an operating
system uses to recognise an update as the *same app*; changing any of them
makes an existing install's roster and attendance history invisible. See
[docs/data-and-backup.md](docs/data-and-backup.md).

## Repository layout

A pnpm workspace. Applications live in `artifacts/*`, shared packages in
`lib/*`. The scanner is `artifacts/nfc-attendance-scanner` and depends on no
other workspace package.

```
artifacts/nfc-attendance-scanner/
  src/                  the React app — shared by all three targets
    platform/           which shell we are in; the desktop bridge contract
    pwa/                service-worker registration (web build only)
    lib/workbook-delivery.ts   the one place the three export routes differ
  electron/             macOS main process, preload, build and dev scripts
  android/              the Capacitor Android project (committed)
  ios/                  the Capacitor iOS project (committed, not a current target)
  branding/             mark.svg and the two icon-generation scripts
  scripts/build.mjs     picks BUILD_TARGET for a Vite build
```
