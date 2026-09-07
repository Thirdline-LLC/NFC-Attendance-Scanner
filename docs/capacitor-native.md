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

**These are already installed** — `@capacitor/core`, `@capacitor/filesystem`
and `@capacitor/share` as dependencies, `@capacitor/cli`, `@capacitor/ios` and
`@capacitor/android` as dev dependencies. Nothing below needs adding; the
commands are recorded so a fresh checkout can be rebuilt.

```bash
pnpm --filter @workspace/nfc-attendance-scanner add @capacitor/core @capacitor/filesystem @capacitor/share
pnpm --filter @workspace/nfc-attendance-scanner add -D @capacitor/cli @capacitor/ios @capacitor/android
```

The workspace enforces a one-day minimum release age, so an add can fail if a
version was published today. Wait rather than disabling that setting.

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

### The native export path

**Built.** `src/lib/workbook-delivery.ts` owns it, and both screens reach it
through `exportAttendanceWorkbook`, so neither knows which platform it is on.

`buildAttendanceWorkbook(taps, persons)` still returns `{ filename, workbook }`
and delivers nothing; `deliverWorkbook` picks the route:

- **Browser** — `XLSX.writeFile`, the download described above. It reports
  nothing back, so this branch promises nothing beyond "handed over".
- **Device** (`Capacitor.isNativePlatform()`) — `XLSX.write(..., { type:
  'base64' })`, then `Filesystem.writeFile` into `Directory.Documents`, then
  the share sheet with the resulting `uri`. base64 rather than a Blob because
  that is what crosses the WebView bridge, which is also the workaround Android
  would otherwise need for `blob:` downloads.

Three behaviours worth knowing, each pinned by a test in
`workbook-delivery.test.ts`:

- A **failed write throws**. Unlike a download, this failure is knowable, so it
  is surfaced rather than swallowed into a success the operator would trust.
- A **cancelled share is not a failure**. The file is already on disk by then;
  reporting an error would be false, and would push the operator into
  exporting again.
- **No share sheet, no problem** — `Share.canShare()` is checked first, and the
  file still counts as delivered.

The result carries `delivery: 'download' | 'file'`, and `ExportNotice` says
different things for each: a native export states the file exists and where,
because it can; a download tells the operator to go and check, because it
cannot. That is the "say on screen whether it worked" requirement, and it is
done on both platforms.

#### Still to do on a real device

The code is written and unit-tested. It has never run on iOS or Android,
because neither can run here. Two things need doing before it is trusted:

- **`Info.plist`.** On iOS, `Directory.Documents` is only visible in the Files
  app if `UIFileSharingEnabled` and `LSSupportsOpeningDocumentsInPlace` are
  `YES`. Without them the file exists and nobody can reach it. Set both when
  `cap add ios` has generated the project — the share sheet covers getting the
  file out, but not finding it later.
- **Android scoping.** On modern Android `Directory.Documents` is app-scoped
  storage, not the shared Documents folder. The share step is what gets the
  workbook somewhere durable; do not tell an operator to "look in Documents".

### A second copy, on the device

Also designed and deliberately not implemented:

- With `@capacitor/filesystem`, write a JSON snapshot of `persons` and `taps`
  to `Directory.Documents` on every export. That directory is outside the
  WebView's storage, is included in device backups, and is untouched by
  "Clear storage".
- A matching import path — read the JSON back, then `bulkPut` into Dexie —
  turns a device swap into a two-minute job and covers the eviction case
  entirely.

Still unbuilt — but the reason has changed. `@capacitor/filesystem` is now a
dependency for the export, so the snapshot no longer costs one; what is left is
the import path and its failure modes. Build it if the seven-day test below
fails, or before any device is trusted with a term of attendance.

### Moving to a new device

1. Export the workbook and copy it off the old device.
2. Install the app on the new device.
3. Re-enroll cards, or import the JSON snapshot if that path gets built.

There is no cloud sync and there will not be one — no student data leaves the
device by design.

## Three things to check on a real device

**The export has to produce a file.** This is the one that can lose data, so do
it first, with a throwaway session on a real build. A native build no longer
depends on the browser download at all — it writes the file itself and opens
the share sheet — so what this checks is that the written path works end to
end:

1. Check a card in, press **End Session**, press **Export**.
2. A share sheet should appear. The on-screen notice should read *"Saved
   attendance-….xlsx to this device's Documents"* — the wording that only the
   native path produces. If it instead says *"Handed … to the browser"*, the
   build is not running as a native platform and `Capacitor.isNativePlatform()`
   is returning false; fix that before anything else.
3. Send the file somewhere off the device from the sheet, and open it. A
   zero-byte or corrupt workbook means the base64 round-trip is wrong.
4. Dismiss the sheet on a second export without sending. The notice must still
   report success — the file is already written — and the file must be in
   Documents.
5. Find it without the sheet: iOS, the Files app, which needs the `Info.plist`
   keys named above; Android, via the share target, since Documents is
   app-scoped.
6. Attach a debugger to the WebView (Safari → Develop → the device, or
   `chrome://inspect`) and watch for a rejected `Filesystem.writeFile`. That
   one throws, so it should be visible rather than silent.

Until this has been run on a build someone will actually use, treat the
"the .xlsx is the system of record" line as proven for the web app only.

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

Verify with `grep -ohE 'https?://[^"'"'"');]+' dist/public/assets/*.js dist/public/assets/*.css`
— note `https?`, not `https`: an earlier version of this paragraph grepped only
for `https://` and so enumerated the survivors wrongly. What matches is inert,
in four groups:

- **XML namespaces**, the overwhelming majority — SheetJS's OOXML and
  OpenDocument identifiers (`schemas.openxmlformats.org`,
  `schemas.microsoft.com`, `purl.oclc.org`, `purl.org/dc`,
  `docs.oasis-open.org`, `openoffice.org`) and the browser's own
  (`w3.org/2000/svg`, `w3.org/1999/xhtml`). Namespaces are names, not
  addresses; nothing resolves them.
- **Links printed into error messages**: React's `reactjs.org/docs/error-decoder`,
  `reactrouter.com/...`, Dexie's `bit.ly/2kdckMn` (in its "Transaction committed
  too early" text) and SheetJS's `tinyurl.com/y2uuvskb`. They are shown to a
  developer after something has already gone wrong.
- **`http://localhost`**, react-router's placeholder origin for parsing a URL.
- **`http://macVmlSchemaUri`**, a SheetJS placeholder that is not a real host.

None is fetched. Re-run the grep after adding any dependency: what matters is
not that a URL appears, but that it appears in a `fetch`, `<link>`, `@import`
or `src` — that is a real request, and it does not belong in this bundle.
