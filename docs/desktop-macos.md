# The macOS desktop app

The same React app, packaged with Electron and distributed directly as a `.dmg`
containing a normal `.app`. It needs no Replit, no website, no server, no Mac
App Store, and no internet connection after installation.

> **A macOS build must be produced on macOS.** electron-builder can only make
> an `.icns`, sign with a Developer ID certificate, or notarize on a Mac. The
> source and configuration were written and verified on Linux; §3 says exactly
> what is verified and what is not.

> **Wave 1 release path (D1-a, Must #9).** Keep this Electron shell. Build the
> notarized DMG **on the school M2 Air** with `package:mac:signed` (**arm64
> only** — 8 GB RAM; do not run `package:mac:universal` or `package:mac:both`
> on that machine). Upload the `.dmg` and its SHA-256 to a **GitHub Release**
> by hand. `publish: null` in `electron-builder.yml` **stays**; never add
> `electron-updater` or any in-app update feed (Must #11). Shell lock:
> [`docs/decisions/2026-09-22-wave1-mac-shell-d1.md`](decisions/2026-09-22-wave1-mac-shell-d1.md).
> Operator checklist: [`docs/wave1-mac-dmg-runbook.md`](wave1-mac-dmg-runbook.md).
> Procurement / blocker: [`docs/deferred-apple-developer.md`](deferred-apple-developer.md).

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

**One command, on your Mac, from the repository root:**

```bash
pnpm install
pnpm --filter @workspace/nfc-attendance-scanner run package:mac
pnpm --filter @workspace/nfc-attendance-scanner run verify:mac
```

The first run downloads the Electron runtime (~100 MB) and takes a few minutes.
After that it is under a minute.

Output, under `artifacts/nfc-attendance-scanner/dist/desktop/`:

```
mac-arm64/SJC Attendance.app          the app itself
SJC Attendance-1.0.0-arm64.dmg        what you send to people
```

`package:mac` builds for **the Mac you are sitting at**, which is the fast path
and almost always what you want. Three variants when it is not:

| Script | Produces |
|---|---|
| `package:mac` | one `.dmg` for this Mac's architecture |
| `package:mac:both` | two `.dmg` files, arm64 **and** Intel x64 |
| `package:mac:universal` | one `.dmg` that runs on both (bigger file) |
| `package:mac:dir` | the bare `.app`, no disk image — fastest, for testing |

If any colleague still has an Intel Mac, use `package:mac:both` and send each
person the matching file, or `package:mac:universal` and send everyone the same
one.

**Wave 1 on the M2 Air (8 GB):** ship **arm64 only** (`package:mac` /
`package:mac:signed`). Do **not** run `:universal` or `:both` on that laptop —
both pull a second Electron runtime and risk memory pressure. Add an Intel
artefact only if a real Intel Mac shows up and it can be built on a machine
with headroom.

### Always run `verify:mac` before you send it anywhere

`pnpm --filter @workspace/nfc-attendance-scanner run verify:mac` checks the
things you cannot see in Finder:

- the bundle id, name and version are what every installed copy's data is keyed
  to (`org.stjohnschs.attendance`, `SJC Attendance`)
- the signature actually verifies — an app that fails this **will not launch**
  on Apple Silicon
- `disable-library-validation` and `allow-jit` really applied; without the
  first, an ad-hoc build crashes at launch with *"different Team IDs"*
- nothing Replit-related and no service worker got into the bundle
- the renderer is served from the app's own origin, not a URL

It is read-only and exits non-zero if anything is wrong.

## 4. Install it, and send it to another Mac

**On your own Mac:** open the `.dmg`, drag **SJC Attendance** onto the
**Applications** shortcut, eject the disk image. It opens by double-click — a
file you built locally is not quarantined.

**Sending it to someone else** — email, AirDrop, Drive, SharePoint, a USB
stick: all the same. The `.dmg` is self-contained; there is nothing to install
alongside it and nothing for the app to connect to.

The person receiving it drags the app into Applications the same way, and then
has to clear the quarantine flag **once**:

```bash
xattr -dr com.apple.quarantine "/Applications/SJC Attendance.app"
```

After that it opens normally, every time, with no warning.

**What they see if they open it first.** Verified on macOS 26.5 (25F71), Apple
Silicon, against a quarantined copy of this build that the Mac had never
approved:

> **"SJC Attendance" Not Opened**
>
> Apple could not verify "SJC Attendance" is free of malware that may harm your
> Mac or compromise your privacy.
>
> \[ Move to Trash ]  \[ Done ]

There is **no "Open Anyway" button in that dialog** — that is the macOS 15
change, and it still holds on macOS 26. "Open Anyway" is in System Settings,
which is why the Terminal one-liner above is the shorter route.

If they would rather not touch Terminal: open the app once and let macOS refuse,
then go to **System Settings → Privacy & Security**, scroll down to the
Security section, and click **Open Anyway** next to *SJC Attendance*. Same
result, more clicks.

> **Reproducing this on a Mac that has already run the app does not work.**
> Once a Mac has opened the app successfully, macOS records the approval and
> re-applying the quarantine flag no longer blocks it. A simulation also has to
> set the flag **recursively** (`xattr -w -r …`), because that is what a real
> download carries; `xattr -w` on the bundle alone let this build launch. Both
> were observed while verifying the above, so a "it wasn't quarantined after
> all" result on your own Mac is most likely the test, not the app.

## 5. Why macOS does that, and what would stop it

This build is **ad-hoc signed**: it carries a signature, but the signature
asserts no identity. Nobody — including macOS — can tell from the app who built
it.

That distinction is exactly what the two behaviours above come from:

- **Signed at all** is why it runs. Apple Silicon refuses to launch a binary
  with no signature whatsoever. Older macOS surfaced that as *"the application
  is damaged and can't be opened"*; on macOS 26.5 a signature-stripped copy of
  this build was refused with the same *"Not Opened" / "Apple could not
  verify…"* alert quoted in §4, so the wording no longer distinguishes
  "unsigned" from "not notarized". Either way it is misleading — the app is not
  damaged, it is unsigned.
- **No identity** is why it is quarantined. Gatekeeper's question is "do I know
  who made this and has Apple seen it?", and for an ad-hoc build the answer is
  no on both counts.

The manual step is a real cost, and worth being honest about: it repeats on
every update, and it teaches staff to click past a security warning. A
**Developer ID certificate plus notarization** removes it entirely — the app
would then open by double-click on any Mac, with no warning and no Terminal.
That needs a $99/year Apple Developer membership.

**Wave 1 un-defers that route** (Must #9), but it is still **blocked on
Asher's Apple Developer Program membership, Developer ID certificate, and
app-specific password** — see
[deferred-apple-developer.md](deferred-apple-developer.md) for the exact asks
and what is already in place. Everything below is the procedure W1-J runs on
the M2 once those exist. Until then, the ad-hoc path in §3–§4 remains what
anyone can build without an Apple account.

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

export SJC_SIGNING_IDENTITY="Developer ID Application: <school> (TEAMID123)"

pnpm --filter @workspace/nfc-attendance-scanner run package:mac:signed
```

`package:mac:signed` is `package:mac` with `--config.mac.identity` and
`--config.mac.notarize=true`. Notarization is off by default so the ad-hoc
build never stalls waiting on Apple. Remember to also delete the
`identity: "-"` line from `electron-builder.yml`, or it will win over the flag
on a later plain `package:mac`.

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

**Wave 1 — GitHub Releases (required path).** After `package:mac:signed` and
verification on the M2:

1. Compute SHA-256 of the `.dmg` (`shasum -a 256 "…arm64.dmg"`).
2. Create a GitHub Release (tag + notes) on
   `Thirdline-LLC/NFC-Attendance-Scanner` and attach the `.dmg` **and** a
   small text file or release note line with the SHA-256.
3. Leave `publish: null` in `electron-builder.yml`. Uploading assets to a
   Release is a publishing *step*; wiring electron-builder `publish` or adding
   `electron-updater` would make the app check a feed at runtime and break
   Must #11 (no automatic updates / no network path for updates).
4. **Private repo:** recipients need GitHub access (org member or a release
   asset URL shared to someone who can download). Do not assume an anonymous
   public download link. Document who may download in the release notes.

Short operator runbook: [wave1-mac-dmg-runbook.md](wave1-mac-dmg-runbook.md).

**Other direct download hosts (optional later).** School website, Drive, or
SharePoint still work for a notarized `.dmg` — double-click, no warnings — but
they are not the Wave 1 done-when; Releases is.

**MDM** — the right answer for more than a handful of Macs, and **currently
blocked**: all four of these want a *signed* `.pkg`, so this depends on the
Developer ID route in
[deferred-apple-developer.md](deferred-apple-developer.md). Recorded here for
when that happens:

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

### Ad-hoc (no Apple account — still valid for local testing)

- [ ] `pnpm ... run test` and `run typecheck` pass
- [ ] `version` bumped in `artifacts/nfc-attendance-scanner/package.json`
- [ ] `run electron:start` — the packaged renderer works before packaging it
- [ ] Building **on macOS**
- [ ] `run package:mac` (**arm64 only** on the M2 Air; avoid `:both` / `:universal` there)
- [ ] **`run verify:mac` passes** — signature verifies, entitlements applied,
      bundle identity unchanged, nothing Replit and no service worker inside
- [ ] Installed from the `.dmg` on this Mac and opened
- [ ] Installed on a Mac that has **never seen this app**, quarantine cleared
      with `xattr -dr com.apple.quarantine`, and it opens
- [ ] Physical ACS reader tested: enroll, check in, duplicate
- [ ] Export tested: Save dialog appears, file written, **cancel reports
      cancelled and not failed**
- [ ] Wi-Fi off, app quit and reopened: the roster is still there
- [ ] Bundle id, origin and data directory unchanged from the last release
- [ ] No certificate, password or key in any commit
- [ ] `electron-builder.yml` still has `publish: null`; no `electron-updater`

### Wave 1 notarized Release (W1-J → W1-L) — required for Must #9

Blocked until [deferred-apple-developer.md](deferred-apple-developer.md) W1-I
asks are done. Then:

- [ ] Certificate in the build Mac's keychain; `security find-identity -v -p codesigning` shows *Developer ID Application*
- [ ] `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` / `SJC_SIGNING_IDENTITY` exported in the shell only
- [ ] `run package:mac:signed` (arm64) on the M2
- [ ] `run verify:mac` passes
- [ ] `spctl --assess --type execute` → `accepted` / `source=Notarized Developer ID`
- [ ] `xcrun stapler validate` passes on the `.dmg`
- [ ] Fresh Mac: double-click install, **no** `xattr` step
- [ ] SHA-256 recorded; `.dmg` + checksum attached to a GitHub Release
- [ ] Still `publish: null`; `rg` finds no `electron-updater` / `autoUpdater` / Live Update
- [ ] No Apple credential in any workflow, commit, or chat

See [wave1-mac-dmg-runbook.md](wave1-mac-dmg-runbook.md).
