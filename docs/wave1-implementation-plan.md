# Tapin Wave 1 — implementation plan

**Date:** 2026-09-22 · **Status:** proposed, awaiting Reviewer (tech/docs gate) ·
**Baseline:** `main` at `dbce294` (PR #2 merged — roster Excel import and
unrecognized-card bind) · **Product name:** Tapin

Wave 1 has two halves and a hard order between them: **harden first, package
second.** The harden half closes the FERPA/COPPA gaps the operational checklist
names, on a codebase that already implements most of the controls. The packaging
half turns the Mac build into something a teacher installs from a GitHub Release
without being taught to click past a security warning.

This document is a plan. It changes no application code, no Capacitor project
and no workflow. Everything it proposes is a separate, reviewable slice, listed
in [§6](#6-slices-cpm-opens-next).

Three rules apply to every slice in it, and they are not negotiable:

- **No bot, agent or automation touches the workbook, the roster or student
  data.** Not to test, not to reproduce a bug, not to check an import. The
  fixtures in the repo are invented names and the synthetic UID range
  `04AA0000000001`–`04AA0000000009` (`docs/vscode-setup.md:183`). Nothing else
  goes in a test, a screenshot, a log, a commit or a plan.
- **No card UID appears anywhere, ever** — in this document, in a commit
  message, in a PR body or in a chat. A card UID opens a building. Where an
  example is unavoidable, it is the masked tail the app itself renders
  (`••••1F90`) or a synthetic UID from the range above.
- **The app stays offline.** No runtime network call, no updater, no telemetry
  (`docs/vscode-setup.md:176`–`182`). §3 has a specific trap about this.

## What this reuses, and what it deliberately does not write

The repo already carries four documents that Wave 1 builds on rather than
replaces. **This plan is not a packaging bible and must not become one.**

| Document | What Wave 1 takes from it |
|---|---|
| `docs/superpowers/specs/2026-09-08-ferpa-safe-kiosk-design.md` | The implemented FERPA-style control set — roles, the PIN gate, retention, the masked export, the activity log — and its own list of what it left open. It is the audit's primary evidence. |
| `docs/capacitor-native.md` | How the Capacitor shells are built and synced, what IndexedDB survives on each, and the native export path with its three tested behaviours. |
| `docs/desktop-macos.md` | The Mac shell as it actually ships: the `app://attendance` origin, the security posture, the export bridge, and §§6–8 — Developer ID signing, notarization, stapling and verification, written end to end. |
| `docs/deferred-apple-developer.md` | Why notarization was skipped, what it buys, and the exact list of what is already in place for it. Wave 1 is the wave that un-defers it. |

`docs/desktop-macos.md` is **Electron-oriented, and Wave 1's lock says Capacitor
Mac shell.** That collision is real and is [§3](#3-the-capacitor-mac-shell-and-a-notarized-dmg-from-github-releases)'s
main subject. The resolution is that later PRs **align the existing packaging
documents** with whatever shell is chosen — editing §§1, 3, 9 and 12 of
`docs/desktop-macos.md` in place — rather than adding a parallel Mac guide beside
it. Two Mac packaging documents that disagree is the failure mode to avoid; there
is already precedent for the fix, in the scope note `docs/capacitor-native.md:3`
carries after that document was superseded in part.

---

## 0. The baseline, measured

Everything below was checked on `dbce294` in a clean container, so the audit
starts from what is true rather than what was true in September.

| Fact | Value | How it was checked |
|---|---|---|
| Tests | **554 in 38 files** | `pnpm --filter @workspace/nfc-attendance-scanner test` |
| Typecheck | clean, app **and** `electron/` | `pnpm run typecheck` |
| CI | one job, `verify` — install, typecheck, unit tests, `ubuntu-latest` | `.github/workflows/verify.yml` |
| Build targets | `web`, `capacitor`, `electron` from one `src/` tree | `scripts/build.mjs`, `docs/vscode-setup.md:107` |
| Dexie schema | v6; `activity` is the newest table | `src/data/attendance-store.ts:92`–`159` |
| Activity kinds | 9, including `export-roster` and `import-roster` | `src/data/attendance-store.ts:48`–`57` |
| Mac shell | Electron, ad-hoc signed, `notarize: false` | `electron-builder.yml:62`, `:74` |
| Mac publish | `publish: null` — no update feed, by design | `electron-builder.yml:37` |

**One finding that changes how Wave 1 is sequenced.** The suite is not
deterministic. Across four consecutive full runs on `dbce294`, one run failed a
single assertion — *changes nothing when the same file is imported twice*, in
`src/roster/RosterPage.import.test.tsx:116`–`120` — and the other three, plus a
targeted re-run, were green.

The mechanism is specific, and it is the test rather than the app. That case
imports a roster file, waits for `text-import-summary`, imports the **same** file
again, and then `waitFor`s the summary to contain `0 students added`. The summary
element never unmounts between the two imports, so the `waitFor` is polling an
element that already exists holding the *first* import's text, with nothing
synchronising on the second import finishing. It passes when the re-render wins
the race against the default one-second timeout. Vitest's own output explains why
that race is close: the run creates **38 jsdom environments, 39% of tracked
time**. A shared CI runner or a loaded 8 GB Mac makes it worse, not better.

A harden wave whose evidence is "CI is green" cannot rest on a suite that is green
four times in five. Deflaking it is slice **W1-B**, and it is early. The fix is to
observe the transition — the summary being replaced, or the panel leaving its busy
state — not to raise the timeout.

---

## 1. FERPA/COPPA harden audit against Must #1–12

### The one open dependency in this plan

The operational checklist — *Asher Tapin FERPA/COPPA checklist, 2026-09-22*,
Must #1–12, **approved by Asher in chat on 2026-09-22 and therefore go-to-plan**
— is a command-side document. It is **not in this checkout and was not in
`uploads/` on the machine that wrote this plan.** Its command path, for a human
reviewer, is:

```
2026-09-22-asher-tapin-ferpa-coppa-checklist.md          # Must #1-12, approved
2026-09-22-tapin-next-wave-locked.md                     # architecture locks
2026-09-22-cos-tapin-grill-locked.md                     # grill routing
tap-in.md                                                # project state
```

So this section does what can be done from evidence and stops exactly where
invention would begin. It gives:

1. an **evidence register** — every FERPA-relevant control the code actually
   implements, with a file reference and a verdict, which is the half that needs
   no checklist to be true; and
2. a **Must #1–12 worksheet** — twelve numbered rows with the subject column
   left empty, to be filled from the command path and ticked.

**The worksheet's subjects are deliberately blank. Do not guess them.** A
plausible-sounding Must that nobody wrote is worse than an unfilled row: it gets
approved, and then it is policy. Filling them is slice **W1-C**, and no code
slice that claims to close a gap may merge before it.

No student data was read to produce any of this, and none is quoted in it.

### Evidence register — what the code already does

Verdicts are: **met** (implemented and tested), **gap** (the code or the docs are
wrong or missing), **ops** (the software is done; something outside it is not).

| # | Control | Evidence | Verdict |
|---|---|---|---|
| E1 | Roster and dashboard are unreachable without the teacher PIN, and the page component does not mount while locked | `src/lock/LockedRoute.tsx`, `src/app/AppRouter.tsx:43`,`:51` | **met** |
| E2 | PIN is 4–8 digits, PBKDF2-SHA-256 salted hash, never stored or logged in plain text | `src/data/operator-pin.ts`; `docs/data-protection.md:65` | **met** |
| E3 | Lockout after 5 failures, doubling to a 5-minute cap | `src/data/operator-pin.ts` | **met** |
| E4 | A card reader burst cannot submit the PIN field or lock the teacher out | `src/lock/pin-entry.ts`, `src/lock/PinDialog.tsx` | **met** |
| E5 | Unlock is in memory only — relocks on return to the scanner, on summary close, after 5 idle minutes, on reload | `src/lock/OperatorLockProvider.tsx` | **met** |
| E6 | The unset-PIN state is announced rather than hidden | scanner banner `text-pin-unset`; `docs/operating-the-kiosk.md:17` | **met** |
| E7 | No card UID is ever fully rendered — screen or file. One helper | `maskCardUid` in `src/lib/scan-format.ts`, used by `src/lib/attendance-export.ts` and `src/lib/roster-workbook.ts:112` | **met** |
| E8 | Written retention schedule, and two teacher-triggered purges that preview their cost and cannot run on their own | `src/ui/RetentionDialog.tsx`, `src/dashboard/DashboardPage.tsx:211`,`:227`; `docs/data-protection.md:168` | **met** |
| E9 | A record of disclosures and deletions that is not itself a disclosure — counts, timestamps, filenames, never a name, email or UID, capped at 500 | `src/data/attendance-store.ts:64`–`86`, `src/lib/activity-wording.ts` | **met** |
| E10 | Every export says where it went and names the destination rule | `src/ui/ExportNotice.tsx`; `src/lib/workbook-delivery.ts` | **met** |
| E11 | No runtime network call reaches out from the app | `docs/data-protection.md:86`–`105`, with the grep that proves it and the honest caveat about Capacitor's unused `fetch` | **met** |
| E12 | The roster import ignores the card column, so a workbook cannot rebind hardware it cannot name | `src/lib/roster-workbook.ts:29`–`31`, `:252` | **met** |
| E13 | The import refuses non-school-domain addresses, and its refusal reasons name a line number, never a student | `src/lib/roster-workbook.ts:287`–`297` | **met** |
| **G1** | **The docs deny that the roster import exists** | `docs/data-and-backup.md:160`–`162` ("Enrol the students again… **There is no roster import**") and `:170`–`171` ("**No import exists, and none is planned.** The app… never opens, reads or rewrites an existing workbook") | **gap** |
| **G2** | **The school-facing data document does not mention either half of the roster round trip** | `docs/data-protection.md` — no occurrence of "import" anywhere in the file; *What is stored*, *What leaves the device* and *The exported workbook is the real exposure* all predate PR #2 | **gap** |
| **G3** | **The roster workbook is an undocumented second export with a wider blast radius than the attendance one** | `src/lib/roster-workbook.ts:99`–`140` writes every student on the device — including students who have never tapped — with name, school address, graduation year, derived grade and masked card tail. `docs/data-protection.md:126` describes only the attendance export | **gap** |
| **G4** | **A student with no card yet is an undocumented record state** | `src/lib/roster-workbook.ts:112` emits an empty card cell; `docs/data-and-backup.md:14` still describes `persons` as "card UID, name, graduation year, email, enrolled-at" | **gap** |
| **G5** | **The activity log's documented coverage omits `import-roster`** | `docs/data-and-backup.md:17` and `docs/data-protection.md:153` enumerate "every export, removal, retention purge and PIN change". An import is none of those, and it is the one action that can add a whole class at once | **gap** |
| **G6** | **Retention has no answer for an imported student who never taps** | `removeAlumni` takes an `isAlumni` predicate over `persons` (`src/data/attendance-store.ts`), so a pre-enrolled student is removed once their class graduates — but not before, and nothing else reaches them. A mistaken import of the wrong class list is removed one student at a time from the Students page | **gap** |
| O1 | Whether the school considers itself FERPA-bound, and who owns the records | recorded open at `docs/superpowers/specs/2026-09-08-ferpa-safe-kiosk-design.md:56` and `:402` | **ops** |
| O2 | Which school account an export may be sent to | `docs/data-protection.md:145`; every export notice already states the rule | **ops** |
| O3 | Whether one school year of taps is the retention the school wants | `docs/data-protection.md:168`; the schedule is written, not agreed | **ops** |
| O4 | Which artefact is the system of record — the app's export or the OneDrive workbook | left open at `docs/superpowers/specs/2026-09-08-ferpa-safe-kiosk-design.md:52`. **Wave 1's lock answers this**; see §4 | **ops → closing** |
| O5 | Kiosk mode / Guided Access per platform, and encryption at rest | `docs/superpowers/specs/2026-09-08-ferpa-safe-kiosk-design.md:58`,`:59`. Device-level, documented as the device's job | **ops** |
| O6 | The native export has never run on a real device | `docs/capacitor-native.md:461`, `:530`. Unit-tested to the byte, unrun on hardware | **ops** |

Read together, the register says something worth saying plainly to the Reviewer:
**the harden half of Wave 1 is mostly a documentation truth-up, not a security
rebuild.** Thirteen controls are implemented and tested. Six gaps are open, and
five of the six (G1–G5) are documents that PR #2 made untrue or incomplete. Only
G6 is a product question, and it is a small one.

That matters because an undocumented data path is a real FERPA finding, not a
cosmetic one. `docs/data-and-backup.md` is the document a teacher follows when
replacing a device, and it currently tells them to re-tap every card because no
import exists. `docs/data-protection.md` is the document the school is handed
when it asks what the app does with student data, and it does not mention the
path that can put an entire class list on the device in one action.

### Must #1–12 worksheet

Fill *Subject* from the command-path checklist, verbatim. Then draw the evidence
from the register above — E-rows for a met, G-rows for a gap, O-rows for an ops
note — set a verdict, and for a gap name the slice that closes it.

The evidence column is left empty rather than pre-populated: which register rows
belong to which Must cannot be known without the Must's own wording, and a guess
here would be the invention this section exists to avoid.

| Must | Subject (fill from the checklist — do not infer) | Evidence (E/G/O rows) | Verdict | Slice |
|---|---|---|---|---|
| #1 | | | | |
| #2 | | | | |
| #3 | | | | |
| #4 | | | | |
| #5 | | | | |
| #6 | | | | |
| #7 | | | | |
| #8 | | | | |
| #9 | | | | |
| #10 | | | | |
| #11 | | | | |
| #12 | | | | |

Rules for filling it, so the result is auditable:

- **Already met** requires a file reference, not a claim. If the control is real
  but untested, it is a gap with a test attached, not a met.
- **Gap** must name the slice that closes it and, where the gap is behavioural, the
  test that will prove it closed.
- **Unverified ops note** is for anything the software cannot answer for —
  procurement, a school decision, a device check. Say who owns it. O1–O6 above are
  already in that shape and can be lifted in.
- A Must that the code cannot affect at all is still recorded, with **ops** and an
  owner. Silence reads as "met" to the next reader.

---

## 2. Redesign only what fails the audit

**Wave 1 ships no cosmetic redesign.** No new visual language, no re-skin, no
component-library churn, no relayout of a screen that works.

The bar for touching the interface in Wave 1 is one of exactly two things:

1. **The audit failed there.** A Must is unmet and the fix is on screen — a
   control that has to be reachable, a state that has to be announced, a disclosure
   that has to be prevented.
2. **The harden broke the UX.** A fix landed and the screen is now worse: a
   confirmation a teacher cannot complete, a gate that blocks the desk from
   checking someone in, wording that contradicts what the app does. Post-harden
   regression, not pre-existing taste.

Anything else is Wave 2. Specifically **not** reasons to redesign in Wave 1:

- a screen looking dated, dense or inconsistent with another screen;
- a metrics or dashboard idea, however small — that is Wave 2 by lock;
- a component the repo has in `src/components/ui/` and does not use yet;
- "while we are in here" — the commonest way a harden wave stops being reviewable.

Two practical consequences. **Wording changes that make a document and a screen
agree are in scope**, because a screen that claims something the app does not do
is an audit failure and not a paint job; G1–G5 will produce some. And **a gap
whose honest fix is a redesign gets written down and deferred, with the gap left
open**, rather than half-fixed with a hidden control. An open gap with a named
owner is a better Wave 1 outcome than a quiet one.

---

## 3. The Capacitor Mac shell and a notarized DMG from GitHub Releases

### What ships today

The Mac app is **Electron**, hand-written, and further along than "it builds":

- It serves the renderer over a registered, standard, secure `app://attendance`
  scheme rather than `file://`, specifically so Dexie behaves as it does on the
  web, verified from inside the running packaged app
  (`docs/desktop-macos.md:28`–`44`).
- `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`,
  `webviewTag: false`, `webSecurity: true`; `will-navigate` refuses off-origin
  URLs; every popup denied; every permission request denied; a real
  `Content-Security-Policy` header with no `unsafe-eval`, proven live because a
  debugger's `executeJavaScript` is refused (`docs/desktop-macos.md:61`–`86`).
- The export bridge is **two verbs wide**. The renderer hands over bytes and a
  suggested filename; the main process re-validates both against an allowlist
  regex, the operator picks the destination in the system Save dialog, and the
  main process stats the written file before reporting success. Cancelling is
  reported as cancelled, never as failed. `electron/validation.ts` has no Electron
  import so it is unit-tested directly (`docs/desktop-macos.md:88`–`110`).
- `scripts/verify-mac-build.sh` checks identity, signature, entitlements, and
  that nothing Replit-related and no service worker got into the bundle.
- `hardenedRuntime: true`, `entitlements.mac.plist` already carries exactly what
  notarization needs, and `package:mac:signed` already exists
  (`docs/deferred-apple-developer.md:48`–`63`).

### The collision, stated exactly

**Capacitor has no first-party macOS target.** Its officially supported
application targets are Android, iOS and Web; there is no desktop platform and no
`cap add macos`. The maintained route to a Capacitor desktop app is a third-party
platform package — `@capawesome/capacitor-electron` (MIT, Capacitor 6+, Electron
28+, macOS/Windows/Linux), which presents itself as the modern replacement for the
no-longer-maintained `@capacitor-community/electron`. Neither is installed here:
`package.json` carries `@capacitor/android` and `@capacitor/ios` only.

So "Capacitor Mac shell" does not mean adding a platform Capacitor ships. It
means **replacing the repo's hand-written Electron shell with a platform-owned
one**, and that has four consequences worth a decision rather than a merge:

| # | Consequence | Why it is not a detail |
|---|---|---|
| C1 | **The renderer origin changes.** The platform serves the app from its own scheme; `app://attendance` is this repo's own registration in `electron/main.ts` | IndexedDB is scoped to the origin. Three documents and one config comment say this string must never change — `README.md:64`–`70`, `docs/data-and-backup.md:101`, `docs/deferred-apple-developer.md:87`–`98`, `capacitor.config.ts:20`. Changing it leaves every installed Mac's roster and term of attendance **on disk and invisible to the app**. The platform's exact scheme string is **unverified** — it is not stated in the documentation reviewed for this plan, and it is the single fact that has to be established before C1 can be costed |
| C2 | **The export changes route, and gets weaker.** `deliverWorkbook` picks the desktop bridge first and only then Capacitor (`src/lib/workbook-delivery.ts`). Under a Capacitor platform the bridge is absent and `Capacitor.isNativePlatform()` is true, so the Mac would take the **`file`** route — write to Documents, offer a share sheet — instead of **`saved`** | The `saved` route is the only one that lets the operator choose the destination and the only one that can name the path it wrote. `docs/data-and-backup.md:126` promises exactly that for macOS, and `ExportNotice` wording and its tests assert it. Restoring it means writing a custom main-process plugin — app code, and a re-derivation of the validation surface `electron/validation.ts` already covers |
| C3 | **The hardened main process becomes platform-owned.** The platform advertises a sandboxed renderer, context isolation, a strict CSP and validated IPC **enabled by default and not configurable**, extended through typed options and hooks rather than by owning runtime code | Better than most defaults, and broadly the same posture. But it is *a different* posture, asserted by a third party, replacing one this repo verified by inspecting its own live app. In a wave whose subject is a privacy harden, that swap needs to be evidenced, not assumed |
| C4 | **`server.url` enters the toolchain.** The platform's live-reload development mode is driven by `server.url` in `capacitor.config.ts`, with a documented dev-only CSP relaxation | `docs/vscode-setup.md:182` says `capacitor.config.ts` **must never gain a `server.url`**, and `capacitor.config.ts:16`–`20` explains why. Dev-only is not an exemption the rule currently grants. Also: the platform ships Live Updates. An updater is the one thing that would make this app touch the network (`electron-builder.yml:37` disables the feed by design). If this route is taken, "no Live Update plugin, ever" becomes an acceptance criterion with a grep behind it |

None of this makes the lock wrong. It makes the lock's *cost* concrete, and the
lock already anticipates the shape: the next-wave document keeps a native rewrite
out of Wave 1 **unless Capacitor hits a hard wall.** C1 is a candidate hard wall,
and it points the opposite way from the usual one — the risk is not that Capacitor
cannot do the job, it is that migrating *to* it orphans data on Macs that are
already running the app.

### Decision gate D1 — which Mac shell Wave 1 ships

Owner: CPM, with Asher on the data question. It is resolved by slice **W1-H** and
blocks the packaging slices after it. It blocks **nothing** in the harden half,
which proceeds in parallel.

| Option | What it costs | What it risks |
|---|---|---|
| **D1-a — Keep the Electron shell; deliver the lock's outcome** (notarized DMG from Releases) and align the packaging docs | Smallest. Nothing in `src/` changes; `electron-builder.yml` gains a Developer ID identity and `notarize: true`, which `docs/desktop-macos.md:266`–`332` already documents step by step | Diverges from the letter of the lock. Leaves two desktop stories long-term — Capacitor for Android/iOS, bespoke Electron for Mac — which is a Wave 2+ maintenance argument, not a Wave 1 risk |
| **D1-b — Adopt `@capawesome/capacitor-electron`, preserving the origin** | Establish the platform's scheme, then pin the app's origin to `app://attendance` through the platform's typed options **if it can be pinned**. Re-implement the save bridge as a main-process plugin. Re-verify C3's posture. Resolve C4 | If the origin cannot be pinned, every Mac already running the app loses its roster unless a migration is built and tested — and there is no import path for attendance history, only for the roster (`src/lib/roster-workbook.ts`). This is the hard wall |
| **D1-c — Adopt the platform on a clean install only**, with a documented export-then-reinstall migration | Middle. Honest, and the export-first procedure already exists (`docs/data-and-backup.md:145`) | Costs every current Mac install its history-on-device, which the dashboard's year-to-date figures are computed from. Acceptable only if no Mac is yet carrying records that matter |

**Recommendation: D1-a for Wave 1**, with the Capacitor desktop platform
evaluated as a Wave 2 spike whose entry criterion is a verified answer to C1. The
reasoning is that Wave 1's stated done-when is *a notarized Mac DMG a teacher can
install from Releases* — an outcome about distribution, which D1-a reaches without
touching a line of `src/`, without re-deriving a security posture mid-harden, and
without putting an installed roster at risk. Wave 1 is the wrong wave to
re-platform the shell that holds the records.

This is a recommendation, not a decision. If the lock is read strictly and D1-b
is chosen, C1 becomes the first ticket and its acceptance is a verified scheme
string plus a device-tested upgrade that keeps an existing roster.

### Notarization: the blocker is procurement, not engineering

`docs/deferred-apple-developer.md` is unusually clear that **the work is done and
only the account is missing** — entitlements, hardened runtime, the signed script,
and the signing/notarizing/stapling procedure in `docs/desktop-macos.md:266`–`354`.

What Wave 1 must actually acquire:

- **An Apple Developer Program membership, $99/year, in the school's name** —
  not a personal Apple ID, so the certificate outlives whoever set it up
  (`docs/deferred-apple-developer.md:41`).
- **A Developer ID Application certificate** in the build Mac's login keychain,
  confirmed with `security find-identity -v -p codesigning`.
- **An app-specific password** for the notarization round trip.
- **A custody note**: which Mac holds the certificate, who can use it, what
  happens when that person leaves. `docs/deferred-apple-developer.md:46` already
  says one Mac holds it; Wave 1 should name it.

And one repo-hygiene consequence to settle before any CI work: the standing rule
is that certificates, keystores and signing passwords **never enter the
repository** (`docs/vscode-setup.md:186`). A GitHub Actions secret is not the
repository — but exporting the certificate as a base64 `.p12` into Actions
secrets does move it off the single build Mac, which is the arrangement
`docs/deferred-apple-developer.md:46` describes. That is a decision, and the
build-host subsection below is where it lands.

### Where to build: an 8 GB M2 against a 7 GB CI runner

The Mac build machine is an **8 GB M2**. The instinct is to move the build to CI.
The numbers do not support that as a memory argument:

| | 8 GB M2 (local) | `macos-latest` (GitHub-hosted) |
|---|---|---|
| CPU / RAM | M2, 8 GB | 3-core M1, **7 GB**, 14 GB SSD |
| Cost | none | private repos bill macOS at **10× the included-minute multiplier**, $0.062/runner-minute. A 15-minute notarizing job spends **150** included minutes |
| Certificate | stays in one Mac's keychain, as documented | must be exported into Actions secrets |
| Electron runtime | ~100 MB, downloaded once, then cached (`docs/desktop-macos.md:147`) | downloaded every cold run |

So CI is not more memory; it is less. Its real advantages are that it does not
tie up the teacher's Mac and that the build is reproducible — both genuine, both
Wave 2 concerns rather than Wave 1 blockers.

**Staged build guidance for Wave 1:**

- **Build single-architecture on the M2.** `package:mac` targets the building
  Mac's own architecture and is the documented fast path
  (`docs/desktop-macos.md:160`). On 8 GB that is comfortable.
- **Avoid `package:mac:universal` and `package:mac:both` locally.** Universal
  builds two full Electron runtimes and merges them; `:both` runs the build
  twice. These are the runs that will swap an 8 GB machine. The repo already
  documents the same class of failure for Android — *"Gradle build daemon
  disappeared unexpectedly | Out of memory"* (`docs/vscode-setup.md:166`) — and
  the same discipline applies: one build at a time, nothing else open.
- **Only build for Intel if an Intel Mac actually exists.** `docs/desktop-macos.md:169`
  makes this conditional already. Do not pay for universal by default.
- **Keep the `verify` workflow on `ubuntu-latest`.** Typecheck and unit tests
  have no reason to be on a macOS runner, and moving them there would spend the
  10× multiplier on every push.
- **If a macOS job is added later**, scope it to release tags only — never to
  `pull_request` — and treat the included-minute arithmetic above as the budget.

### GitHub Releases as the distribution path

Nothing in the repo mentions GitHub Releases today; `docs/desktop-macos.md:356`–`364`
says direct download from the school's website, Drive or SharePoint. Two traps:

- **`publish: null` must stay** (`electron-builder.yml:37`). Uploading a `.dmg`
  to a Release is a publishing step; wiring electron-builder's `publish` config or
  adding `electron-updater` turns the app into one that checks a feed at runtime,
  which breaks the offline guarantee and the privacy claim in
  `docs/data-protection.md:86` at the same time. Attaching the asset to a Release
  and enabling an auto-updater are different things, and Wave 1 wants exactly the
  first. This is an acceptance criterion with a grep behind it, not a note.
- **A private repository's Release assets need authentication to download.**
  `Thirdline-LLC/NFC-Attendance-Scanner` is private. A teacher on a school Mac
  cannot click a Release link and get a file. Wave 1 has to decide: the teacher
  downloads while signed in to an account with repo access; or the human-facing
  hand-off stays Drive/SharePoint with the Release as the archive of record and
  the SHA-256 source of truth; or a separate public distribution repo is created
  (with its own custody question). **Whichever is chosen, the DMG must be
  notarized and stapled**, because stapling is what lets Gatekeeper verify a file
  that arrived on a USB stick with no network (`docs/desktop-macos.md:334`).

Also worth stating in the release notes when the time comes: a notarized build
**ends** the `xattr -dr com.apple.quarantine` instruction
(`docs/desktop-macos.md:202`). That instruction is the thing Wave 1 is buying its
way out of — `docs/deferred-apple-developer.md:34` is explicit that its real cost
is teaching staff to click past a security warning.

---

## 4. Multi-device, as practical

The lock: **the Excel workbook in OneDrive is the system of record; each device's
database is a cache; there is no peer sync.** That closes O4, an open question
since `docs/superpowers/specs/2026-09-08-ferpa-safe-kiosk-design.md:52`.

### PR #2 is what makes this implementable

Before PR #2 the app only ever wrote workbooks. It now reads one back, and the
round trip has exactly the properties a cache-and-SoR model needs:

| Property | Where | Why it matters here |
|---|---|---|
| Export the roster to get the headers right, even on an empty device | `src/lib/roster-workbook.ts:124`; `docs/operating-the-kiosk.md:52` | The SoR workbook's schema is the app's own, so there is no format to agree |
| Import is idempotent — added / updated / unchanged / refused | `src/lib/roster-workbook.ts:208`; `docs/operating-the-kiosk.md:58` | Re-importing the SoR onto a second device converges instead of duplicating |
| Import **never removes** anybody | `docs/operating-the-kiosk.md:69` | A partial or stale workbook cannot silently delete a student from a device |
| Import **never touches a card** — the card column is masked, so it is read and ignored | `src/lib/roster-workbook.ts:29`,`:252` | Card bindings are per-device hardware facts. A workbook cannot rebind them, which is why two devices can share a roster without fighting over cards |
| One address identifies one student, within a file and on the device | `src/lib/roster-workbook.ts:299`; `src/ui/EmailConflictDialog.tsx` | The school email is the join key across devices, and it is derived, not typed |

The card-column property is the quiet load-bearing one. **Roster identity travels;
card bindings do not.** A second device that imports the same workbook knows the
same students and has bound none of their cards, and each card binds at whichever
kiosk the student taps. That is why "no peer sync" is a design position rather
than a limitation: there is nothing to reconcile.

### What the practical model is, and what Wave 1 writes down

- **Attendance does not merge, and Wave 1 does not pretend otherwise.** Taps live
  on the device that recorded them. Two devices at one meeting produce two
  exports, and the teacher's workbook is where they are combined — by a person,
  deliberately. The app builds no merge and no conflict resolution.
- **One device per meeting is the operating rule.** Multi-device is for a second
  kiosk at a different meeting, or a replacement device — not two lanes at one
  door. A second lane needs a merge the app will not have in Wave 1.
- **The device is a cache, and the cache is allowed to be lost.** This is already
  how the docs behave (export before anything; `docs/data-and-backup.md:145`), but
  the *reason* changes: the workbook upstream is authoritative, so re-provisioning
  a device is an import, not a re-enrollment. `docs/data-and-backup.md:154`–`173`
  currently says the opposite, which is G1.
- **The dashboard's year-to-date figures are per-device and must say so.**
  Cache-scoped numbers presented as the school's numbers is the misreading this
  model invites.

### The documentation change this forces

Four documents assert that **the app's own export** is the system of record:
`README.md:9`, `docs/data-and-backup.md:4`, `docs/capacitor-native.md:13` and
`:355`, `docs/data-protection.md:134`. Under the lock that is now half the
picture — the app's export is the authoritative record **of attendance**, and the
OneDrive workbook is the authoritative record **of the roster**, feeding devices
through import.

Both sentences can be true and the pair needs saying once, precisely, in
`docs/data-and-backup.md`, with the others pointing at it. Inventing a second
account of it in this plan would be the parallel-bible mistake *What this reuses*
warns about, so it is slice **W1-G** and it edits the existing document.

---

## 5. Explicitly out of Wave 1

Recorded so it is not re-litigated per PR. Each of these is a legitimate thing to
want and a wrong thing to do now.

| Out | Note |
|---|---|
| **Metrics, dashboards and any re-skin** | Wave 2 by lock. §2 is the boundary. A metrics idea arriving inside a harden PR is the specific failure this row exists to prevent |
| **Peer sync between devices** | Not in Wave 1 and not on a roadmap. §4 is the model: workbook upstream, no device-to-device anything. No server, no LAN discovery, no shared database |
| **A native rewrite** | Only if Capacitor hits a hard wall. C1 in §3 is the candidate, and it is a *migration* wall rather than a capability one. Nothing is rewritten on a hunch |
| **Renaming the repository** | Out of scope. The product is Tapin; `Thirdline-LLC/NFC-Attendance-Scanner` stays. Note this does **not** license renaming anything the OS keys data to — `org.stjohnschs.attendance`, `app://attendance` and the `SJC Attendance` data directory are frozen identity (`README.md:67`), and a product-name change must not reach them. That is the one place a rename would cost records |
| **Replit as the Mac DMG distribution path** | Out. Replit's production service for this app is `serve = "static"` over the web build (`artifacts/nfc-attendance-scanner/.replit-artifact/artifact.toml`) — a PWA host with no release-asset story. The DMG goes to Releases per §3 |
| **iOS / TestFlight** | The `ios/` project is committed and is explicitly not a current target (`README.md:86`). Wave 1 changes nothing there |
| **Android release signing** | Deferred separately (`docs/deferred-apple-developer.md:83`). The debug APK is the Android story until someone asks |
| **A withdrawal operation** (retain history, remove identity) | Designed-not-built, recorded at `docs/data-protection.md:230`. Only in scope if a Must names it |

---

## 6. Slices CPM opens next

Small, separately draftable, in dependency order. Harden first; packaging second.
Every slice is a draft PR against `main`.

**Phase 1 — harden (no Apple account needed, nothing blocked on D1)**

| Slice | Scope | Acceptance hints |
|---|---|---|
| **W1-A** | Docs truth-up for the roster round trip: G1, G4, G5 in `docs/data-and-backup.md` | `rg -in "no roster import\|none is planned"` over `docs/` returns nothing. *Replacing a device* names the import as step 4. The `persons` row admits a student can have no card. The `activity` row names all nine kinds. Docs-only diff |
| **W1-B** | Deflake `src/roster/RosterPage.import.test.tsx` — the double-import case (§0 names the mechanism) | 10 consecutive `pnpm --filter @workspace/nfc-attendance-scanner test` runs green. The fix synchronises on the second import completing, rather than raising the timeout or adding a retry flag. Touches no file outside `*.test.tsx` |
| **W1-C** | Fill the Must #1–12 worksheet from the command path; lift O1–O6 in as ops rows; Reviewer + Asher tick | Every Must has a verbatim subject, a verdict and — for a gap — a named slice. No row left blank. Docs-only. **Gates W1-D** |
| **W1-D** | Close whatever code gaps W1-C names. Deliberately empty until then | Each closed gap has a test naming the Must. No UI change that §2 does not license. Opens only after W1-C merges |
| **W1-E** | G2 and G3: the school-facing document covers both workbooks | `docs/data-protection.md` describes the roster export's contents and that it covers students who have never tapped; describes the import, that it ignores the card column, and that it can add a class in one action; *What is stored* admits the cardless state. No card UID in any example — masked tails or the synthetic range only |
| **W1-F** | G6: decide and document what retention does about an imported student who never taps | Either a store-level action with a preview and an activity row, following the `previewAlumniRemoval` shape (`src/data/attendance-store.ts`), or a written decision that the Students page is the answer — with the reason. Not both, not silent |
| **W1-G** | The multi-device operating procedure and the SoR sentence (§4) | `docs/data-and-backup.md` states which artefact is authoritative for the roster and which for attendance; names the one-device-per-meeting rule; says the year-to-date figures are per device. The other three SoR sentences point at it rather than restating it. Docs-only |

**Phase 2 — Capacitor Mac shell and the DMG (gated on D1, then on procurement)**

| Slice | Scope | Acceptance hints |
|---|---|---|
| **W1-H** | Resolve **D1**. A short decision record; on D1-b/c, establish the platform's scheme string first | The record names the option, the reason, and what it costs an installed Mac. If D1-b: the scheme is verified by running it, and the origin question is answered before any dependency is added. Docs-only |
| **W1-I** | Apple Developer membership, Developer ID certificate, app-specific password, custody note | `security find-identity -v -p codesigning` on the build Mac shows a *Developer ID Application* identity. The custody note names the machine and the owner. No credential in a commit, a log or this repo. Ops slice; may carry no diff beyond the custody note |
| **W1-J** | Notarized DMG, built on the M2, following the existing procedure | `verify:mac` passes. `spctl --assess --type execute` reports `accepted / source=Notarized Developer ID`. `xcrun stapler validate` passes on the `.dmg`. Installs by double-click on a Mac that has **never** seen the app, with no `xattr` step. `identity: "-"` removed from `electron-builder.yml` per `docs/desktop-macos.md:316`. Single-architecture unless an Intel Mac exists |
| **W1-K** | Align the packaging docs with what shipped — edit in place, add no parallel guide | `docs/desktop-macos.md` §§1/3/9/12 and `docs/deferred-apple-developer.md` describe the shipped route; the release checklist's Developer ID lines move from conditional to required; `README.md:40` no longer tells a recipient to clear quarantine. `docs/capacitor-native.md` gains a scope note if D1 changed the Mac shell |
| **W1-L** | Publish the DMG to a GitHub Release, and document the download for a non-technical teacher | A tagged release carries the notarized `.dmg` and its SHA-256. `electron-builder.yml:37` still reads `publish: null`. `rg -i "electron-updater\|autoUpdater"` returns nothing. No Apple credential appears in any workflow log. The private-repo download decision from §3 is written down, not assumed. **This is the only slice that may touch workflow YAML** |

Ordering notes for CPM:

- **W1-A, W1-B, W1-C, W1-E and W1-G are docs or test only and can run concurrently.**
  W1-A, W1-E and W1-G all edit privacy or backup documentation; sequence them or
  expect a conflict.
- **W1-D cannot open before W1-C merges.** A slice that claims to close a Must
  before the Musts are written down is unreviewable.
- **W1-I is procurement and has no engineering predecessor.** Start it the day
  D1 lands; the $99 and the certificate are wall-clock, not work.
- **W1-L is last on purpose.** It is the one slice with a CI surface, and it
  should describe a release that already happened by hand.

---

## 7. Done-when

Wave 1 is done when both of these are true, and not before:

1. **The FERPA/COPPA checklist is approved against this repo.** Every Must
   #1–12 has a verdict in the worksheet; every gap is either closed with a test
   or recorded as an ops item with a named owner; the privacy documents describe
   the app that actually shipped, roster import included; and `verify` is green
   on a suite that is green ten times out of ten.
2. **A notarized Tapin Mac DMG installs from a GitHub Release.** A teacher gets
   it from the Release, double-clicks, and the app opens — no Terminal, no
   `xattr`, no System Settings detour. `spctl --assess` reports
   `source=Notarized Developer ID`, the ticket is stapled so it verifies with no
   network, and the app still makes no runtime network call and carries no
   updater.

What is **not** part of done-when, so nobody holds Wave 1 open for it: the
device checks that need real hardware (`docs/capacitor-native.md:530`,
`docs/desktop-macos.md:419`), the school's answers to O1–O3, and anything in §5.
Those are tracked where they already are.

---

## Appendix — evidence index

Everything cited above, in one place, for a reviewer checking the plan against
the repo rather than against itself.

| Claim | Where |
|---|---|
| Implemented FERPA control set and its own open list | `docs/superpowers/specs/2026-09-08-ferpa-safe-kiosk-design.md` |
| PIN module, lockout, reader-burst defence | `src/data/operator-pin.ts`, `src/lock/pin-entry.ts`, `src/lock/PinDialog.tsx` |
| Route gate and in-memory unlock | `src/lock/LockedRoute.tsx`, `src/lock/OperatorLockProvider.tsx`, `src/app/AppRouter.tsx` |
| Activity kinds, entry shape, cap | `src/data/attendance-store.ts:48`–`86`, `:789` |
| Activity wording, one place | `src/lib/activity-wording.ts` |
| Masked card tail everywhere | `src/lib/scan-format.ts`, `src/lib/roster-workbook.ts:112` |
| Roster round trip — export, parse, ignore cards, refuse non-school addresses | `src/lib/roster-workbook.ts` |
| The three export routes and what each may promise | `src/lib/workbook-delivery.ts` |
| Desktop bridge contract, two verbs | `src/platform/desktop-bridge.ts`, `electron/validation.ts` |
| Build targets and the architectural rules | `docs/vscode-setup.md:107`, `:172`–`189` |
| Mac shell, origin, security, signing, notarization, stapling | `docs/desktop-macos.md` |
| What is already in place for Developer ID | `docs/deferred-apple-developer.md:48`–`63` |
| Frozen identity strings | `README.md:60`–`70`, `capacitor.config.ts:16`–`20` |
| Ad-hoc signature, no feed, hardened runtime | `electron-builder.yml:37`, `:62`–`74` |
| Per-platform storage and the export promise table | `docs/data-and-backup.md:53`–`134` |
| The "no import" statements this plan contradicts | `docs/data-and-backup.md:160`–`162`, `:170`–`171` |
| Teacher-facing roster and card-binding procedure | `docs/operating-the-kiosk.md:46`–`90` |
| Replit serves the PWA, not a DMG | `artifacts/nfc-attendance-scanner/.replit-artifact/artifact.toml` |
| CI job as it stands | `.github/workflows/verify.yml` |

Two external facts this plan leans on, recorded with their sources because they
are the kind that change:

- **Capacitor's officially supported targets are Android, iOS and Web** — there
  is no macOS platform. Desktop is served by a third-party platform package
  (`@capawesome/capacitor-electron`, MIT, Capacitor 6+/Electron 28+, presented as
  the replacement for the unmaintained `@capacitor-community/electron`).
  Checked 2026-09-22 against capacitorjs.com and capawesome.io. The scheme it
  serves the renderer from is **not** established here and is C1's blocking fact.
- **GitHub-hosted `macos-latest` is a 3-core M1 with 7 GB RAM**, billed on
  private repositories at $0.062/runner-minute and consuming included minutes at
  a **10× multiplier**. Checked 2026-09-22 against GitHub's runner and billing
  documentation.
