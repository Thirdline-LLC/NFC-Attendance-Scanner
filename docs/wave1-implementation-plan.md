# Tapin Wave 1 — implementation plan and design spec

**Date:** 2026-09-22 · **Status:** proposed, awaiting Reviewer (Front copy gate for this pack — not Desk) ·
**Baseline:** `main` at `dbce294` (PR #2 merged — roster Excel import and
unrecognized-card bind) · **Product name:** Tapin (one word)

This is the wave-1 design spec of record: the artefact `state/tap-in.md`'s *Next
action* asks CPM to open before the harden PRs. It is a plan. **It changes no
application code, no Capacitor project, no workflow and no config** — everything
it proposes is a separate, reviewable slice, listed in [§6](#6-slices-cpm-opens-next).

Wave 1 has two halves and a hard order between them, and the order is locked:
**harden against the signed checklist first, then Capacitor Mac distribution.**
The harden half closes the gaps Must #1–12 name, on a codebase that already
implements most of the controls. The distribution half turns the Mac build into
something a club operator installs from a GitHub Release without being taught to
click past a security warning.

## The locks this plan is written against

Four command-side documents are authoritative. They are not in this repo; these
are their command paths, for a human reviewer:

| Command path | What it fixes |
|---|---|
| `decisions/2026-09-22-tapin-next-wave-locked.md` | Architecture, sequence, identity, multi-device data, distribution, done-when. On vault `main` @ `75aacda`, so the assignment gate is cleared |
| `handoffs/2026-09-22-asher-tapin-ferpa-coppa-checklist.md` | **Must #1–12.** Approved by Asher in chat 2026-09-22; treated here as go-to-plan |
| `handoffs/2026-09-22-cos-tapin-grill-locked.md` | Routing: Drafter/CoS author the checklist, then CPM's Capacitor spike, then GPM refreshes state |
| `state/tap-in.md` | Project state, the workbook as data store, the hardware, branch protection, and the **post-build audits** Asher added 2026-09-22 |

Three rules from those locks apply to every slice below, and they are not
negotiable:

- **Bots never touch student data** (Must #3). CoS, CPM, Ops and every coding
  agent work on code and docs only. They do not open, copy or process the school
  workbook, a roster export, or a live tap log. This plan was written without
  reading any of them.
- **No card UIDs in repo, chat, logs, screenshots or handoffs** (Must #4). Where
  an example is unavoidable it is a **synthetic UID labelled fake**, or the masked
  tail the app itself renders (`••••1F90`). §1 has a finding about how well the
  repo currently keeps this.
- **No minors PII leaves its home system** (Must #6) — not into command chat, a
  GitHub issue, or bot memory. §1 records the check.

And two from the sequence lock, because they constrain how §6 is executed:
**redesign only what fails audit (or feels wrong after harden)**, and **do not run
three parallel rebuilds.**

## What this reuses, and what it deliberately does not write

The repo already carries four documents that Wave 1 builds on rather than
replaces. **This plan is not a packaging bible and must not become one.**

| Document | What Wave 1 takes from it |
|---|---|
| `docs/superpowers/specs/2026-09-08-ferpa-safe-kiosk-design.md` | The implemented FERPA-style control set — roles, the PIN gate, retention, the masked export, the activity log — and its own list of what it left open. The audit's primary evidence. |
| `docs/capacitor-native.md` | How the Capacitor shells are built and synced, what IndexedDB survives on each, and the native export path with its three tested behaviours. |
| `docs/desktop-macos.md` | The Mac shell as it actually ships: the `app://attendance` origin, the security posture, the export bridge, and §§6–8 — Developer ID signing, notarization, stapling and verification, written end to end. |
| `docs/deferred-apple-developer.md` | Why notarization was skipped, what it buys, and the exact list of what is already in place for it. Wave 1 is the wave that un-defers it. |

`docs/desktop-macos.md` is **Electron-oriented, and Must #9 says Capacitor Mac
shell.** That collision is real and is [§3](#3-must-9--capacitor-mac-sideload-and-a-notarized-dmg-from-github-releases)'s
main subject. The resolution is that later slices **align the existing packaging
documents** with whatever shell is chosen — editing §§1, 3, 9 and 12 of
`docs/desktop-macos.md` in place — rather than adding a parallel Mac guide beside
it. Two Mac packaging documents that disagree is the failure mode to avoid; there
is precedent for the fix in the scope note `docs/capacitor-native.md:3` carries
after that document was superseded in part.

---

## 0. The baseline, measured

Checked on `dbce294` in a clean container, so the audit starts from what is true
rather than what was true in September.

| Fact | Value | How it was checked |
|---|---|---|
| Tests | **554 in 38 files** | `pnpm --filter @workspace/nfc-attendance-scanner test` |
| Typecheck | clean, app **and** `electron/` | `pnpm run typecheck` |
| CI | one job, `verify` — install, typecheck, unit tests, `ubuntu-latest`; required on protected `main` | `.github/workflows/verify.yml` |
| Build targets | `web`, `capacitor`, `electron` from one `src/` tree | `scripts/build.mjs`, `docs/vscode-setup.md:107` |
| Dexie schema | v6; `activity` is the newest table | `src/data/attendance-store.ts:92`–`159` |
| Activity kinds | 9, including `export-roster` and `import-roster` | `src/data/attendance-store.ts:48`–`57` |
| Mac shell | Electron, ad-hoc signed, `notarize: false` | `electron-builder.yml:62`, `:74` |
| Mac publish | `publish: null` — no update feed, by design | `electron-builder.yml:37` |
| Bot memory | **no student data** — no school address, no 14-character hex string in any of the six files | `rg -c '@stjohnschs\|[0-9A-Fa-f]{14}' .agents/memory/` → no matches |

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

`verify` is a required status check on protected `main`, so this flake can block a
merge that has nothing to do with it. Deflaking it is slice **W1-B** and it is
early. The fix is to observe the transition — the summary being replaced, or the
panel leaving its busy state — not to raise the timeout.

---

## 1. FERPA/COPPA harden audit against Must #1–12

Scope: **code and docs gaps only.** No student data was read to produce this, and
none is quoted in it.

One framing point the checklist itself insists on, and this plan honours: it is
**an operational checklist from locked product rules, not a legal finding.** It
records "no law browsing this pass" and marks the legal sufficiency of the
FERPA/COPPA labels `[UNVERIFIED]` pending a Scout counsel packet. The repo already
behaves correctly here — `docs/data-protection.md:5` says it "is not legal advice,
and it does not claim compliance with FERPA, COPPA or any other regime — that
judgement belongs to the school." **Nothing in Wave 1 upgrades that document into
a compliance claim**, and nothing re-derives law. `docs/data-protection.md:7`–`23`
carries a 2026-09-08 analysis; it stays what it is, a recorded reading, and is not
cited as the answer.

### Evidence register

Verdicts: **met** (implemented and tested), **gap** (the code or the docs are
wrong or missing), **ops** (the software is done; something outside it is not).

| # | Control | Evidence | Verdict |
|---|---|---|---|
| E1 | Roster and dashboard unreachable without the teacher PIN, and the page component does not mount while locked | `src/lock/LockedRoute.tsx`, `src/app/AppRouter.tsx:43`,`:51` | **met** |
| E2 | PIN 4–8 digits, PBKDF2-SHA-256 salted hash, never stored or logged in plain text | `src/data/operator-pin.ts`; `docs/data-protection.md:65` | **met** |
| E3 | Lockout after 5 failures, doubling to a 5-minute cap | `src/data/operator-pin.ts` | **met** |
| E4 | A card reader burst cannot submit the PIN field or lock the teacher out | `src/lock/pin-entry.ts`, `src/lock/PinDialog.tsx` | **met** |
| E5 | Unlock is in memory only — relocks on return to the scanner, on summary close, after 5 idle minutes, on reload | `src/lock/OperatorLockProvider.tsx` | **met** |
| E6 | The unset-PIN state is announced rather than hidden | scanner banner `text-pin-unset`; `docs/operating-the-kiosk.md:17` | **met** |
| E7 | No card UID ever fully rendered — screen or file. One helper | `maskCardUid` in `src/lib/scan-format.ts`, used by `src/lib/attendance-export.ts` and `src/lib/roster-workbook.ts:112` | **met** |
| E8 | Written retention schedule, and two teacher-triggered purges that preview their cost and never run on their own | `src/ui/RetentionDialog.tsx`, `src/dashboard/DashboardPage.tsx:211`,`:227`; `docs/data-protection.md:168` | **met** |
| E9 | A record of disclosures and deletions that is not itself a disclosure — counts, timestamps, filenames, never a name, email or UID, capped at 500 | `src/data/attendance-store.ts:64`–`86`, `src/lib/activity-wording.ts` | **met** |
| E10 | Every export says where it went and names the destination rule | `src/ui/ExportNotice.tsx`; `src/lib/workbook-delivery.ts` | **met** |
| E11 | No runtime network call reaches out from the app | `docs/data-protection.md:86`–`105`, with the grep that proves it and the honest caveat about Capacitor's unused `fetch` | **met** |
| E12 | Identity is exactly email + first + last + grad year; no SSN, DOB, address or photo | `docs/data-protection.md:32` and `:41`; `src/lib/student-email.ts` | **met** |
| E13 | The school email is the join key, derived rather than typed, and one address identifies one student | `src/lib/student-email.ts`, `src/ui/EmailConflictDialog.tsx`, `src/lib/roster-workbook.ts:299` | **met** |
| E14 | A card binds to the email row, at the kiosk, on the card holder's own tap | `src/ui/CardBindDialog.tsx`, `src/data/roster-binding.test.ts`; `docs/operating-the-kiosk.md:75`–`90` | **met** |
| E15 | The roster import ignores the card column, so a workbook cannot rebind hardware it cannot name | `src/lib/roster-workbook.ts:29`–`31`, `:252` | **met** |
| E16 | The import refuses non-school-domain addresses, and its refusal reasons name a line number, never a student | `src/lib/roster-workbook.ts:287`–`297` | **met** |
| E17 | The reader is a plain HID keyboard; no reader SDK and no network path for a UID | `docs/capacitor-native.md:568`, `docs/desktop-macos.md:408`; no reader dependency in `package.json` | **met** |
| E18 | No backend, no sync, no analytics, no telemetry, no automatic updates | `docs/vscode-setup.md:176`–`182`; `electron-builder.yml:37` | **met** |
| E19 | Signing material cannot be committed by accident, and the rule is written down | `.gitignore` blocks `*.p12`/`*.cer`/`*.provisionprofile`; `docs/vscode-setup.md:186`; `docs/desktop-macos.md:319` | **met** |
| **G1** | **The docs deny that the roster import exists** | `docs/data-and-backup.md:160`–`162` ("Enrol the students again… **There is no roster import**") and `:170`–`171` ("**No import exists, and none is planned.** The app… never opens, reads or rewrites an existing workbook") | **gap** |
| **G2** | **The school-facing data document does not mention either half of the roster round trip** | `docs/data-protection.md` — no occurrence of "import" anywhere in the file; *What is stored*, *What leaves the device* and *The exported workbook is the real exposure* all predate PR #2 | **gap** |
| **G3** | **The roster workbook is an undocumented second export with a wider blast radius than the attendance one** | `src/lib/roster-workbook.ts:99`–`140` writes every student on the device — including students who have never tapped — with name, school address, graduation year, derived grade and masked card tail. `docs/data-protection.md:126` describes only the attendance export | **gap** |
| **G4** | **A student with no card yet is an undocumented record state** | `src/lib/roster-workbook.ts:112` emits an empty card cell; `docs/data-and-backup.md:14` still describes `persons` as "card UID, name, graduation year, email, enrolled-at" | **gap** |
| **G5** | **The activity log's documented coverage omits `import-roster`** | `docs/data-and-backup.md:17` and `docs/data-protection.md:153` enumerate "every export, removal, retention purge and PIN change". An import is none of those, and it is the one action that can add a whole class at once | **gap** |
| **G6** | **Retention has no answer for an imported student who never taps** | `removeAlumni` takes an `isAlumni` predicate over `persons` (`src/data/attendance-store.ts`), so a pre-enrolled student goes once their class graduates — but not before, and nothing else reaches them. A mistaken import of the wrong class list is undone one student at a time from the Students page | **gap** |
| **G7** | **The repo's example-UID convention and its practice disagree, and no example is labelled fake** | `docs/vscode-setup.md:184`–`185` declares `04AA0000000001`–`04AA0000000009` as the only permitted synthetic UIDs. The repo actually contains **25 distinct 14-character hex UIDs**, of which exactly two are in that range, across three files — the two documents that *state* the rule (`docs/vscode-setup.md`, `docs/android-packaging.md`) and one test. So the declared convention governs four occurrences and the other 23 values govern everything else. The fixture workhorse `04A1B2C3D4E5F6` (fake — a synthetic fixture value, no card) alone is in 21 test files and 3 documents, and `docs/capacitor-native.md:536`–`540` prints invented student names beside three UIDs as real-device check instructions. Every one is invented — **no real UID was found** — but Must #4 asks for a synthetic UID *labelled fake*, and none is | **gap** |
| **G8** | **The repo says "a student runs the desk"; Must #7 says "club operators or a teacher"** | `…ferpa-safe-kiosk-design.md:38` and `docs/data-protection.md:46` build the Desk role explicitly around a student at the device. A student club lead *is* a club operator, so the shipped model conforms — but read alone, Must #7 ("school staff / club leads") can be taken to retire the desk role | **gap (wording)** |
| **G9** | **Four documents name the app's own export as the system of record; Must #1 names the OneDrive workbook** | `README.md:9`, `docs/data-and-backup.md:4`, `docs/capacitor-native.md:13` and `:355`, `docs/data-protection.md:134`. And `docs/data-protection.md:182` makes the retention schedule rest on it: "The exported workbooks are the retained record" | **gap** |
| **G10** | **Bots-never-touch-data is not written anywhere in the repo** | `docs/vscode-setup.md:183` forbids real names, emails and UIDs in source, fixtures, tests, logs, screenshots and commits — which is most of Must #4 and #6, but not Must #3. Nothing tells the next coding agent it may not open the workbook | **gap** |
| O1 | Whether the school considers itself FERPA-bound, and who owns the records | `…ferpa-safe-kiosk-design.md:56`, `:402` | **ops** |
| O2 | Which school account an export may be sent to | `docs/data-protection.md:145`; every export notice already states the rule | **ops** |
| O3 | Whether one school year of taps is the retention the school wants | `docs/data-protection.md:168`; the schedule is written, not agreed | **ops** |
| O4 | **Whether the OneDrive folder's ACLs already limit workbook access to operators only** | Checklist open item, `[UNVERIFIED]`. The app cannot enforce this — it is the SoR's own access control, and under Must #1 the SoR is where the truth lives. Confirm with the operator before pilot | **ops** |
| O5 | Kiosk mode / Guided Access per platform, and encryption at rest | `…ferpa-safe-kiosk-design.md:58`, `:59`. Device-level, documented as the device's job | **ops** |
| O6 | The native export has never run on a real device | `docs/capacitor-native.md:461`, `:530`. Unit-tested to the byte, unrun on hardware |  **ops** |
| O7 | **No physical reader has been tested against the Mac build**, and the Bluetooth unit on macOS is untested | `docs/desktop-macos.md:419`. `state/tap-in.md` names both readers: ACR1552U-MF wired (working) and ACR1555U Bluetooth | **ops** |
| O8 | **Apple Developer account and notarization path** | Checklist open item, `[UNVERIFIED]`, assigned to Ops/CPM after sign. §3 | **ops** |
| O9 | **Whether COPPA applies to this high-school operator model** | Checklist open item, `[UNVERIFIED]` — **mark only.** The checklist is explicit: *do not invent an age gate here.* This plan proposes none | **ops** |
| O10 | **A Scout FERPA/COPPA counsel packet**, if statute-level citations are wanted | Checklist open item, `[NEEDS]`. Not routed. Neither the checklist nor this plan invents them | **ops** |
| O11 | Repo rename to match the product name | Checklist open item, `[NEEDS: rename assign]`. Out of Wave 1 (§5) | **ops** |
| O12 | **The checklist's signature block is blank** | Approved by Asher in chat 2026-09-22 and go-to-plan, but the sheet's *Date* and *Signature / initials* lines are empty — and Wave 1's done-when is literally "this checklist **signed**". Filing the signed copy is the checklist's own *Next (after sign)* step 1, as a photo or scanned PDF path, never a roster pasted into chat | **ops** |

Read together, the register says something worth saying plainly to the Reviewer:
**the harden half of Wave 1 is mostly a documentation truth-up, not a security
rebuild.** Nineteen controls are implemented and tested. Ten gaps are open, and
**nine of the ten are documents** — six that PR #2 made untrue or incomplete
(G1–G5, G9), one convention the repo does not follow (G7), one wording
reconciliation (G8), and one rule that binds agents but is not written down
(G10). Only G6 is a product question, and it is a small one.

That matters because an undocumented data path is a real finding, not a cosmetic
one. `docs/data-and-backup.md` is the document an operator follows when replacing
a device, and it currently tells them to re-tap every card because no import
exists. `docs/data-protection.md` is the document the school is handed when it
asks what the app does with student data, and it does not mention the path that
can put an entire class list on the device in one action.

### Must #1–12 map

| Must | Control (from the signed sheet) | Evidence | Verdict | Slice |
|---|---|---|---|---|
| **1** | Excel / OneDrive is the system of record — the school workbook holds the live roster **and attendance truth** | G9; E10 | **gap (docs).** The code is right — the app only ever feeds the workbook — but five sentences across four documents name the app's own export as the SoR, and the retention schedule rests on that reading | **W1-G** |
| **2** | App on-device DB is a cache only; not the SoR; no peer-device sync | E18; G9 | **met (code), gap (docs).** No sync exists and none is reachable; the documents describe the device as where records live rather than as a cache | **W1-G** |
| **3** | Bots never touch student data — code and docs only | G10 | **met in practice, gap (docs).** This plan and its audit read none. But nothing in the repo tells the next agent session the rule, so it holds by convention rather than by instruction | **W1-A** |
| **4** | No card UIDs in repo, chat, logs, screenshots or handoffs; synthetic UIDs labelled fake | G7 | **gap.** No real UID is in the repo. But 23 of the 25 distinct example UIDs sit outside the one declared synthetic range, none is labelled fake, and three are printed beside invented student names | **W1-D** |
| **5** | Identity is email + first + last + grad year; email is the join key; UID binds to that email row; no SSN, DOB, address or photo | E12, E13, E14 | **met.** `docs/data-protection.md:41` already states the four exclusions by name. The store keeps one field beyond the four plus the UID — `enrolledAt` — which is not a prohibited category | — |
| **6** | No minors PII into command chat, GitHub issues or bot memory | E12; baseline row | **met, and re-checkable.** `.agents/memory/` holds six files and none contains a school address or a 14-character hex string. Keep the grep in the audit | — |
| **7** | Operators are club operators or a teacher; day-to-day use is school staff / club leads, not bots | G8; E1, E5 | **met, wording to reconcile.** The two-role gate is exactly this control in software. The vocabulary differs from the repo's "a student runs the desk" | **W1-E** |
| **8** | Keyboard-wedge NFC stays; no cloud reader API that ships UIDs off-device | E17; O7 | **met (code), ops (device check).** Nothing could ship a UID anywhere — there is no network path. No physical reader has been tested against the Mac build, and the Bluetooth reader on macOS is untested | **W1-J** (device check) |
| **9** | Capacitor Mac sideload for wave-1 distribute; notarized DMG via GitHub Releases; no MDM for v1; PWA may remain a Chromebook fallback later | §3; O8 | **gap (decision) + ops (account).** Capacitor has no first-party macOS target, so this is a shell decision (D1), not a build flag. "No MDM for v1" retires the blocked-MDM matrix at `docs/desktop-macos.md:366`–`380` for this wave | **W1-H**, **W1-I**, **W1-J**, **W1-L** |
| **10** | Metrics v1 = present vs missing only, per meeting (roster − taps); no late / duration | — | **scope fence, no Wave 1 code.** Metrics are step 5 of the locked sequence, i.e. wave 2. Worth recording that `roster − taps` is *computable at all* only because PR #2 lets the roster hold students who have never tapped; today's dashboard shows year-to-date figures and a count of unclaimed cards (`docs/operating-the-kiosk.md:162`), not present/missing | — (§2 enforces) |
| **11** | Private student-data SaaS deferred; no peer sync backend; no third-party SaaS as SoR | E18 | **met, with two named ways to breach it.** Both are in §3: the Capacitor desktop platform's Live Update feature (C4), and an `electron-updater` arriving with the Releases work | **W1-L** (guards it) |
| **12** | Secrets stay out of chat and git — tokens, school passwords, `.env` | E19 | **met, one decision pending.** The notarization credentials are the live case: a local build keeps them in the build Mac's keychain; a CI build needs them as Actions secrets. §3 | **W1-I** |

**Every Must has a verdict, and every gap names a slice.** Two Musts (#5, #6) need
no work beyond keeping their checks in the audit. One (#10) is a fence rather than
a task. The rest resolve to the ten gaps above, of which nine are documentation.

---

## 2. Redesign only what fails the audit

The sequence lock's words are *"redesign only what fails audit (**or feels wrong
after harden**)"*. That parenthesis is Asher's, and it is deliberately subjective —
it is not a licence for a general redesign, and it is not restricted to a
regression either. So the bar for touching the interface in Wave 1 is one of
exactly three things:

1. **The audit failed there.** A Must is unmet and the fix is on screen — a
   control that has to be reachable, a state that has to be announced, a
   disclosure that has to be prevented.
2. **The harden broke it.** A fix landed and the screen is now worse: a
   confirmation an operator cannot complete, a gate that blocks the desk from
   checking someone in, wording that contradicts what the app does.
3. **It feels wrong after harden, and Asher says so.** Named as a lock, so it is
   a real route — but it is *his* call after the harden lands, not a licence any
   slice may claim for itself.

Anything else is wave 2. Specifically **not** reasons to redesign in Wave 1:

- a screen looking dated, dense or inconsistent with another screen;
- a metrics or present/missing view, however small — Must #10 fences it into
  wave 2, and a metrics idea arriving inside a harden PR is the specific failure
  this section exists to catch;
- the Tapin / SJC theme, which the lock puts in wave 2 beside the metrics;
- a component the repo has in `src/components/ui/` and does not use yet;
- "while we are in here" — the commonest way a harden wave stops being reviewable.

Two practical consequences. **Wording changes that make a document and a screen
agree are in scope**, because a screen that claims something the app does not do
is an audit failure and not a paint job; G1–G5, G8 and G9 will produce some. And
**a gap whose honest fix is a redesign gets written down and deferred, with the
gap left open**, rather than half-fixed with a hidden control. An open gap with a
named owner is a better Wave 1 outcome than a quiet one.

One more constraint from the lock, aimed at §6's concurrency: **do not run three
parallel rebuilds.** Docs slices may overlap. Two slices rewriting the same screen,
or a harden branch racing a Capacitor branch through the same files, may not.

---

## 3. Must #9 — Capacitor Mac sideload and a notarized DMG from GitHub Releases

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
  import, so it is unit-tested directly (`docs/desktop-macos.md:88`–`110`).
- `scripts/verify-mac-build.sh` checks identity, signature, entitlements, and that
  nothing Replit-related and no service worker got into the bundle.
- `hardenedRuntime: true`, `entitlements.mac.plist` already carries exactly what
  notarization requires, and `package:mac:signed` already exists
  (`docs/deferred-apple-developer.md:48`–`63`).

### The collision, stated exactly

**Capacitor has no first-party macOS target.** Its officially supported
application targets are Android, iOS and Web; there is no desktop platform and no
`cap add macos`. The maintained route to a Capacitor desktop app is a third-party
platform package — `@capawesome/capacitor-electron` (MIT, Capacitor 6+, Electron
28+, macOS/Windows/Linux), which presents itself as the modern replacement for the
no-longer-maintained `@capacitor-community/electron`. Neither is installed here:
`package.json` carries `@capacitor/android` and `@capacitor/ios` only.

So Must #9's "Capacitor Mac shell" does not mean adding a platform Capacitor
ships. It means **replacing the repo's hand-written Electron shell with a
platform-owned one**, and that has four consequences worth a decision rather than
a merge:

| # | Consequence | Why it is not a detail |
|---|---|---|
| C1 | **The renderer origin changes.** The platform serves the app from its own scheme; `app://attendance` is this repo's own registration in `electron/main.ts` | IndexedDB is scoped to the origin. Three documents and one config comment say this string must never change — `README.md:64`–`70`, `docs/data-and-backup.md:101`, `docs/deferred-apple-developer.md:87`–`98`, `capacitor.config.ts:20`. Changing it leaves every installed Mac's roster and term of attendance **on disk and invisible to the app**. The platform's exact scheme string is **unverified** — not stated in the documentation reviewed for this plan — and it is the one fact that has to be established before C1 can be costed |
| C2 | **The export changes route, and gets weaker.** `deliverWorkbook` picks the desktop bridge first and only then Capacitor (`src/lib/workbook-delivery.ts`). Under a Capacitor platform the bridge is absent and `Capacitor.isNativePlatform()` is true, so the Mac would take the **`file`** route — write to Documents, offer a share sheet — instead of **`saved`** | The `saved` route is the only one that lets the operator choose the destination and the only one that can name the path it wrote. `docs/data-and-backup.md:126` promises exactly that for macOS, and `ExportNotice` wording and its tests assert it. Restoring it means writing a custom main-process plugin — app code, and a re-derivation of the validation surface `electron/validation.ts` already covers |
| C3 | **The hardened main process becomes platform-owned.** The platform advertises a sandboxed renderer, context isolation, a strict CSP and validated IPC **enabled by default and not configurable**, extended through typed options and hooks rather than by owning runtime code | Better than most defaults, and broadly the same posture. But it is *a different* posture, asserted by a third party, replacing one this repo verified by inspecting its own live app. In a wave whose subject is a privacy harden, that swap needs to be evidenced, not assumed |
| C4 | **`server.url` enters the toolchain, and so does an updater.** The platform's live-reload development mode is driven by `server.url` in `capacitor.config.ts`, with a documented dev-only CSP relaxation. The platform also ships Live Updates | `docs/vscode-setup.md:182` says `capacitor.config.ts` **must never gain a `server.url`**, and `capacitor.config.ts:16`–`20` explains why; dev-only is not an exemption the rule currently grants. Live Updates is worse: an updater is the one thing that would make this app touch the network, which breaches Must #11 and the privacy claim at `docs/data-protection.md:86` together. "No Live Update plugin, ever" becomes an acceptance criterion with a grep behind it |

None of this makes Must #9 wrong. It makes its *cost* concrete, and the locks
already anticipate the shape: a true native rewrite is a wave-1 non-goal **"only
if Capacitor hits a hard wall."** C1 is a candidate hard wall, and it points the
opposite way from the usual one — the risk is not that Capacitor cannot do the
job, it is that migrating *to* it orphans data on Macs already running the app.

### Decision gate D1 — which Mac shell Wave 1 ships

Owner: CPM, with Asher on the data question. Resolved by slice **W1-H**; it blocks
the distribution slices after it and **nothing** in the harden half, which
proceeds in parallel.

| Option | What it costs | What it risks |
|---|---|---|
| **D1-a — Keep the Electron shell; deliver Must #9's outcome** (notarized DMG, sideloaded from a Release) and align the packaging docs | Smallest. Nothing in `src/` changes; `electron-builder.yml` gains a Developer ID identity and `notarize: true`, which `docs/desktop-macos.md:266`–`332` already documents step by step | Diverges from the letter of "Capacitor Mac shell". Leaves two desktop stories long-term — Capacitor for Android/iOS, bespoke Electron for Mac — which is a wave-2+ maintenance argument, not a Wave 1 risk |
| **D1-b — Adopt `@capawesome/capacitor-electron`, preserving the origin** | Establish the platform's scheme, then pin the app's origin to `app://attendance` through the platform's typed options **if it can be pinned**. Re-implement the save bridge as a main-process plugin. Re-verify C3's posture. Resolve C4 both ways | If the origin cannot be pinned, every Mac already running the app loses its roster unless a migration is built and tested — and there is no import path for attendance history, only for the roster (`src/lib/roster-workbook.ts`). This is the hard wall |
| **D1-c — Adopt the platform on a clean install only**, with a documented export-then-reinstall migration | Middle. Honest, and the export-first procedure already exists (`docs/data-and-backup.md:145`) | Costs every current Mac install its on-device history, which the dashboard's year-to-date figures are computed from. Acceptable only if no Mac is yet carrying records that matter |

**Recommendation: D1-a for Wave 1**, with the Capacitor desktop platform evaluated
as a wave-2 spike whose entry criterion is a verified answer to C1. The reasoning
is that Must #9's own done-when is *a notarized Mac DMG installable from GitHub
Releases* — an outcome about distribution, which D1-a reaches without touching a
line of `src/`, without re-deriving a security posture mid-harden, and without
putting an installed roster at risk. Wave 1 is the wrong wave to re-platform the
shell that holds the records, and under Must #1 the workbook is the SoR anyway,
which is what makes D1-a's smaller blast radius affordable.

This is a recommendation, not a decision. If Must #9 is read strictly and D1-b is
chosen, C1 becomes the first ticket and its acceptance is a verified scheme string
plus a device-tested upgrade that keeps an existing roster.

### Notarization: the blocker is procurement, not engineering

`docs/deferred-apple-developer.md` is unusually clear that **the work is done and
only the account is missing** — entitlements, hardened runtime, the signed script,
and the signing/notarizing/stapling procedure in `docs/desktop-macos.md:266`–`354`.
The checklist agrees, marking the notarization account `[UNVERIFIED]` and assigning
it to Ops/CPM after sign (O8).

What Wave 1 must acquire:

- **An Apple Developer Program membership, $99/year, in the school's name** — not
  a personal Apple ID, so the certificate outlives whoever set it up
  (`docs/deferred-apple-developer.md:41`).
- **A Developer ID Application certificate** in the build Mac's login keychain,
  confirmed with `security find-identity -v -p codesigning`.
- **An app-specific password** for the notarization round trip.
- **A custody note**: which Mac holds the certificate, who may use it, what
  happens when that person leaves. `docs/deferred-apple-developer.md:46` already
  says one Mac holds it; Wave 1 should name it.

And one Must #12 consequence to settle before any CI work: signing material never
enters the repository (`docs/vscode-setup.md:186`). A GitHub Actions secret is not
the repository — but exporting the certificate as a base64 `.p12` into Actions
secrets moves it off the single build Mac, which is the arrangement
`docs/deferred-apple-developer.md:46` describes. That is a decision, and the
build-host subsection below is where it lands.

### Where to build: an 8 GB M2 against a 7 GB CI runner

The Mac build machine is an **8 GB M2**. The instinct is to move the build to CI.
The numbers do not support that as a memory argument:

| | 8 GB M2 (local) | `macos-latest` (GitHub-hosted) |
|---|---|---|
| CPU / RAM | M2, 8 GB | 3-core M1, **7 GB**, 14 GB SSD |
| Cost | none | private repos bill macOS at **10× the included-minute multiplier**, $0.062/runner-minute. A 15-minute notarizing job spends **150** included minutes |
| Certificate | stays in one Mac's keychain, as documented | must be exported into Actions secrets — see Must #12 above |
| Electron runtime | ~100 MB, downloaded once, then cached (`docs/desktop-macos.md:147`) | downloaded every cold run |

So CI is not more memory; it is less. Its real advantages are that it does not tie
up the operator's Mac and that the build is reproducible — both genuine, both
wave-2 concerns rather than Wave 1 blockers.

**Staged build guidance for Wave 1:**

- **Build single-architecture on the M2.** `package:mac` targets the building
  Mac's own architecture and is the documented fast path
  (`docs/desktop-macos.md:160`). On 8 GB that is comfortable.
- **Avoid `package:mac:universal` and `package:mac:both` locally.** Universal
  builds two full Electron runtimes and merges them; `:both` runs the build twice.
  These are the runs that will swap an 8 GB machine. The repo already documents
  the same class of failure for Android — *"Gradle build daemon disappeared
  unexpectedly | Out of memory"* (`docs/vscode-setup.md:166`) — and the same
  discipline applies: one build at a time, nothing else open.
- **Only build for Intel if an Intel Mac actually exists.** `docs/desktop-macos.md:169`
  makes this conditional already. Do not pay for universal by default.
- **Keep `verify` on `ubuntu-latest`.** Typecheck and unit tests have no reason to
  be on a macOS runner, and moving them there would spend the 10× multiplier on
  every push to a protected branch that requires the check.
- **If a macOS job is added later**, scope it to release tags only — never to
  `pull_request` — and treat the included-minute arithmetic above as the budget.

### GitHub Releases as the distribution path

Nothing in the repo mentions GitHub Releases today; `docs/desktop-macos.md:356`–`364`
says direct download from the school's website, Drive or SharePoint. Must #9 makes
Releases the path and sideload the model. Two traps:

- **`publish: null` must stay** (`electron-builder.yml:37`). Uploading a `.dmg` to
  a Release is a publishing step; wiring electron-builder's `publish` config or
  adding `electron-updater` turns the app into one that checks a feed at runtime,
  which breaches **Must #11** and the privacy claim at `docs/data-protection.md:86`
  at the same time. Attaching an asset to a Release and enabling an auto-updater
  are different things, and Wave 1 wants exactly the first. Acceptance criterion
  with a grep behind it, not a note.
- **A private repository's Release assets need authentication to download.**
  `Thirdline-LLC/NFC-Attendance-Scanner` is private (verified in `state/tap-in.md`).
  A club operator on a school Mac cannot click a Release link and get a file. Wave
  1 has to decide: the operator downloads while signed in to an account with repo
  access; or the human-facing hand-off stays Drive/SharePoint with the Release as
  the archive of record and the SHA-256 source of truth; or a separate public
  distribution repo is created, with its own custody question. **Whichever is
  chosen, the DMG must be notarized and stapled**, because stapling is what lets
  Gatekeeper verify a file that arrived on a USB stick with no network
  (`docs/desktop-macos.md:334`).

Also worth stating in the release notes when the time comes: a notarized build
**ends** the `xattr -dr com.apple.quarantine` instruction
(`docs/desktop-macos.md:202`). That instruction is the thing Wave 1 buys its way
out of — `docs/deferred-apple-developer.md:34` is explicit that its real cost is
teaching staff to click past a security warning.

---

## 4. Multi-device, as practical

Musts #1, #2 and #11 together: **the school OneDrive workbook is the system of
record and holds the live roster and attendance truth; each device's database is a
cache; there is no peer-device sync and no private student-data backend.** That
closes a question open since `…ferpa-safe-kiosk-design.md:52`.

One constraint from `state/tap-in.md` bounds any future helper on the SoR side:
**the workbook is pure Excel — no macros, no VBA, no Office Scripts, no Power
Automate** — so it can be handed to others at school without IT vetting beyond the
code. Anything Wave 1 or later proposes for moving data between the workbook and a
device is a human action or app code, never an Office automation.

### PR #2 is what makes this implementable

Before PR #2 the app only ever wrote workbooks. It now reads one back, and the
round trip has exactly the properties a cache-and-SoR model needs:

| Property | Where | Why it matters here |
|---|---|---|
| Export the roster to get the headers right, even on an empty device | `src/lib/roster-workbook.ts:124`; `docs/operating-the-kiosk.md:52` | The SoR workbook's schema is the app's own, so there is no format to agree |
| Import is idempotent — added / updated / unchanged / refused | `src/lib/roster-workbook.ts:208`; `docs/operating-the-kiosk.md:58` | Re-importing the SoR onto a second device converges instead of duplicating |
| Import **never removes** anybody | `docs/operating-the-kiosk.md:69` | A partial or stale workbook cannot silently delete a student from a device |
| Import **never touches a card** — the card column is masked, so it is read and ignored | `src/lib/roster-workbook.ts:29`, `:252` | Card bindings are per-device hardware facts. A workbook cannot rebind them, which is why two devices can share a roster without fighting over cards |
| One address identifies one student, within a file and on the device | `src/lib/roster-workbook.ts:299`; `src/ui/EmailConflictDialog.tsx` | Must #5's join key, enforced in both directions |

The card-column property is the quiet load-bearing one. **Roster identity travels;
card bindings do not.** A second device that imports the same workbook knows the
same students and has bound none of their cards, and each card binds at whichever
kiosk the student taps (E14). That is why "no peer sync" is a design position
rather than a limitation: there is nothing to reconcile.

### The practical model Wave 1 writes down

- **Attendance does not merge in the app, and Wave 1 does not pretend otherwise.**
  Taps are recorded on a device and travel upward as an export. Two devices at one
  meeting produce two exports, and **the workbook is where they are combined** —
  by a person, deliberately, under Must #1. The app builds no merge and no
  conflict resolution.
- **One device per meeting is the operating rule.** Multi-device is for a second
  kiosk at a different meeting, or a replacement device — not two lanes at one
  door. A second lane needs a merge the app will not have in Wave 1.
- **The device is a cache, and the cache is allowed to be lost.** This is already
  how the docs behave (export before anything; `docs/data-and-backup.md:145`), but
  the *reason* changes: the workbook upstream is authoritative, so re-provisioning
  a device is an import, not a re-enrollment. `docs/data-and-backup.md:154`–`173`
  currently says the opposite, which is G1.
- **The dashboard's figures are per-device and must say so.** Cache-scoped numbers
  presented as the club's numbers is the misreading this model invites — and it is
  the same misreading Must #10's present/missing view would inherit in wave 2 if
  Wave 1 does not settle it now.
- **The SoR's access control is not the app's.** O4 is open: whether the OneDrive
  folder's ACLs already limit the workbook to operators. Under Must #1 that ACL is
  the primary control over the live truth, and no PIN in the app substitutes for
  it.

### The documentation change this forces

Five sentences across four documents name the app's own export as the system of
record: `README.md:9`, `docs/data-and-backup.md:4`, `docs/capacitor-native.md:13`
and `:355`, `docs/data-protection.md:134` — and `docs/data-protection.md:182`
makes the retention schedule rest on it ("The exported workbooks are the retained
record"). Under Must #1 the workbook in OneDrive holds the roster and the
attendance truth, and the app's export is **the feed into it**, which is a
different claim and a different retention story.

That needs saying once, precisely, in `docs/data-and-backup.md`, with the others
pointing at it. Inventing a second account of it in this plan would be the
parallel-bible mistake *What this reuses* warns about, so it is slice **W1-G** and
it edits the existing documents.

---

## 5. Explicitly out of Wave 1

The locks' non-goals, recorded so they are not re-litigated per PR. Each is a
legitimate thing to want and a wrong thing to do now.

| Out | Note |
|---|---|
| **IT or outside counsel sign-off before pilot** | A **process lock**: no IT/counsel gate is required before pilot. The checklist is explicit that this is a process choice and not a legal finding, and that legal sufficiency is `[UNVERIFIED]` (O9, O10). Nothing in Wave 1 may present it as clearance |
| **Metrics, present/missing views, and the Tapin / SJC theme** | Wave 2 by lock. Must #10 fences the eventual shape (roster − taps, no late/duration); §2 is the boundary for Wave 1 PRs |
| **Late or duration tracking** | Named out by Must #10 even when metrics arrive |
| **Peer-device sync, or a private attendance backend / student-data SaaS** | Musts #2 and #11. §4 is the model: workbook upstream, no device-to-device anything. No server, no LAN discovery, no shared database |
| **A true native rewrite** | Only if Capacitor hits a hard wall. C1 in §3 is the candidate, and it is a *migration* wall rather than a capability one. Nothing is rewritten on a hunch |
| **Renaming the GitHub repo** | Separate assign (O11). The product is Tapin; `Thirdline-LLC/NFC-Attendance-Scanner` stays. Note this does **not** license renaming anything the OS keys data to — `org.stjohnschs.attendance`, `app://attendance` and the `SJC Attendance` data directory are frozen identity (`README.md:67`). A product-name change must not reach them; that is the one place a rename would cost records |
| **Replit as the distribution path for the Mac DMG** | Named out by the locks, and consistent with what exists: Replit's production service for this app is `serve = "static"` over the web build (`artifacts/nfc-attendance-scanner/.replit-artifact/artifact.toml`) — a PWA host with no release-asset story |
| **MDM** | "No MDM required for v1" (Must #9). The blocked-MDM matrix at `docs/desktop-macos.md:366`–`380` stays recorded for later and is not Wave 1 work |
| **An age gate** | The checklist says COPPA applicability is `[UNVERIFIED]`, to be **marked only**, and explicitly *do not invent an age gate here*. Wave 1 proposes none |
| **iOS / TestFlight** | The `ios/` project is committed and explicitly not a current target (`README.md:86`). Wave 1 changes nothing there. The PWA stays available as a possible Chromebook fallback later (Must #9), which is not Wave 1 work either |
| **Android release signing** | Deferred separately (`docs/deferred-apple-developer.md:83`). The debug APK is the Android story until someone asks |
| **A withdrawal operation** (retain history, remove identity) | Designed-not-built, recorded at `docs/data-protection.md:230`. Only in scope if a Must names it; none does |

---

## 6. Slices CPM opens next

Small, separately draftable, in dependency order. Harden first; distribution
second. Every slice is a draft PR against `main`, which is protected and requires
`verify`.

**Phase 1 — harden (no Apple account needed, nothing blocked on D1)**

| Slice | Scope | Acceptance hints |
|---|---|---|
| **W1-A** | Write the bot rules into the repo (**Must #3**, G10) and truth-up the roster round trip in `docs/data-and-backup.md` (G1, G4, G5) | `CLAUDE.md` and `docs/vscode-setup.md`'s rule list state that agents work on code and docs only and never open the workbook, a roster export or a live tap log. `rg -in "no roster import\|none is planned"` over `docs/` returns nothing. *Replacing a device* names the import as step 4. The `persons` row admits a student can have no card. The `activity` row names all nine kinds. Docs-only diff |
| **W1-B** | Deflake `src/roster/RosterPage.import.test.tsx` — the double-import case (§0 names the mechanism) | 10 consecutive `pnpm --filter @workspace/nfc-attendance-scanner test` runs green. The fix synchronises on the second import completing, rather than raising the timeout or adding a retry flag. Touches no file outside `*.test.tsx` |
| **W1-C** | Get the checklist **signed** and filed (O12), and keep the Must #1–12 map current as slices land | The sheet's *Date* and *Signature / initials* lines are filled, and the signed copy is filed where CoS directs as a photo or scanned PDF path — **never a roster pasted into chat**. Wave 1's done-when names this literally. No repo diff beyond updating this plan's map |
| **W1-D** | **Must #4** (G7): one example-UID convention, followed and labelled fake | One documented convention covering every example UID in the repo — either migrate examples into the declared range or widen the declared pattern, but not both stories. Every example is labelled fake where a reader could mistake it for real, `docs/capacitor-native.md:536`–`540` included, since that passage prints invented names beside UIDs. `docs/vscode-setup.md:184`–`185` matches practice afterwards. Fixtures and docs only — no product behaviour changes |
| **W1-E** | **Must #7** (G8) and G2/G3: the school-facing document covers both workbooks and agrees with Must #7's vocabulary | `docs/data-protection.md` describes the roster export's contents and that it covers students who have never tapped; describes the import, that it ignores the card column, and that it can add a class in one action; *What is stored* admits the cardless state. The two roles are named so "club operator or teacher" and "the desk" plainly describe the same gate. No card UID in any example |
| **W1-F** | G6: decide and document what retention does about an imported student who never taps | Either a store-level action with a preview and an activity row, following the `previewAlumniRemoval` shape (`src/data/attendance-store.ts`), or a written decision that the Students page is the answer — with the reason. Not both, not silent |
| **W1-G** | **Musts #1 and #2** (G9): the SoR sentence and the multi-device procedure (§4) | `docs/data-and-backup.md` states that the school workbook holds the roster and attendance truth and that the device DB is a cache; names the one-device-per-meeting rule; says the dashboard figures are per device; and re-grounds the retention schedule now that `:182`'s premise has moved. The other four SoR sentences point at it rather than restating it. Records the pure-Excel constraint on the workbook side. Docs-only |

**Phase 2 — Capacitor Mac sideload and the DMG (gated on D1, then on procurement)**

| Slice | Scope | Acceptance hints |
|---|---|---|
| **W1-H** | Resolve **D1**. A short decision record; on D1-b/c, establish the platform's scheme string first | The record names the option, the reason, and what it costs an installed Mac. If D1-b: the scheme is verified by running it, and C1 is answered before any dependency is added. Docs-only |
| **W1-I** | **O8 / Must #12**: Apple Developer membership, Developer ID certificate, app-specific password, custody note, and the local-vs-CI credential decision | `security find-identity -v -p codesigning` on the build Mac shows a *Developer ID Application* identity. The custody note names the machine and the owner. No credential in a commit, a log or this repo. Ops slice; may carry no diff beyond the custody note |
| **W1-J** | Notarized DMG, built on the M2, following the existing procedure — plus the **Must #8** device check | `verify:mac` passes. `spctl --assess --type execute` reports `accepted / source=Notarized Developer ID`. `xcrun stapler validate` passes on the `.dmg`. Installs by double-click on a Mac that has **never** seen the app, with no `xattr` step. `identity: "-"` removed from `electron-builder.yml` per `docs/desktop-macos.md:316`. Single-architecture unless an Intel Mac exists. The ACR1552U-MF is tested against the build, and the Bluetooth ACR1555U's macOS behaviour is recorded either way (O7) |
| **W1-K** | Align the packaging docs with what shipped — edit in place, add no parallel guide | `docs/desktop-macos.md` §§1/3/9/12 and `docs/deferred-apple-developer.md` describe the shipped route; the release checklist's Developer ID lines move from conditional to required; `README.md:40` no longer tells a recipient to clear quarantine; the MDM matrix is marked out-of-scope-for-v1 rather than blocked. `docs/capacitor-native.md` gains a scope note if D1 changed the Mac shell |
| **W1-L** | Publish the DMG to a GitHub Release, and document the download for a non-technical operator | A tagged release carries the notarized `.dmg` and its SHA-256. `electron-builder.yml:37` still reads `publish: null`. `rg -i "electron-updater\|autoUpdater\|live.?update"` returns nothing — the **Must #11** guard. No Apple credential appears in any workflow log. The private-repo download decision from §3 is written down, not assumed. **The only slice that may touch workflow YAML** |

## Post-build audit gate

**Mandatory after** harden + Mac DMG installable from GitHub Releases, and **before** calling Wave 1 done. Do **not** run these audits in this PR — they are planned here and executed later as slices **W1-M**–**W1-Q**.

File each result in repo `docs/` (preferred under `docs/audits/wave1/`) and/or a command `handoffs/` path. **No student PII** — no names, school emails, roster rows, or card UIDs (synthetic / masked examples only if an example is unavoidable).

| # | Audit | What it covers | Owner |
|---|---|---|---|
| 1 | **Security** | Shipped Mac shell posture, secrets hygiene, no runtime updater / Live Update, no UID leakage in logs | **CPM** |
| 2 | **FERPA + COPPA** | Re-check Must #1–12 against the release tag; controls evidence only — legal sufficiency stays `[UNVERIFIED]` unless Asher asks for more | **CPM** (execution); **Scout** optional for statute cites **only if Asher asks**; **CoS** routes |
| 3 | **SEO** | Public web/PWA surfaces only. If Wave 1 ships sideload-only Mac DMG with no public host, record **N/A** with that rationale — answered, not skipped | **CPM** |
| 4 | **UI** | Visual/copy gate on the shipped build (harden wording, PIN gates, roster import/bind flows) | **Reviewer** |
| 5 | **Overall app health** | Build/`verify`, offline, NFC keyboard-wedge, roster import/bind, cache-vs-SoR behaviour | **CPM** |

**CoS** routes the gate and collects the filed records. A miss may be **waived only with an Asher note** naming which audit and why; otherwise Wave 1 stays open.

Phase 3 below is the executable slice list for this gate.

**Phase 3 — the post-build audits Asher added 2026-09-22**

Executable form of the [Post-build audit gate](#post-build-audit-gate). Mandatory before Wave 1 is done. Five audits, each a separate pass with its own record (no student PII):

| Slice | Audit | Owner | Acceptance hints |
|---|---|---|---|
| **W1-M** | **Security** | **CPM** | The shipped Mac shell's posture is re-verified against `docs/desktop-macos.md:61`–`86` on the build that actually ships, not on a previous one. If D1-b/c was chosen, C3 is evidenced rather than asserted |
| **W1-N** | **FERPA + COPPA** | **CPM** (Scout optional if Asher asks; CoS routes) | Every Must #1–12 row in §1 re-checked against `main` at the release tag, with the `.agents/memory/` grep (Must #6) and the example-UID inventory (Must #4) re-run. Legal sufficiency still `[UNVERIFIED]`; the audit records controls, not clearance |
| **W1-O** | **SEO — or N/A with a reason** | **CPM** | Most likely N/A: the shipped artefact is a sideloaded DMG with no public surface, and PWA hosting is still TBD in `state/tap-in.md`. If N/A, say so in one line and say why, so the audit is answered rather than skipped. `seo_strategy.md` at the repo root is where that lands |
| **W1-P** | **UI** | **Reviewer** | The harden slices' wording and gates walked end to end on the shipped build, against `docs/operating-the-kiosk.md`. This is also where §2's third bar — "feels wrong after harden" — is actually exercised, with Asher |
| **W1-Q** | **App health** | **CPM** | `verify` green on the release tag, and the flake from §0 gone: 10 consecutive full runs. Storage persistence, the export's three routes, NFC keyboard-wedge, roster import/bind, cache-vs-SoR, and a cold start on a Mac that has never run the app |

Ordering notes for CPM:

- **W1-A, W1-B, W1-D, W1-E and W1-G are docs or fixtures only and can run
  concurrently** — but W1-A, W1-E and W1-G all edit privacy or backup
  documentation, so sequence those three or expect a conflict. **Do not run three
  parallel rebuilds**: overlapping docs slices are fine, overlapping rewrites of
  the same screen are not.
- **W1-C is the gate on "done", not on the work.** The harden slices can proceed
  on the chat approval; Wave 1 cannot be *called* done without the signature.
- **W1-I is procurement and has no engineering predecessor.** Start it the day D1
  lands; the $99 and the certificate are wall-clock, not work.
- **W1-L is last of phase 2 on purpose.** It is the one slice with a CI surface,
  and it should describe a release that already happened by hand.
- **Phase 3 runs on the release tag**, after W1-L, and W1-N re-runs §1 rather than
  trusting it.

---

## 7. Done-when

Wave 1's locked done-when is **checklist signed + Capacitor Mac DMG installable
from GitHub Releases**, and `state/tap-in.md` adds the post-build audits as
mandatory before that is called. So, three conditions:

1. **The FERPA/COPPA checklist is signed, filed, and true of this repo.** Every
   Must #1–12 has a verdict in §1's map; every gap is closed with a test or a docs
   change, or recorded as an ops item with a named owner; the privacy documents
   describe the app that actually shipped, roster import and roster export
   included; Must #1's SoR sentence is what the docs say; and the sheet's
   signature block is filled and the signed copy filed where CoS directs.
2. **A notarized Tapin Mac DMG installs from a GitHub Release.** A club operator
   gets it from the Release, double-clicks, and the app opens — no Terminal, no
   `xattr`, no System Settings detour. `spctl --assess` reports
   `source=Notarized Developer ID`, the ticket is stapled so it verifies with no
   network, and the app still makes no runtime network call and carries no updater.
3. **All five post-build audits have run** — security, FERPA+COPPA, SEO (or a
   recorded N/A), UI, app health — on the build that shipped, each with a filed
   record under the [Post-build audit gate](#post-build-audit-gate), **or** waived
   with an Asher note naming the audit and why.

What is **not** part of done-when, so nobody holds Wave 1 open for it: the school's
answers to O1–O3 and O4; a counsel packet (O10) or a COPPA determination (O9),
both of which stay marked; the repo rename (O11); and everything in §5. Those are
tracked where they already are.

---

## Appendix — evidence index

Everything cited above, in one place, for a reviewer checking the plan against the
repo rather than against itself.

| Claim | Where |
|---|---|
| Implemented FERPA control set and its own open list | `docs/superpowers/specs/2026-09-08-ferpa-safe-kiosk-design.md` |
| PIN module, lockout, reader-burst defence | `src/data/operator-pin.ts`, `src/lock/pin-entry.ts`, `src/lock/PinDialog.tsx` |
| Route gate and in-memory unlock | `src/lock/LockedRoute.tsx`, `src/lock/OperatorLockProvider.tsx`, `src/app/AppRouter.tsx` |
| Activity kinds, entry shape, cap | `src/data/attendance-store.ts:48`–`86`, `:789` |
| Activity wording, one place | `src/lib/activity-wording.ts` |
| Masked card tail everywhere | `src/lib/scan-format.ts`, `src/lib/roster-workbook.ts:112` |
| Identity fields, and the four exclusions Must #5 names | `docs/data-protection.md:32`, `:41` |
| Email as the derived join key; one address, one student | `src/lib/student-email.ts`, `src/ui/EmailConflictDialog.tsx`, `src/lib/roster-workbook.ts:299` |
| Card binds to the email row at the kiosk | `src/ui/CardBindDialog.tsx`, `src/data/roster-binding.test.ts`, `docs/operating-the-kiosk.md:75`–`90` |
| Roster round trip — export, parse, ignore cards, refuse non-school addresses | `src/lib/roster-workbook.ts` |
| The three export routes and what each may promise | `src/lib/workbook-delivery.ts`, `docs/data-and-backup.md:118`–`134` |
| Desktop bridge contract, two verbs | `src/platform/desktop-bridge.ts`, `electron/validation.ts` |
| Build targets and the architectural rules | `docs/vscode-setup.md:107`, `:172`–`189` |
| Mac shell, origin, security, signing, notarization, stapling | `docs/desktop-macos.md` |
| What is already in place for Developer ID | `docs/deferred-apple-developer.md:48`–`63` |
| Frozen identity strings | `README.md:60`–`70`, `capacitor.config.ts:16`–`20` |
| Ad-hoc signature, no feed, hardened runtime | `electron-builder.yml:37`, `:62`–`74` |
| Per-platform storage and the export promise table | `docs/data-and-backup.md:53`–`134` |
| The "no import" statements this plan contradicts | `docs/data-and-backup.md:160`–`162`, `:170`–`171` |
| Operator-facing roster and card-binding procedure | `docs/operating-the-kiosk.md:46`–`90` |
| The repo's own legal disclaimer, which Wave 1 does not upgrade | `docs/data-protection.md:5` |
| Replit serves the PWA, not a DMG | `artifacts/nfc-attendance-scanner/.replit-artifact/artifact.toml` |
| CI job as it stands | `.github/workflows/verify.yml` |

Two checks run for this plan that are worth re-running in W1-N, with their
commands:

```bash
# Must #6 — no minors PII in bot memory. Expect no matches.
rg -c '@stjohnschs|[0-9A-Fa-f]{14}' .agents/memory/

# Must #4 — every example UID in the repo, so the inventory can be compared
# against the declared convention. 25 distinct values on dbce294; two in range.
rg -o -g '!node_modules' -g '!**/android/**' -g '!**/ios/**' -g '!pnpm-lock.yaml' \
  '\b[0-9A-Fa-f]{14}\b' -r '$0' . | sed 's/.*://' | tr 'a-f' 'A-F' | sort -u
```

Two external facts this plan leans on, recorded with their sources because they
are the kind that change:

- **Capacitor's officially supported targets are Android, iOS and Web** — there is
  no macOS platform. Desktop is served by a third-party platform package
  (`@capawesome/capacitor-electron`, MIT, Capacitor 6+/Electron 28+, presented as
  the replacement for the unmaintained `@capacitor-community/electron`). Checked
  2026-09-22 against capacitorjs.com and capawesome.io. The scheme it serves the
  renderer from is **not** established here and is C1's blocking fact.
- **GitHub-hosted `macos-latest` is a 3-core M1 with 7 GB RAM**, billed on private
  repositories at $0.062/runner-minute and consuming included minutes at a **10×
  multiplier**. Checked 2026-09-22 against GitHub's runner and billing
  documentation.
