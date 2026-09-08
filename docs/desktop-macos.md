# The macOS desktop app

The same React app, packaged with Electron and distributed directly as a `.dmg`
containing a normal `.app`. It needs no Replit, no website, no server, no Mac
App Store, and no internet connection after installation.

> **A macOS build must be produced on macOS.** electron-builder can only make
> an `.icns`, sign with a Developer ID certificate, or notarize on a Mac. The
> source and configuration were written and verified on Linux; §3 says exactly
> what is verified and what is not.

## 1. How it is put together

```
electron/
  main.ts         window, app:// protocol, IPC handlers, CSP, permissions
  preload.ts      the whole renderer-facing bridge — two verbs
  validation.ts   every rule applied to renderer input (no Electron import → unit tested)
  build.mjs       esbuild → dist/electron/{main,preload}.cjs
  dev.mjs         starts Vite, waits for it, then launches Electron
  entitlements.mac.plist
electron-builder.yml
```

The renderer is the **same `src/` tree** as the web and Android builds. Nothing
is duplicated.

### The `app://` origin, and why it is not negotiable

The app does not `loadFile()`. It registers a private scheme and serves the
packaged renderer over it:

```
app://attendance/
```

A `file://` page has an opaque origin and Chromium treats its storage as
untrustworthy — IndexedDB there is unreliable at best. Everything this kiosk
knows lives in IndexedDB. A registered, `standard`, `secure` scheme is a normal
origin, so Dexie behaves exactly as it does on the web.

Verified from inside the running packaged app: origin `app://attendance`,
IndexedDB open, all four Dexie stores present (`persons`, `scans`, `settings`,
`taps`).

**Three strings are permanent identity:**

| | Value | Set in |
|---|---|---|
| Bundle id | `org.stjohnschs.attendance` | `electron-builder.yml` |
| Renderer origin | `app://attendance` | `electron/main.ts` |
| Data directory | `SJC Attendance` | `electron/main.ts`, `app.setPath` |

Change any of them and every installed Mac's roster and attendance history
becomes invisible — still on disk, under the old name, but not where the app
looks. The data directory is set explicitly rather than inherited from
`package.json`, which in this workspace would be
`@workspace/nfc-attendance-scanner` and would differ between a dev run and a
packaged one.

### Security

Verified by inspecting the live app:

| Setting | Value |
|---|---|
| `nodeIntegration` | `false` |
| `contextIsolation` | `true` |
| `sandbox` | `true` |
| `webviewTag` | `false` |
| `webSecurity` | `true` |

Also in force: `will-navigate` refuses any URL outside the app's own origin;
`setWindowOpenHandler` denies every popup; `will-attach-webview` is prevented;
every permission request (camera, microphone, location, notifications) is
denied outright; and the main process sends a restrictive
`Content-Security-Policy` as a real header, so a compromised bundle cannot relax
its own policy.

Verified in the renderer: `window.require`, `window.process`, `window.module`
and `window.Buffer` are all undefined, and `window.attendanceDesktop` has
exactly three keys — `platform`, `saveWorkbook`, `revealWorkbook`.

The CSP is provably live: it has no `unsafe-eval`, which is why a debugger's
`executeJavaScript` is refused by the page.

### The export bridge

There is no generic "read a file", "write a file", "run a command" or "open a
URL". The renderer hands over **bytes and a suggested filename**; the main
process re-validates both, and **the operator chooses the destination in the
system Save dialog**. Anything the renderer could be tricked into asking for is
something a person has already agreed to on screen.

- `filename` must match `^attendance-\d{4}-\d{2}-\d{2}-\d{8}T\d{6}Z\.xlsx$`.
  An allowlist, not a sanitiser: it rules out path separators, leading dots,
  drive letters, NULs and other extensions without the main process having to
  reason about what a safe path looks like. **Verified rejected:**
  `../../../etc/passwd`, `C:\Windows\attendance.xlsx`,
  `attendance-….xlsx\0.sh`, `attendance-….xlsx.command`, and eight more.
- `base64` must be base64, non-empty, a multiple of four long (or `Buffer.from`
  would silently truncate) and at most 64 MB.
- After writing, the main process **stats the file and checks its size** before
  reporting success. A write that resolved but produced an empty file is a
  failure and says so.
- **Cancelling is not failing.** Closing the dialog raises
  `ExportCancelledError`, and the app shows "Export cancelled" — not "the
  export did not run". Telling a teacher an export failed when they simply
  changed their mind sends them hunting for a fault that is not there.
- `revealWorkbook` only opens a path **this process wrote in this run**.

## 2. Develop

```bash
pnpm --filter @workspace/nfc-attendance-scanner run electron:dev
```

Starts Vite, waits for the port, builds the main and preload bundles, then
launches Electron against `http://localhost:5173` with hot reload. This is the
**only** case in which the app loads an http URL: it is opt-in through
`ELECTRON_RENDERER_URL`, which a packaged build never sets, and `app.isPackaged`
forbids it in a shipped build regardless.

To run exactly what ships — local files over `app://attendance`, no Vite:

```bash
pnpm --filter @workspace/nfc-attendance-scanner run electron:start
```

Renderer DevTools: **View → Toggle Developer Tools**. Main-process
breakpoints: the *"Electron: debug the main process"* configuration in
`.vscode/launch.json`.

⚠️ Development stores its data under `http://localhost:5173`, production under
`app://attendance`. They are different origins and do not share a roster. That
is correct — you do not want test scans in the real database — but it does mean
"it worked in dev" says nothing about what is in the packaged app.

## 3. Build the .app and the .dmg

```bash
# unsigned .app — for development
pnpm --filter @workspace/nfc-attendance-scanner run package:mac:dir

# .dmg — for distribution
pnpm --filter @workspace/nfc-attendance-scanner run package:mac
```

Output, under `artifacts/nfc-attendance-scanner/dist/desktop/`:

```
mac-arm64/SJC Attendance.app          Apple Silicon
mac/SJC Attendance.app                Intel
SJC Attendance-0.0.0-arm64.dmg
SJC Attendance-0.0.0.dmg
```

Two architecture-specific `.dmg` files rather than one universal binary: two
~90 MB downloads beat one ~180 MB one when a school is imaging laptops.

### What is and is not verified

**Verified, on Linux:**

- The renderer, main and preload all build (`run build:electron`).
- `electron-builder` reads `electron-builder.yml`, resolves the pnpm workspace
  root, and packages successfully.
- The resulting `app.asar` holds **exactly 25 files**: `dist/electron/*`,
  `dist/public/**` and `package.json`. **No `node_modules`** — every runtime
  dependency is already bundled into the renderer by Vite, and a pnpm
  workspace's symlinked tree is not something to hand to a packager.
- The **packaged** app launches and loads `app://attendance/` with the title
  *SJC Attendance Scanner*.

**Not verified — needs a Mac:**

- Producing `.icns` from `electron/resources/icon.png`.
- The `.dmg` itself, its drag-to-Applications layout, and mounting it.
- Code signing, notarization, stapling, and Gatekeeper's response.
- The macOS native Save dialog. The IPC either side of it is tested; the dialog
  is Apple's.

## 4. Install from the .dmg

Double-click the `.dmg`, drag **SJC Attendance** onto the **Applications**
shortcut, eject the disk image.

## 5. Gatekeeper, and why unsigned is not good enough for a school

An **unsigned** build will not open by double-clicking. macOS says:

> *"SJC Attendance" cannot be opened because Apple cannot check it for
> malicious software.*

On macOS 15 Sequoia and newer, the Control-click bypass no longer works from
the Finder alone; the user must go to **System Settings → Privacy & Security**,
find the blocked app in the Security section, and click **Open Anyway**.

On macOS 14 and earlier: **Control-click the app → Open → Open**.

**Use this for your own testing and nothing else.** For a school deployment it
is wrong on three counts:

1. It teaches staff to click past a security warning, which is exactly the
   habit that gets a school compromised.
2. Every update repeats the dance, so people stop updating.
3. It is unverifiable. Nothing proves the `.app` a teacher received is the one
   you built, or that nobody altered it in transit.

Sign and notarize. It costs $99/year and a few minutes per release.

## 6. Developer ID signing

**Requires an Apple Developer Program membership ($99/year).**

1. In [developer.apple.com](https://developer.apple.com/account/resources/certificates),
   create a **Developer ID Application** certificate. (Not "Mac App
   Distribution" — that one is for the App Store, which this project does not
   use.)
2. Download the `.cer` and double-click it to install it into the **login
   keychain** of the Mac that will do the building.
3. Confirm it is there:
   ```bash
   security find-identity -v -p codesigning
   # 1) ABCD…  "Developer ID Application: St John's Catholic School (TEAMID123)"
   ```

electron-builder finds it automatically. `hardenedRuntime: true` and
`electron/entitlements.mac.plist` are already configured — the entitlements are
the three V8 needs (`allow-jit`, `allow-unsigned-executable-memory`,
`allow-dyld-environment-variables`) and nothing else. No network entitlement,
no camera, no microphone, no location.

To build **unsigned on purpose** on a Mac that has a certificate:

```bash
CSC_IDENTITY_AUTO_DISCOVERY=false pnpm ... run package:mac
```

## 7. Notarization

Apple scans the app and issues a ticket. Without it, Gatekeeper still warns
even on a signed app.

Create an **app-specific password** at
[appleid.apple.com](https://appleid.apple.com) → Sign-In and Security →
App-Specific Passwords. It is not your Apple ID password.

```bash
export APPLE_ID="the-account@stjohnschs.org"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="TEAMID123"

pnpm --filter @workspace/nfc-attendance-scanner run package:mac:release
```

`package:mac:release` is `package:mac` with `--config.mac.notarize=true`.
Notarization is off by default so an unsigned development build never stalls
waiting on Apple.

**Never put these in a file in the repository, a commit, a CI log, or a chat
message.** Export them in the shell that runs the build, or keep them in the
macOS keychain. For CI, use encrypted secrets.

Notarization takes a few minutes. electron-builder waits and reports.

## 8. Stapling and verification

electron-builder staples the ticket for you. To do it by hand, or to check:

```bash
xcrun stapler staple "dist/desktop/SJC Attendance-0.0.0-arm64.dmg"
xcrun stapler validate "dist/desktop/SJC Attendance-0.0.0-arm64.dmg"
```

Stapling attaches the ticket to the file so Gatekeeper can verify it **without
a network connection** — which matters for a school laptop that gets the `.dmg`
on a USB stick.

Verify the signature:

```bash
codesign --verify --deep --strict --verbose=2 "/Applications/SJC Attendance.app"
codesign -dv --verbose=4 "/Applications/SJC Attendance.app"     # shows Authority and TeamIdentifier
```

Verify notarization — this is the one that predicts what a user will see:

```bash
spctl --assess --type execute --verbose "/Applications/SJC Attendance.app"
# → /Applications/SJC Attendance.app: accepted
#   source=Notarized Developer ID
```

`source=Notarized Developer ID` is the goal. `rejected` means something in the
chain did not complete.

## 9. Distributing it

No Mac App Store, and no App Store packaging has been set up. If you ever want
that, say so — it is a different signing identity, a different entitlement set,
and a sandbox this app currently does not opt into.

**Direct download.** Put the signed, notarized `.dmg` on the school's website,
Drive, or SharePoint. Notarized means it opens on any Mac with a double-click,
no warnings, no instructions.

**MDM** — the right answer for more than a handful of Macs:

| MDM | How |
|---|---|
| **Jamf Pro** | Wrap the `.app` in a `.pkg` (`productbuild --component "SJC Attendance.app" /Applications out.pkg`, signed with a *Developer ID Installer* certificate), upload as a package, scope to a smart group |
| **Mosyle** | Management → Custom Apps → upload the `.pkg`, assign to a device group |
| **Kandji** | Library → Add → Custom App → upload the `.pkg`, set the audit-and-enforce behaviour |
| **Intune** | macOS apps → Line-of-business app → upload the `.pkg` (Intune requires `.pkg`, not `.dmg`) |

All four want a **signed `.pkg`**. Notarize the `.pkg` too — it is a separate
submission from the `.dmg`.

**Keep every certificate and credential out of the repository.** `.gitignore`
blocks `*.p12`, `*.cer`, `*.provisionprofile` and friends, but that is a safety
net. Certificates belong in the build Mac's keychain; passwords belong in a
password manager or CI secrets.

## 10. Data

`~/Library/Application Support/SJC Attendance/`

That directory holds the Chromium profile, and inside it the IndexedDB that
holds the roster and every attendance tap.

- **Survives quitting and reopening** the app.
- **Survives replacing the app** — dragging a new `.app` over the old one —
  because the bundle id, the origin and the directory name all stay the same.
- **Survives an OS upgrade.**
- Dragging the app to the Trash leaves this directory behind; the data comes
  back if you reinstall. A "clean uninstaller" that removes application support
  files will delete it.
- Deleting this directory erases every record on the machine.

**Never clear it at startup, and never change the app identity to "start
fresh".** Export first — always. See [data-and-backup.md](data-and-backup.md).

## 11. The reader on macOS

The ACS reader is a USB HID keyboard. macOS treats it as a keyboard, with no
driver.

The first time a new USB keyboard is connected, macOS may show the **Keyboard
Setup Assistant** asking which key is next to the left Shift. Dismiss it — the
reader has no such key. It does not reappear.

Test the same way as on Android: open TextEdit, tap a card, confirm you see
**exactly fourteen uppercase hex characters and a newline**. Then in the app,
enroll a card and check it in.

> **Not verified.** No physical reader has been tested against this build on a
> Mac.

## 12. Release checklist

- [ ] `pnpm ... run test` and `run typecheck` pass
- [ ] `version` bumped in `artifacts/nfc-attendance-scanner/package.json`
- [ ] `run electron:start` — the packaged renderer works before packaging it
- [ ] Building on **macOS**, with the Developer ID certificate in the keychain
- [ ] `security find-identity -v -p codesigning` shows it
- [ ] `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` exported in the shell
- [ ] `run package:mac:release`
- [ ] `spctl --assess --type execute` → `accepted / source=Notarized Developer ID`
- [ ] `xcrun stapler validate` on the `.dmg`
- [ ] Installed from the `.dmg` on a Mac that has never seen this app
- [ ] Physical ACS reader tested: enroll, check in, duplicate
- [ ] Export tested: Save dialog appears, file written, **cancel reports
      cancelled and not failed**
- [ ] Wi-Fi off, app quit and reopened: the roster is still there
- [ ] Bundle id, origin and data directory unchanged from the last release
- [ ] No certificate, password or key in any commit
