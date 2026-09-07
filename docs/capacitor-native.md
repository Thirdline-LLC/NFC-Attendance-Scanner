# Packaging the attendance scanner as a native app

The scanner is a Vite/React web app with no backend: the roster and every
attendance tap live in the browser's IndexedDB, and the exported `.xlsx` is the
system of record. Capacitor wraps that same bundle in a native shell so it can
be installed from TestFlight or an `.apk` and run with no network at all.

This guide covers the install commands, the build that feeds Capacitor, and —
the part that actually matters for a device holding the only copy of a roster —
how that IndexedDB data survives on iOS and Android.

## Install (run these once, from the repo root)

Nothing here is installed yet. The workspace enforces a one-day minimum release
age on new packages, so these can fail if a version was published today; wait
rather than disabling that setting.

```bash
pnpm --filter @workspace/nfc-attendance-scanner add -D @capacitor/cli
pnpm --filter @workspace/nfc-attendance-scanner add @capacitor/core @capacitor/ios @capacitor/android
```

Then, from `artifacts/nfc-attendance-scanner/`:

```bash
pnpm run build:native          # writes dist/public with relative asset paths
pnpm exec cap add ios          # creates ios/ (needs macOS + Xcode)
pnpm exec cap add android      # creates android/ (needs Android Studio)
pnpm exec cap sync             # copies dist/public into both native projects
pnpm exec cap open ios         # or: cap open android
```

`cap add` and `cap open` need a Mac with Xcode (iOS) or Android Studio
(Android); neither runs in this container. Everything up to and including
`build:native` does.

After the CLI is installed, drop the local type alias at the top of
`capacitor.config.ts` and use the real one, so a misspelt key fails at sync
time instead of silently doing nothing:

```ts
import type { CapacitorConfig } from '@capacitor/cli';
```

Convenience scripts already in `package.json`: `native:sync`, `native:ios`,
`native:android` — each rebuilds first, so the native shell never ships a stale
bundle. **Rebuild and re-sync after every web change**; `cap` copies files, it
does not watch them.

## Why there are two builds

`vite.config.ts` refuses to run without `PORT` and `BASE_PATH`, and `BASE_PATH`
becomes the base every asset URL is written against.

| Script | `BASE_PATH` | `index.html` refers to | For |
|---|---|---|---|
| `build` | `/` | `/assets/index-*.js` | the Replit preview, served at a domain root |
| `build:native` | `./` | `./assets/index-*.js` | the Capacitor shell |

Both were run and their output inspected: the favicon, script and stylesheet
come out absolute in the first and relative in the second.

Capacitor serves `webDir` from its own origin — `capacitor://localhost` on iOS,
`https://localhost` on Android — so absolute paths would in fact also resolve.
The relative build is the safer default: it survives being opened from a `file:`
URL or a subdirectory, which is what breaks silently and only on device.

A relative base makes Vite report `BASE_URL` as `./`. Stripping the trailing
slash from that would hand react-router a basename of `.`, which matches no
location and renders a blank screen — `routerBasename()` in `AppRouter.tsx`
guards it by treating any non-absolute base as no prefix at all.

`capacitor.config.ts` deliberately sets no `server` block. `server.url` is a
live-reload hook that points the shell at a dev machine; a shipped build must
not have one. Note also that `iosScheme`, `androidScheme` and `hostname` define
the origin, and **IndexedDB is scoped to the origin** — changing any of them in
a later release orphans every roster and tap already stored under the old one.
Treat them as frozen once a build is in someone's hands.

## Where the data lives, and what erases it

Both platforms keep WebView storage inside the app's own sandbox, so it is
private to the app and disappears with it.

### iOS (WKWebView)

- Storage sits in the app's data container, under `Library/WebKit/`. It is not
  in `Documents/`, so it is invisible to the Files app and to iTunes file
  sharing.
- **Delete App** erases the container, and with it the roster and all history.
- **Offload App** (Settings → General → iPhone Storage) removes the binary and
  keeps "documents and data". Apple's wording is about the data container as a
  whole; whether every WebKit storage directory is preserved in practice is
  not something worth betting a term's attendance on. Export first.
- Under storage pressure, WebKit may evict an origin's script-writable storage.
  `navigator.storage.persist()` — which `src/lib/storage-persistence.ts` calls
  once at boot — asks for an exemption. Treat a `true` as a bonus.
- **The seven-day cap, honestly.** Safari's Intelligent Tracking Prevention
  deletes script-writable storage (IndexedDB, localStorage) after seven days
  without user interaction. Whether that timer applies inside a WKWebView owned
  by a native app is the single most consequential unknown here, and I could not
  verify it against Apple's documentation in this container. Reports over the
  years point both ways, and the answer has changed between iOS releases. Do not
  assume the app is exempt. **Test it:** enroll a student on a build, leave the
  device untouched for eight days, reopen, and check the roster is intact.
  Until that test has been run on the iOS version you ship, treat on-device
  storage as a working cache, not an archive.

### Android (System WebView)

- Storage lives in `/data/data/org.stjohnschs.attendance/app_webview/`, again
  inside the app sandbox.
- Settings → Apps → Storage offers two buttons that read alike and are not:
  **Clear cache** leaves IndexedDB alone; **Clear storage** (or "Clear data")
  wipes it completely. Anyone supporting these devices needs to know the
  difference before they tap one.
- Uninstalling erases everything. Android's auto-backup *may* include WebView
  data, which is neither dependable enough to rely on nor to count as deleted.
- Chromium honours `navigator.storage.persist()` by engagement heuristics; an
  installed app that is used regularly is usually granted it.

## The safety net

**The Excel export is the system of record.** That is a design decision, not a
workaround, and it is what makes every uncertainty above tolerable. Export at
the end of each session, to somewhere that is not this device.

A second layer worth building, designed but deliberately not implemented:

- Add `@capacitor/filesystem` and, on every export, also write a JSON snapshot
  of `persons` and `taps` to `Directory.Documents`. That directory is outside
  the WebView's storage, is visible in the iOS Files app, is included in device
  backups, and is untouched by "Clear storage".
- A matching import path — read the JSON back, then `bulkPut` into Dexie —
  turns a device swap into a two-minute job and covers the eviction case
  entirely.

This is left unbuilt because it adds a runtime dependency and a file-permission
surface, and the export already covers the common case. If the seven-day test
above fails, build it before rolling out.

### Moving to a new device

1. Export the workbook and copy it off the old device.
2. Install the app on the new device.
3. Re-enroll cards, or import the JSON snapshot if that path gets built.

There is no cloud sync and there will not be one — no student data leaves the
device by design.

## Two things to check on a real device

**The reader is a keyboard.** The NFC reader is a USB HID keyboard wedge: it
types fourteen hex characters and presses Enter into whatever has focus. In the
WebView that must be the hidden scanner input, which `ScannerScreen` keeps
focused. Worth verifying on device: that an external USB or Bluetooth reader
enumerates as a keyboard at all (iOS needs the Camera Connection Kit or a
Bluetooth HID reader), and that connecting it suppresses the on-screen keyboard
rather than having it cover the count. If the soft keyboard does appear, add
`@capacitor/keyboard` and hide it on the scanner screen — not needed until the
symptom shows up.

**The app fetches a font.** `index.html` loads Inter from
`fonts.googleapis.com`. Offline that request simply fails and the CSS falls back
to the system font stack — nothing breaks, but the app looks different on a
kiosk with no network than it does in review. Self-hosting the woff2 files in
`public/` would remove the last network dependency in the bundle. Left as a
follow-up because it changes nothing functional.
