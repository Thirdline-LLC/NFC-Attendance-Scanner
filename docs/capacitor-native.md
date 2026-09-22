# Packaging the attendance scanner as a native app

> **Scope note.** This document predates the migration to VS Code and still
> covers what it always covered well: how IndexedDB survives on iOS and
> Android, and why the native projects are committed. For the current build
> commands, the Android SDK setup, signing, sideloading and kiosk mode, see
> **[android-packaging.md](android-packaging.md)**; for macOS see
> **[desktop-macos.md](desktop-macos.md)**; for data survival across all three
> targets see **[data-and-backup.md](data-and-backup.md)**.
>
> **Wave 1 Mac distribute (D1-a).** Capacitor remains the **Android / iOS**
> shell. Wave 1 ships the Mac DMG from the existing **Electron** packaging
> (`package:mac:signed` → GitHub Releases), locked in
> [`docs/decisions/2026-09-22-wave1-mac-shell-d1.md`](decisions/2026-09-22-wave1-mac-shell-d1.md).
> A Capacitor desktop platform (`@capawesome/capacitor-electron` or similar) is
> **not** Wave 1 work — evaluate later if a single desktop story is worth the
> origin / export / security re-derivation. Do not read this guide as the Mac
> release path.

The scanner is a Vite/React web app with no backend: the roster and every
attendance tap live in the browser's IndexedDB as a device cache. The school
workbook is the system of record — see
[data-and-backup.md](data-and-backup.md). Capacitor wraps that same bundle in a
native shell so it can be installed from TestFlight or an `.apk` and run with
no network at all.

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

**`ios/` and `android/` already exist and are committed.** You do not need to
run `cap add`; see [Are the native projects in git?](#are-the-native-projects-in-git)
for why they are checked in. From `artifacts/nfc-attendance-scanner/`, the
whole routine is:

```bash
pnpm run build:native          # writes dist/public with relative asset paths
pnpm exec cap sync             # copies dist/public into both native projects
pnpm exec cap open ios         # or: cap open android   (needs a Mac / Android Studio)
```

`cap open` needs a Mac with Xcode (iOS) or Android Studio (Android), and so
does building or running. Everything else — `build:native`, `cap add`,
`cap sync` — runs in this container; both `cap add`s and several `cap sync`s
were run here to produce what is committed.

Convenience scripts already in `package.json`: `native:sync`, `native:ios`,
`native:android` — each rebuilds first, so the native shell never ships a stale
bundle. **Rebuild and re-sync after every web change**; `cap` copies files, it
does not watch them.

### If the platform folders ever have to be rebuilt from nothing

```bash
pnpm run build:native
pnpm exec cap add ios
pnpm exec cap add android
pnpm exec cap sync
bash branding/generate-icons.sh     # icons and splash screens
```

`cap add` reads `appName` from `capacitor.config.ts`, so the display name comes
out right on its own. **Two things do not** and must be re-applied by hand,
because Capacitor's template has no hook for them:

- the `UIFileSharingEnabled` and `LSSupportsOpeningDocumentsInPlace` keys in
  `ios/App/App/Info.plist` (see [Still to do on a real device](#still-to-do-on-a-real-device));
- the two uncommented keystore lines in `android/.gitignore`.

That is exactly why the folders are committed rather than regenerated.

### What `cap sync` copies, and the check that it did

`cap sync` copies `dist/public` into `ios/App/App/public` and
`android/app/src/main/assets/public`. Verified here after a rebuild — both
directories match `dist/public` file for file, differing only by Capacitor's
own `cordova.js` and `cordova_plugins.js` shims:

```bash
diff -rq dist/public ios/App/App/public
diff -rq dist/public android/app/src/main/assets/public
```

**`OFL-DM-Sans.txt` and `OFL-Space-Mono.txt` land in both.** That is the point
of keeping them in `public/` rather than beside the fonts: the SIL Open Font
Licence requires the licence to ship with the fonts, and the fonts ship inside
the app bundle. Confirmed present in both platform folders, 4,482 and 4,392
bytes, byte-identical to `public/`. `index.html` in both comes out with
relative paths (`./assets/index-*.js`), which is what `build:native` is for.

Both platform asset folders are in Capacitor's own `.gitignore`, so the bundle
is never committed twice — it is regenerated by `cap sync` from `public/` and
`src/`, which are.

## What a Mac session actually has to do

Everything that can be done without a Mac has been. What is left is the part
that genuinely needs Xcode, a signing identity and a device.

```bash
git pull
pnpm install
cd artifacts/nfc-attendance-scanner
pnpm run build:native && pnpm exec cap sync
pnpm exec cap open ios          # or: pnpm exec cap open android
```

Then, in Xcode:

1. Select the **App** target → **Signing & Capabilities** → set your Team. The
   bundle id `org.stjohnschs.attendance` is already set and **must not change**
   — the WebView origin is derived from the Capacitor config, not the bundle
   id, but the bundle id is the app's identity to iOS and to TestFlight.
2. Set a version and build number (`MARKETING_VERSION`,
   `CURRENT_PROJECT_VERSION`); Capacitor's template leaves them at 1.0/1.
3. Run on a real iPhone or iPad, not the simulator — the whole point is an NFC
   reader plugged into a real device.
4. Work through
   [Three things to check on a real device](#three-things-to-check-on-a-real-device).
   The export check is the one that can lose a term of attendance; do it first.
5. Before the first TestFlight or App Store upload, **generate the privacy
   report** — Product → Archive → Generate Privacy Report — and compare it
   against `ios/App/App/PrivacyInfo.xcprivacy` (see below). This is the step
   that gets discovered at upload time if it is skipped.

### The privacy manifest

`ios/App/App/PrivacyInfo.xcprivacy` exists and is wired into the App target's
Resources build phase, so it ships in the bundle. It declares:

- **No tracking**, no tracking domains.
- **No collected data types.** Apple's "collection" means data sent off the
  device; this app sends none. It holds student names, school addresses, grade
  years and card UIDs, all of which stay in local storage — see
  `docs/data-protection.md`. The Excel export leaves only when a person shares
  it, which is the operator acting rather than the app collecting.
- **One accessed API**: `NSPrivacyAccessedAPICategoryFileTimestamp`, reason
  `C617.1`, required by `@capacitor/filesystem`, which is what writes the
  workbook.

What has *not* been verified, because it needs Xcode: that Apple accepts this
as complete. The generated privacy report aggregates this manifest with every
SDK's own, and if a dependency needs a category not listed here, that report is
where it shows up. Add what it names — do not guess, and do not declare
categories the app does not use, since each one is a claim Apple can check.

Android is the same shape: `pnpm exec cap open android`, let Gradle sync, then
Run. A debug build is enough for every check below; signing only matters for
distribution, and the keystore must stay out of this repo (`android/.gitignore`
has `*.jks` and `*.keystore` uncommented for exactly that reason).

**Nothing in this list has been run.** Every step above is written from the
project as it stands on disk here, not from a session that did it. What *has*
been verified in this container, and can be re-checked here at any time: both
platform folders hold the current bundle byte-for-byte, `Info.plist` carries
both Files-app keys, `PrivacyInfo.xcprivacy` parses as a plist and is
referenced from the Resources build phase, the Android manifest parses with
`allowBackup="false"` and the legacy storage permissions, and `cap sync`
completes without touching any of it.

## App identity: the name, the icon and the splash

`cap add` stamps Capacitor's placeholders into both projects — the name from
`capacitor.config.ts`, and a stock icon. Both have been replaced.

**Name.** `appName` in `capacitor.config.ts` is `SJC Attendance`, and that is
what is set in `ios/App/App/Info.plist` (`CFBundleDisplayName`) and
`android/app/src/main/res/values/strings.xml` (`app_name` and
`title_activity_main`). Two things to know:

- The full product name is *SJC Attendance Scanner*, which is too long for a
  home screen. **Unverified, and worth one glance on a real device:** at 14
  characters "SJC Attendance" may still be elided by iOS to something like
  "SJC Attenda…" under the icon, where Android launchers wrap onto two lines
  and show it whole. If it does get cut, the shorter fallback is `Attendance`
  — change it in all three places above, since `cap sync` does not rewrite
  either platform file.
- `CFBundleName` stays `$(PRODUCT_NAME)` (i.e. "App"). That is Capacitor's
  template and is fine: `CFBundleDisplayName` is what the home screen shows.

**Icon and splash.** `branding/mark.svg` is the source — three gold arcs on the
kiosk's own navy, the contactless "tap" symbol, chosen because it is what the
reader actually does and because arcs with no lettering still read at 48px.
The colours are the app's own tokens from `src/index.css`: navy `#0D1E30`
(`--background`) and gold `#F8CA5D` (`--primary`).

`bash branding/generate-icons.sh` renders every size into the two asset
catalogues, overwriting the placeholders in place. It writes no new files and
touches no `Contents.json` or mipmap XML, so both catalogues keep exactly the
shape Xcode and Android Studio expect:

| Where | Files | Notes |
|---|---|---|
| `ios/…/AppIcon.appiconset/` | `AppIcon-512@2x.png` (1024×1024) | Flattened, **no alpha channel** — the App Store rejects one. No rounded corners; iOS masks. |
| `ios/…/Splash.imageset/` | three 2732×2732 PNGs | Capacitor's template points 1×/2×/3× at the same picture; all three are written. |
| `android/…/mipmap-*/ic_launcher_foreground.png` | 108, 162, 216, 324, 432 | Adaptive foreground. The mark is scaled to 88%, which puts its farthest point ~27% of the canvas from centre — inside the 33% safe radius every launcher mask leaves. |
| `android/…/mipmap-*/ic_launcher.png`, `ic_launcher_round.png` | 48, 72, 96, 144, 192 | Legacy icons, drawn unmasked, so they carry their own rounded-square / circle shape on transparency. |
| `android/…/values/ic_launcher_background.xml` | — | The adaptive background is a flat colour, not a bitmap; set to the navy. |
| `android/…/drawable*/splash.png` | 11 files | Per density and orientation, because `styles.xml` uses the bitmap as the launch window background. |

**`@capacitor/assets` was considered and not added.** It is the usual tool for
this, but it exists to rasterise a source image into these same sizes, and
ImageMagick 7 with a librsvg delegate is already in this container — so the
whole job is one shell script with no new dependency, no `sharp` binary and
nothing to keep up to date. If a future session wants richer output (dark and
tinted iOS icon variants, per-density iOS splashes), reconsider; today it would
buy nothing.

Two files are deliberately left as Android Studio's stock template:
`android/app/src/main/res/drawable/ic_launcher_background.xml` and
`drawable-v24/ic_launcher_foreground.xml`. They still hold the green droid, and
they are **unreferenced** — `mipmap-anydpi-v26/ic_launcher.xml` points at
`@color/ic_launcher_background` and `@mipmap/ic_launcher_foreground`, verified
by grep. Rewriting them would risk the catalogue for no visible gain.

If the mark itself needs replacing, edit `branding/mark.svg` and re-run the
script; nothing else refers to it. Note that ImageMagick's librsvg delegate
fails with a bare *"unable to read image data"* if the SVG is not well-formed
XML — a `--` inside a comment is enough to do it.

## Are the native projects in git?

**Yes, both are committed.** 73 files, about 730 KB.

Capacitor's own guidance is to commit them, and the usual counter-argument —
"they are generated, so regenerate them" — does not hold here. Three things in
those folders are *not* reproducible by `cap add`:

- the two `Info.plist` keys that decide whether an exported workbook can ever
  be found in the Files app;
- the icon and splash catalogues (reproducible, but only by remembering to run
  `branding/generate-icons.sh`);
- the uncommented keystore lines in `android/.gitignore`.

Regenerating and forgetting any of them ships an app whose export silently
cannot be found. Committing turns a Mac session into `git pull` → `cap sync` →
open, which is the entire goal.

The size argument does not bite either, because Capacitor's generated
`.gitignore` files already exclude everything bulky and everything derived:
the copied web bundle (`ios/App/App/public`,
`android/app/src/main/assets/public`), `capacitor.config.json`, `config.xml`,
Pods, `DerivedData`, Gradle `build/` and `.gradle/`, and `local.properties`.
What is committed is source: `.swift`, `.java`, `.gradle`, `.xcodeproj`,
storyboards, the resource XML and the icon PNGs, plus the Gradle wrapper
(`gradlew`, `gradlew.bat`, `gradle-wrapper.jar` — committing the wrapper is
standard Android practice, and it is what pins the Gradle version).

Checked before committing: no keystore, no `local.properties`, no
`google-services.json`, no `.env`, no provisioning profile. The keystore and
`google-services.json` ignore lines were uncommented so an accident cannot
happen later.

## Why there are three builds

> Updated after the move off Replit. `vite.config.ts` no longer *requires*
> `PORT` and `BASE_PATH` — it takes a `BUILD_TARGET` and derives the base,
> while still honouring both variables when they are set. There are now three
> targets rather than two. See [vscode-setup.md](vscode-setup.md).

`BASE_PATH` still becomes the base every asset URL is written against.

| Script | Base | `index.html` refers to | For |
|---|---|---|---|
| `build` | `/` | `/assets/index-*.js` | a static host serving at a domain root |
| `build:native` | `./` | `./assets/index-*.js` | the Capacitor shell |
| `build:electron` | `./` | `./assets/index-*.js` | the macOS app, over `app://attendance` |

All three were run and their output inspected: the favicon, script and
stylesheet come out absolute in the first and relative in the other two. The
web build alone also emits `manifest.webmanifest` and `sw.js`; neither appears
in the Capacitor or Electron output, and the built APK was checked for both.

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

**The school workbook is the system of record; the Excel export is how this
device feeds it.** That is a design decision (see
[data-and-backup.md](data-and-backup.md)), not a workaround, and it is what
makes every uncertainty above tolerable — *provided the file actually leaves
the device*. In a browser it does. Inside a Capacitor WebView nobody has
checked yet, and the way the export is written means a failure there would be
silent.

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

This could not be tested here: neither platform *runs* in this container. The
`ios/` and `android/` projects now exist and the `@capacitor/*` packages are
installed, but nothing has compiled or launched them. What follows is reasoning
from how the two WebViews handle downloads. It is the reason for the device check below, not a report of an
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

The native delivery test also reopens the exact base64 string passed to
`Filesystem.writeFile` as an `.xlsx`. It runs the same fixture under both native
labels and checks three rows of **invented** students (fake — not real people):
a current known card (Jordan Lee, grade 12), a formerly-unresolved/migrated
card that now resolves to Priya Nair (grade 11), and an unknown card
(`0011223344AABB` (fake)) with the `Unknown card` name and blank student
fields. A second case rejects the share call and reopens the saved
bytes, proving that dismissing the sheet does not erase the file. Run it with:

```bash
pnpm --filter @workspace/nfc-attendance-scanner test -- src/lib/workbook-delivery.test.ts
```

This is a byte-level native bridge check, not a substitute for an iPhone or
Android run: this container has neither Xcode/Android Studio nor physical
devices, so the system share sheets and Files/Documents apps remain an explicit
manual check below.

#### Still to do on a real device

The code is written and unit-tested. It has never run on iOS or Android,
because neither can run here.

**`Info.plist` is done.** `ios/App/App/Info.plist` carries both keys, and they
are committed, so nobody has to remember:

```xml
<key>LSSupportsOpeningDocumentsInPlace</key>
<true/>
<key>UIFileSharingEnabled</key>
<true/>
```

Without them the export lands in `Directory.Documents` and the Files app never
shows it — the file exists and nobody can reach it. The share sheet covers
getting the file *out*; these two cover finding it later. Set, parsed back with
`plistlib` to prove the file is still valid, and confirmed to survive a rebuild
and a `cap sync` (`cap` does not rewrite `Info.plist`). **Unverified:** that
iOS actually honours them — that needs a device.

What is left:

- **Android storage, stated correctly.** An earlier version of this section had
  it backwards. `Directory.Documents` resolves through
  `Environment.getExternalStoragePublicDirectory(DIRECTORY_DOCUMENTS)` — the
  *shared* Documents folder, not app-private storage. What Android 11+ scopes
  is reading: the app can only see files it created there. So an operator can
  be told to look in Documents; they will find the export, and not much else.
  Two consequences that are configuration, not wording:
  `WRITE_/READ_EXTERNAL_STORAGE` are now declared with `maxSdkVersion="29"`,
  because on API 24–29 the plugin needs them and would otherwise fail on
  Android 7–10; and `android:allowBackup` is now `false`, since the generated
  default would have made the roster eligible for Android Auto Backup.
- **The privacy manifest is written and wired**
  (`ios/App/App/PrivacyInfo.xcprivacy`, in the Resources build phase). What is
  left is confirming Apple agrees it is complete, which only the archive-time
  privacy report can say — see
  [The privacy manifest](#the-privacy-manifest).
- **Everything in [Three things to check on a real device](#three-things-to-check-on-a-real-device)**,
  which is still entirely unrun.

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
end. Use the same three **fake** fixture rows as the automated tests (invented
names and synthetic UIDs — never real students or real cards): Jordan Lee on
`04A1B2C3D4E5F6` (fake), Priya Nair on `04F6E5D4C3B2A1` (fake) from a
pre-enrollment/migrated tap, and unknown card `0011223344AABB` (fake). The
opened workbook must contain all three rows with meeting date `2026-09-15`,
grades `12`, `11`, and blank for the unknown card, respectively.

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
   keys named above; Android, the shared Documents folder, where the app can
   see the files it wrote.
6. Attach a debugger to the WebView (Safari → Develop → the device, or
   `chrome://inspect`) and watch for a rejected `Filesystem.writeFile`. That
   one throws, so it should be visible rather than silent.

Repeat steps 1–5 on both an iPhone/iPad build and an Android build. Record the
OS version, app build, and whether the dismissed-share copy was found in
Files/Documents. Do not call this native export verified until the workbook
opens successfully on both platforms and the unknown-card row is present.

Until this has been run on a build someone will actually use, treat the
native export path as unverified — the SoR model in
[data-and-backup.md](data-and-backup.md) still holds, but only the web path has
been proven end to end.

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
