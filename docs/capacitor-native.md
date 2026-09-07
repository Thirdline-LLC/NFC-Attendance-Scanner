# Packaging the attendance scanner as a native app

The scanner is a Vite/React web app with no backend: the roster and every
attendance tap live in the browser's IndexedDB, and the exported `.xlsx` is the
system of record. Capacitor wraps that same bundle in a native shell so it can
be installed from TestFlight or an `.apk` and run with no network at all.

This guide covers the install commands, the build that feeds Capacitor, and —
the part that actually matters for a device holding the only copy of a roster —
how that IndexedDB data survives on iOS and Android.

Read [The safety net, and the hole in it](#the-safety-net-and-the-hole-in-it)
before trusting the sentence above on a device. The export is the system of
record by design; whether the file it produces actually leaves a WebView is the
one thing here nobody has yet checked.

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
What the relative base actually buys is that the assets stay resolvable
whatever origin the shell serves them from. It does **not** make the bundle
portable in the two ways one might assume, both checked against the built
output: opened as `file:///…/index.html` the app never mounts at all (the entry
is an ES module, which `file:` cannot load), and served from a subdirectory it
mounts and then leaves that subdirectory, because `routerBasename()` reports no
basename for a relative base and the catch-all route redirects to `/`. A real
subdirectory deploy would need an actual basename, or a `HashRouter`.

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
  `navigator.storage.persist()` — which `main.tsx` calls once at boot through
  `src/lib/storage-persistence.ts` — asks for an exemption. Treat a `true` as a
  bonus; the answer is advisory either way.
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
- Chromium decides `navigator.storage.persist()` by engagement heuristics
  rather than a prompt, and a WebView has no browsing history to earn that
  with; `storage-persistence.ts` also guards for the API being absent
  entirely, which older WebViews are. Don't assume a grant. `main.tsx` logs the
  answer, but only in a dev build — to read it on a device, run a debug build
  and attach `chrome://inspect`.

## The safety net, and the hole in it

**The Excel export is the system of record.** That is a design decision, not a
workaround, and it is what makes every uncertainty above tolerable — *provided
the file actually leaves the device*. In a browser it does. Inside a Capacitor
WebView nobody has checked yet, and the way the export is written means a
failure there would be silent.

### What the export actually does

`exportAttendanceWorkbook` (`src/lib/attendance-export.ts`) builds the workbook
and hands it to `XLSX.writeFile`. What that call does depends on where it runs;
SheetJS picks the branch at runtime inside `write_dl` (xlsx@0.18.5):

- **Node** — `fs.writeFileSync`, the CommonJS entry point having auto-required
  `fs`. Observed here the hard way: a test that called the export for real left
  an `attendance-*.xlsx` in the package root, which is why
  `attendance-export.test.ts` stubs `writeFile`. It also means no test
  exercises the branch that runs on a device.
- **A browser** — no `fs`, so it builds a `Blob`, `URL.createObjectURL`s it,
  creates `<a download="attendance-….xlsx" href="blob:…">`, appends it to
  `<body>`, `.click()`s it and removes it again.

The browser branch is verified rather than assumed: read out of the shipped
`xlsx.mjs` (`write_dl`), then instrumented in Chromium against the dev server —
each press of **Export** produced exactly one `application/octet-stream` Blob
(8,744 bytes) and one clicked anchor carrying the `download` attribute, and
left the screen unchanged.

That click is the whole mechanism, and it reports nothing back.
`XLSX.writeFile` has no callback and no promise, and throws nothing when the
click leads nowhere; neither call site (`ScannerScreen.handleExport`,
`DashboardPage.exportAll`) renders any confirmation. From the front desk, a
host that ignores the click looks exactly like a file that saved.

### What a WebView probably does with it — untested

This could not be tested here: there is no `ios/` or `android/` project, no
`@capacitor/*` package is installed, and neither platform runs in this
container. What follows is reasoning from how the two WebViews handle
downloads. It is the reason for the device check below, not a report of an
observed failure.

- **iOS (WKWebView).** A WKWebView has no download UI of its own. A navigation
  it decides is a download is handed to the host app's `WKDownloadDelegate`
  (iOS 14.5+), which the app has to implement; a `blob:` URL is a further
  question on top of that. Whether the Capacitor iOS bridge installs such a
  delegate could not be confirmed here — check it against the
  `@capacitor/ios` version you actually ship.
- **Android (System WebView).** Downloads reach the app only through
  `WebView.setDownloadListener`, which is driven from the network stack;
  `blob:` URLs are widely reported not to reach it at all. The usual
  workaround is a JS bridge that reads the blob and passes base64 to native —
  which is what the path below does directly, without the blob.

The expected symptom on both is the same and is the dangerous one: the button
depresses, nothing appears, nothing errors.

### The native export path (designed, not built)

`buildAttendanceWorkbook(taps, persons)` returns `{ filename, workbook }` and
delivers nothing anywhere. That split exists precisely so this can be dropped
in without touching how the sheet is built.

Two packages are needed and are **not** installed — add them only once the
device check has actually shown the download failing:

```bash
pnpm --filter @workspace/nfc-attendance-scanner add @capacitor/filesystem @capacitor/share
```

```ts
// src/lib/attendance-export-native.ts
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import * as XLSX from 'xlsx';
import type { AttendanceWorkbook } from '@/lib/attendance-export';

export async function saveAttendanceWorkbookNative(
  built: AttendanceWorkbook,
): Promise<string> {
  // base64 is the form Filesystem.writeFile wants for binary: with no
  // `encoding` it decodes the string and writes the bytes as they are.
  const data = XLSX.write(built.workbook, {
    bookType: 'xlsx',
    type: 'base64',
    compression: true,
  });
  const { uri } = await Filesystem.writeFile({
    path: built.filename,
    data,
    directory: Directory.Documents,
    recursive: true,
  });
  // Writing it is not getting it off the device. The share sheet is what puts
  // the workbook into Mail/Drive/AirDrop — and it is the only proof the
  // operator gets that a file exists at all.
  await Share.share({
    title: 'Attendance export',
    url: uri,
    dialogTitle: 'Send the attendance workbook',
  });
  return uri;
}
```

It slots into `exportAttendanceWorkbook` in `src/lib/attendance-export.ts`,
which is the only place either screen goes through:

```ts
import { Capacitor } from '@capacitor/core';
import { saveAttendanceWorkbookNative } from '@/lib/attendance-export-native';

export async function exportAttendanceWorkbook(taps, persons): Promise<void> {
  const built = buildAttendanceWorkbook(taps, persons);

  if (Capacitor.isNativePlatform()) {
    await saveAttendanceWorkbookNative(built);
    return;
  }

  XLSX.writeFile(built.workbook, built.filename, {
    bookType: 'xlsx',
    compression: true,
  });
}
```

Both call sites are synchronous today and would become
`void exportAttendanceWorkbook(...).then(…).catch(…)`. Three things to get
right:

- On iOS, `Directory.Documents` is only visible in the Files app if
  `UIFileSharingEnabled` and `LSSupportsOpeningDocumentsInPlace` are `YES` in
  `Info.plist`. Without them the file exists and nobody can reach it, so the
  `Share` step is not optional.
- On modern Android, `Directory.Documents` is app-scoped storage, not the
  shared Documents folder. Same conclusion: share it out.
- Once `@capacitor/filesystem` is in for this, the JSON snapshot below costs
  almost nothing extra. Do both in one change.

### Say on screen whether it worked

Nothing currently does, on any platform. Whatever happens with the native path,
the export should report — "Saved attendance-….xlsx", or a visible failure —
because a silent no-op mistaken for a saved file is the exact way a term of
attendance goes missing. This is not built yet; do it in the same change as the
native path, and make the failure branch `catch` a rejected
`saveAttendanceWorkbookNative`.

### A second copy, on the device

Also designed and deliberately not implemented:

- With `@capacitor/filesystem`, write a JSON snapshot of `persons` and `taps`
  to `Directory.Documents` on every export. That directory is outside the
  WebView's storage, is included in device backups, and is untouched by
  "Clear storage".
- A matching import path — read the JSON back, then `bulkPut` into Dexie —
  turns a device swap into a two-minute job and covers the eviction case
  entirely.

Left unbuilt because it adds a runtime dependency and a file-permission
surface. It was previously written down here as unnecessary "because the export
already covers the common case"; on a native build that is exactly the
assumption the section above says nobody has checked. If the export check or
the seven-day test fails, build both before rolling out.

### Moving to a new device

1. Export the workbook and copy it off the old device.
2. Install the app on the new device.
3. Re-enroll cards, or import the JSON snapshot if that path gets built.

There is no cloud sync and there will not be one — no student data leaves the
device by design.

## Three things to check on a real device

**The export has to produce a file.** This is the one that can lose data, so do
it first, with a throwaway session on a real build:

1. Check a card in, press **End Session**, press **Export**.
2. Watch the screen. Today's build has no share sheet and no save dialog to
   offer — the entire mechanism is that anchor click — so *anything* that
   happens (a save prompt, a preview, a Downloads notification) means the
   WebView handled it.
3. Then go looking for the file: Android, Files → Downloads; iOS, the Files
   app, where the app has a folder at all only with the `Info.plist` keys named
   above, so expect nothing there.
4. Attach a debugger to the WebView (Safari → Develop → the device, or
   `chrome://inspect`) and export again with the console open. A silent
   nothing, no error, is exactly the failure this is looking for.
5. If nothing lands, build
   [the native export path](#the-native-export-path-designed-not-built) before
   the app goes near a real meeting. Do not ship a kiosk whose export only
   works in the preview.

Until this has been run on a build someone will actually use, treat the
"the .xlsx is the system of record" line as true of the web app only.

**The reader is a keyboard.** The NFC reader is a USB HID keyboard wedge: it
types fourteen hex characters and presses Enter into whatever has focus. In the
WebView that must be the hidden scanner input, which `ScannerScreen` keeps
focused. Worth verifying on device: that an external USB or Bluetooth reader
enumerates as a keyboard at all (iOS needs the Camera Connection Kit or a
Bluetooth HID reader), and that connecting it suppresses the on-screen keyboard
rather than having it cover the count. If the soft keyboard does appear, add
`@capacitor/keyboard` and hide it on the scanner screen — not needed until the
symptom shows up.

**The app fetches no fonts, and that took removing two separate requests.**
The bundle used to make two calls to `fonts.googleapis.com`, and only one of
them was doing anything:

- `src/index.css:1` was `@import url('…css2?family=DM+Sans…&Space+Grotesk…
  &Space+Mono…')`. A remote `@import` survives the build — it was literally the
  first line of `dist/public/assets/index-*.css` — and this was the request
  that actually supplied the app's fonts (`--app-font-sans: 'DM Sans'`,
  `--app-font-mono: 'Space Mono'`). It now reads `@import './fonts/fonts.css'`,
  and the two families ship in the bundle as eight woff2 files (~148 KB total,
  emitted to `assets/` and referenced relatively, so the native build resolves
  them too). Space Grotesk was in the old import, was downloaded on every boot
  and was never drawn with — the `font-display` class on headings maps to no
  `--font-display` token and emits no CSS — so it is deliberately not
  self-hosted.
- `index.html` carried a `<link>` for **Inter** plus two `preconnect`s. Nothing
  referenced Inter in any font stack and it appeared nowhere in the built CSS,
  so all three lines were deleted rather than self-hosted.

To regenerate the faces: re-fetch the css2 stylesheet for DM Sans and Space
Mono, then rewrite each `url()` to the copy beside `src/fonts/fonts.css`.

This matters beyond looks. Offline, both requests used to fail silently and the
kiosk fell back to system fonts, so it never looked like what was signed off in
review. Worse, on a kiosk *with* a network the app announced itself to a third
party on every boot while the dashboard told the operator that nothing is sent
anywhere. Those were the only two requests the bundle made, so with them gone,
"this app touches the network never" is now literally true.

Verified by grepping the built CSS and JS for `https://`. What still matches is
inert: XML namespaces baked into SheetJS, and documentation links inside React
and react-router error strings (`reactjs.org/docs/error-decoder`,
`reactrouter.com/...`). Those are string literals printed into a message when
something has already gone wrong — nothing fetches them. Re-run that grep after
adding any dependency; a URL that appears in a `fetch`, `<link>`, `@import` or
`src` is a real request and does not belong in this bundle.
