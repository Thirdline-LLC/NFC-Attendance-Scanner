# Developing this app in VS Code

Everything here was run on a clean Ubuntu 24.04 machine with no Replit, no
Android Studio and no prior Android SDK. Where a command could not be run
(anything requiring macOS, or a physical device) it is marked as such rather
than described as verified.

## 1. Tools you need

| Tool | Version used | Needed for | How to get it |
|---|---|---|---|
| **Node.js** | **22.12+ required** (verified on 24.20.0) | everything | `brew install node`, `nvm install 22`, or [nodejs.org](https://nodejs.org) |
| **pnpm** | 11.24.0 | everything — npm and yarn are refused | `corepack enable` (the root `packageManager` field then picks the right version) |
| **Git** | 2.55 | everything | preinstalled on macOS with Xcode CLT; `apt install git` |
| **JDK 21** | Temurin/MS 21.0.12 | Android only | `brew install --cask temurin@21`, or Android Studio's bundled JDK |
| **Android Studio** | Ladybug or newer | Android only | [developer.android.com/studio](https://developer.android.com/studio) |
| **Xcode Command Line Tools** | any current | macOS packaging only | `xcode-select --install` |
| **librsvg** | 2.58 | regenerating icons only | `brew install librsvg` / `apt install librsvg2-bin` |

**The root `preinstall` script rejects npm and yarn.** `npm install` here exits
with `Use pnpm instead`. That is deliberate: the lockfile, the catalog and the
build allowlist are all pnpm features.

**Node 20 is not enough.** vitest requires `^22.12.0 || ^24.0.0 || >=26.0.0`
and Vite requires `^20.19.0 || >=22.12.0`; the intersection is what the root
`engines` field declares. On Node 20 the install succeeds and then the test run
fails in a way that does not mention Node at all. Check with `node -v` first.

**JDK 25 does not work for the Android build.** Android Gradle Plugin 8.13
supports JDK 17–21. If `./gradlew` fails with a class-file version error, point
`JAVA_HOME` at a 21.

## 2. Install

```bash
git clone https://github.com/AM-Bear/NFC-Attendance-Scanner
cd NFC-Attendance-Scanner
corepack enable                 # once per machine; picks up `packageManager`
pnpm install                    # from the REPOSITORY ROOT, not from the app folder
```

Everything below works identically on macOS, Linux and (with the caveats noted)
Windows. The lockfile carries the Apple Silicon binaries for esbuild, rollup,
lightningcss and Tailwind's oxide, so an `arm64` Mac installs the same tree
this was verified on.

`pnpm install` at the root installs every workspace package. It takes about
16 seconds warm, a couple of minutes cold.

Two things about this workspace are worth knowing:

- **`pnpm-workspace.yaml` has a `minimumReleaseAge: 1440`.** No npm package
  published in the last 24 hours can be installed. This is a supply-chain
  defence; if an `add` fails because a version is too new, wait rather than
  disabling it.
- **`allowBuilds:` lists every dependency permitted to run an install script.**
  A package with a build script that is not listed makes `pnpm install` exit
  non-zero — which in turn makes every `pnpm run` fail, because pnpm checks
  dependency status before running a script. If you add a dependency with a
  postinstall, add it there too.

## 3. Run the app

```bash
pnpm --filter @workspace/nfc-attendance-scanner run dev
```

http://localhost:5173. The server binds to `localhost` only. Two variables
change that:

```bash
PORT=3000 pnpm --filter @workspace/nfc-attendance-scanner run dev   # different port
HOST=0.0.0.0 pnpm --filter @workspace/nfc-attendance-scanner run dev # reachable on the LAN
```

`HOST=0.0.0.0` is what you want to open the app from a tablet on the same
network, or from an Android emulator.

**The scanner input is hidden and auto-focused, so typing a 14-hex-character
UID and pressing Enter *is* a scan.** Use a **fake** synthetic UID — never a
real student's card. Convenient keyboard-wedge fakes:
`04AA0000000001` … `04AA0000000009` (fake). Other invented 14-hex values in
fixtures (for example `04A1B2C3D4E5F6` (fake)) are the same rule.

## 4. The commands

All of these take a `--filter @workspace/nfc-attendance-scanner`, or can be run
from `artifacts/nfc-attendance-scanner/` without it.

| Command | What it does | Output |
|---|---|---|
| `run dev` | Vite dev server | http://localhost:5173 |
| `run test` | vitest — the app and the Electron validators | — |
| `run test:browser` | vitest in real Chromium, two viewports | — |
| `run typecheck` | `tsc --noEmit` for the app *and* `electron/` | — |
| `run build` | the PWA | `dist/public/` |
| `run build:native` | the Capacitor bundle | `dist/public/` |
| `run build:electron` | the Electron renderer + main + preload | `dist/public/`, `dist/electron/` |
| `run native:sync` | build:native, then `cap sync android` | `android/app/src/main/assets/public` |
| `run native:android` | sync, then open Android Studio | — |
| `run android:apk` | sync, then `./gradlew assembleDebug` | `android/app/build/outputs/apk/debug/` |
| `run electron:dev` | Vite + Electron together, hot reload | — |
| `run electron:start` | the packaged renderer, no Vite | — |
| `run package:mac:dir` | unsigned `.app` — **macOS only** | `dist/desktop/mac*/` |
| `run package:mac` | `.dmg` — **macOS only** | `dist/desktop/` |

`pnpm exec playwright install chromium` once, before the first `test:browser`.

### The three build targets

`vite.config.ts` reads `BUILD_TARGET`, which `scripts/build.mjs` sets:

| Target | Asset base | Service worker | Manifest | CSP meta |
|---|---|---|---|---|
| `web` | `/` | yes | yes | yes |
| `capacitor` | `./` | **no** | no | no (see below) |
| `electron` | `./` | **no** | no | yes |

The two packaged shells use relative assets because the page sits at the root
of its own origin — `https://localhost` inside the Android WebView,
`app://attendance` inside the desktop app — with no path prefix to strip.

The Capacitor build has no CSP meta tag on purpose: that WebView serves the app
through Capacitor's own scheme handlers, and a policy nobody in this repo can
test on a device is not one to ship to a tablet.

`PORT` and `BASE_PATH` still work if you set them. `BASE_PATH=/attendance/` is
what you want if a static host gives this app a folder rather than a domain.

## 5. VS Code

Open the **repository root**, not the app folder — the workspace TypeScript,
the tasks and the lockfile all live there.

`.vscode/` in this repo provides:

- **`extensions.json`** — four suggestions (Prettier, Tailwind, Vitest, Gradle
  syntax). All open-source, none required, none proprietary.
- **`settings.json`** — pins the workspace TypeScript so the editor agrees with
  `pnpm run typecheck`, sets pnpm as the package manager, and excludes
  `node_modules`, `dist` and the Android build tree from search and file
  watching. It deliberately sets nothing about your theme, font or
  format-on-save.
- **`tasks.json`** — 15 tasks covering install, dev, tests, typecheck, all
  three builds, Android sync/open/APK, and the Electron and macOS steps.
  `⇧⌘B` runs typecheck; `⇧⌘P → Tasks: Run Task` lists the rest.
- **`launch.json`** — debug the web app in Chrome, debug the Electron main
  process with breakpoints in `electron/main.ts`, or debug the vitest file you
  currently have open.

The Electron renderer is debugged with the app's own DevTools (**View → Toggle
Developer Tools**), which is a different process from the one `launch.json`
attaches to.

## 6. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `Use pnpm instead` | You ran npm or yarn. The root `preinstall` refuses them. |
| `ERR_PNPM_IGNORED_BUILDS` and every `pnpm run` fails | A dependency has an install script that is not in `allowBuilds:` in `pnpm-workspace.yaml`. Add it with `true`, or run `pnpm approve-builds`. |
| `pnpm add` fails saying a version is too new | `minimumReleaseAge: 1440`. Wait a day. Do not disable it. |
| `Invalid BUILD_TARGET` | Use `node scripts/build.mjs <web\|capacitor\|electron>` or one of the `run build*` scripts. |
| `Port 5173 is already in use` | `strictPort` is on so a clash is loud rather than silent. Stop the other server or set `PORT`. |
| Electron exits with `libatk-1.0.so.0: cannot open shared object file` | Linux only, missing GUI libraries: `sudo apt install libatk1.0-0t64 libatk-bridge2.0-0t64 libcups2t64 libgtk-3-0t64 libgbm1 libasound2t64 libnss3`. Not an issue on macOS. |
| `Electron failed to install correctly` | Its runtime did not download. `node node_modules/electron/install.js`, or delete `node_modules/electron` and reinstall. Running `pnpm exec electron` once also triggers the download. |
| Android build: `Unsupported class file major version` | `JAVA_HOME` points at JDK 22+. Point it at 21. |
| Android build: `SDK location not found` | Set `ANDROID_HOME=$HOME/Library/Android/sdk` (macOS) or `$HOME/Android/Sdk` (Linux). |
| Android build: `Gradle build daemon disappeared unexpectedly` | Out of memory. Raise `org.gradle.jvmargs` in `android/gradle.properties`, or build with `--no-daemon --max-workers=1`. |
| `test:browser` cannot find a browser | `pnpm exec playwright install chromium` — once per machine. `CHROMIUM_PATH` overrides it with a system browser. |
| macOS: `xcrun: error: unable to find utility "codesign"` | Xcode Command Line Tools are missing. `xcode-select --install`. Only the macOS packaging needs them; dev and tests do not. |
| macOS: tests pass but `package:mac` fails immediately | Almost always the above. Check `xcode-select -p` prints a path. |
| Your edit does nothing in the browser | Almost always a stale service worker from a *production* build served on the same origin. Development never registers one; DevTools → Application → Service Workers → Unregister. |

## 7. What this project will not accept

These are architectural rules, not preferences:

- No backend, no server process in production, no API routes, no auth service,
  no cloud sync, no analytics, no telemetry, no automatic updates.
- **No runtime network calls of any kind.** Build tooling may use the network;
  the installed app may not.
- No remote fonts or images — the six woff2 faces are bundled in `src/fonts/`.
- The Android and macOS apps must never load a remote URL, and
  `capacitor.config.ts` must never gain a `server.url`.
- **Agents (bots) work on code and docs only.** Never open a live attendance
  workbook, a roster export, or a live tap log; never ask anyone to paste
  student PII or card UIDs into chat or issues. See `CLAUDE.md`.
- Real student names, emails and card UIDs never appear in source, fixtures,
  tests, logs, screenshots, handoffs or commits. **Synthetic UIDs only, and
  every example is fake:** any invented 14-character uppercase hex string
  (never copied from a real card). Label examples `(fake)` where a reader
  could mistake them for live UIDs. Values already used in this repo —
  including `04AA0000000001`–`04AA0000000009`, `04A1B2C3D4E5F6`,
  `04F6E5D4C3B2A1` and `0011223344AABB` — are all fake under this rule.
- Keystores, certificates, provisioning profiles and signing passwords never
  enter the repository. `.gitignore` blocks the usual file extensions, but the
  rule is on you, not on the ignore file.
