# Tapin

Tapin is a kiosk for taking attendance with a USB HID NFC reader. A student
taps a card, the reader types fourteen uppercase hex characters and Enter into
a hidden always-focused input, and the tap is recorded on the device.

**There is no backend.** No server, no API, no account, no cloud, no
analytics, and no network requests at runtime at all. The roster and every
attendance tap live in the browser's IndexedDB as a **device cache**. The
school's own workbook (OneDrive or an equivalent shared drive) is the system
of record — see [docs/data-and-backup.md](docs/data-and-backup.md). The app is
built to a FERPA-style bar for the records it touches; see
[docs/data-protection.md](docs/data-protection.md) for exactly what that means
and what it does not claim.

One React application ships to three places:

| Target | What it is | Where it runs |
|---|---|---|
| **Web / PWA** | Installable progressive web app on any static host | Chrome, Edge, Safari |
| **Android** | Capacitor APK, installable without Google Play | Tablet at the front desk |
| **macOS** | Electron `.app` in a `.dmg`, no Mac App Store | Teacher's MacBook |

The Android and macOS apps load their assets from inside the package. Once
installed, neither needs a website, a server or an internet connection. The
only network call either one ever makes is a teacher-initiated check of public
GitHub Releases for app and theme updates.

## Get it

Pilot devices install from [GitHub Releases](https://github.com/Thirdline-LLC/NFC-Attendance-Scanner/releases) —
no build tools required. [docs/pilot-install.md](docs/pilot-install.md) walks
through the Mac install end to end: downloading the DMG, clearing Gatekeeper's
quarantine flag, setting a teacher PIN, installing a school theme pack, and
setting up a class with periods.

## Develop it

```bash
corepack enable && corepack prepare pnpm@latest --activate   # if you have no pnpm
pnpm install                                                 # from this directory
pnpm --filter @workspace/nfc-attendance-scanner run dev      # http://localhost:5173
```

Any machine with Node 22+ and pnpm works — there is no dependency on any
particular cloud IDE or container.

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
| [docs/pilot-install.md](docs/pilot-install.md) | **Installing a pilot device from a Release.** DMG, Gatekeeper, PIN, theme pack, first class |
| [docs/vscode-setup.md](docs/vscode-setup.md) | **Read this first for local development.** Tools, versions, every command, VS Code tasks, troubleshooting |
| [docs/pwa-hosting.md](docs/pwa-hosting.md) | Building the PWA, hosting it, installing it, offline behaviour, updates |
| [docs/android-packaging.md](docs/android-packaging.md) | Android Studio, APK, signing, sideloading, kiosk mode, the HID reader |
| [docs/desktop-macos.md](docs/desktop-macos.md) | Building the Mac app and sending it to another MacBook. Electron development, `.app` and `.dmg`, Gatekeeper |
| [docs/deferred-apple-developer.md](docs/deferred-apple-developer.md) | What was deliberately skipped: Developer ID, notarization, MDM, and what each would buy |
| [docs/data-and-backup.md](docs/data-and-backup.md) | Where data lives on each platform, what erases it, backup and device replacement |
| [docs/capacitor-native.md](docs/capacitor-native.md) | Original Capacitor notes: IndexedDB survival on iOS/Android |
| [docs/operating-the-kiosk.md](docs/operating-the-kiosk.md) | Front-desk instructions, written for a volunteer |
| [docs/data-protection.md](docs/data-protection.md) | What student data this holds and the rules around it |
| [SECURITY.md](SECURITY.md) | How to report a vulnerability |

## Application identity

`org.stjohnschs.attendance` — the Android `applicationId`, the iOS bundle id,
the macOS bundle id, and the key macOS uses for the app's stored data. The
Electron renderer's origin is `app://attendance` and its data directory is
named `SJC Attendance`.

**None of these may change between releases.** Each one is what an operating
system uses to recognise an update as the *same app*; changing any of them
makes an existing install's roster and attendance history invisible. See
[docs/data-and-backup.md](docs/data-and-backup.md).

Tapin itself is a neutral, unbranded core. A school's name, colors, fonts and
copy come from a `.nfc-theme` pack loaded at runtime — the pilot ships
St. John's own pack, `tapin-sjc`. That pack is *branding only*: it never
carries a student record. Because the identity strings above were locked in
before the theme system existed, the installed app, its Finder icon and its
Application Support folder are still literally named **SJC Attendance** even
though the on-screen product name is Tapin — that is expected, not a bug, and
changing it would break every existing install's data continuity. See
[docs/design/04-theme-system.md](docs/design/04-theme-system.md).

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
lib/themes/             the `.nfc-theme` schema, loader, and packer (`orgs/tapin-sjc`)
```

## License

MIT — see [LICENSE](LICENSE). Copyright Thirdline LLC.
