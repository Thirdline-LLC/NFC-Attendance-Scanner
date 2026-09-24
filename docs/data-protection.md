# What this app does with student data

Written for whoever has to answer that question at St. John's. It describes the
software factually. It is not legal advice, and it does not claim compliance
with FERPA, COPPA or any other regime — that judgement belongs to the school.

## Which laws were checked, and what they said

Checked on 2026-09-08, each at its source, so the school can verify the
reasoning rather than take it on trust. **None of the three binds this app.**

| Regime | Applies? | Why |
|---|---|---|
| COPPA — 16 CFR 312, amended 2025, compliance due 2026-04-22 | No | It covers *commercial* online services that collect personal information from children **under 13**. St. John's is grades 9–12. The FTC's own FAQ (F.5) says an app that only interacts with information stored on the device and never transmitted is not "collecting" — and this app has no server and never transmits student or attendance information. (Plan 07 added an optional, PIN-gated check against GitHub Releases for app/theme updates; it exchanges version numbers and binary files only — see "What leaves the device" below.) |
| FERPA — 34 CFR 99 | Probably not directly; the school should confirm | It binds institutions that receive funds under programs the U.S. Department of Education administers. Private K-12 schools generally do not, and receiving Title I equitable services through DCPS does not count. Most private schools adopt FERPA as policy regardless. |
| DC Protecting Students Digital Privacy Act — D.C. Code § 38-831.01 ff | No | Its "educational institution" is a DC public school or public charter. |

The app is built to a FERPA-style bar anyway: attendance tied to a named
student is treated as an education record, shown only to the teacher, kept no
longer than the school year, and open to inspection and correction. The two
duties the amended COPPA rule added — a written retention policy with no
indefinite retention, and a stated security posture — are met below because
they were the two things this app could not previously answer for.

## What is stored, and where

Three kinds of record, all in the browser's IndexedDB on the device running the
kiosk, in a database named `attendance-scanner-local`:

| Record | Fields |
|---|---|
| Student | first name, last name, graduation year, school email address, enrolment timestamp, and **optionally** a card UID (a student may have **no card yet** — common after a roster import) |
| Tap | card UID, timestamp, which student (if known), which session, whether it counted |
| Activity | timestamp; what happened (an export, an import, a removal, a purge, a PIN change); counts, a filename and how it was delivered — **never a name, an email or a UID** |

Plus two device settings: the per-session attendance target, and the teacher
PIN as a salted PBKDF2 hash with its lockout counter. The PIN itself is never
stored.

Nothing else about a student is collected. There is no date of birth, no
address, no photograph, no guardian information, no free-text notes, and no
identifier issued by anyone but the school.

## Two roles at the device

Day-to-day operators are **club operators or a teacher** (school staff / club
leads) — not bots, and not a coding agent. The software gate matches that with
two roles:

**The desk** (open without the PIN) is whoever is running the kiosk for a
meeting — often a student club lead acting as a club operator. The desk can:

- **Check in.** A card is tapped; the screen shows the count and the student's
  first name and last initial with the time.
- **Enroll.** A new card is tapped, the operator types the student's name and
  year, and the school email derives itself. Tapping an *already enrolled*
  card in Enroll mode opens the form pre-filled so a typo can be corrected.
  That stays open to the desk on purpose: **the physical card is the
  credential** — its holder is present, which is FERPA's own "eligible
  student" case.

Everything else asks for the **teacher / club-operator PIN** (the same gate;
the UI still says "teacher PIN"):

- **End Session** — the totals, *Export this session*, *Start New Session*.
- **The Students page** — every name, email and class year on the device;
  editing; removing; **roster import** and **roster export**.
- **The Dashboard** — the year's figures *for this device*, *Export all
  history*, the activity log, the two retention actions, changing the PIN,
  switching or creating the attendance body this device is attached to,
  installing or switching a theme pack, and checking for app/theme updates.

The PIN is 4 to 8 digits, stored only as a salted hash, and locked for
30 seconds after five wrong attempts, doubling to five minutes. Two things
have to be said plainly about it:

- It is **a screen gate against whoever is at the desk, not encryption**.
  IndexedDB stays readable to anyone with the device's own account and a
  developer console.
- **There is no recovery.** A forgotten PIN means clearing the app's data,
  which loses everything not yet exported — one more reason the
  export-every-session rule matters.

Set the PIN when the app is installed, before the device is handed to anyone.
Until one exists the scanner shows a banner saying the records are open,
because whoever sets the PIN first owns the device's records and nothing in
software can tell a teacher from a student on day one.

A teacher's (or club operator's) unlock lasts one visit: it ends on the way
back to the scanner, when the End Session overlay closes, after five minutes
without a key or a tap, and on reload.

## What leaves the device

**No student or attendance data, ever.** The app has no server, no account
system, and no analytics. Nothing in the roster, session or tap-history code
paths initiates a network request: no `fetch`, no `XMLHttpRequest`, no
`WebSocket`, no `sendBeacon` and no HTTP client touches student data anywhere
in the source. Fonts are bundled rather than fetched. On boot, and until a
teacher chooses otherwise, the app makes zero network requests.

**One deliberate exception (Plan 07): the update checker.** The Dashboard's
"Check for updates" card — reachable only through the PIN-gated `/dashboard`
route — reads **GitHub Releases** for this app: the current release's tag,
its asset list (installer and theme-pack filenames, sizes, and their
`.sha256` checksums), and the release page URL. That is the entire request:
no student, roster, session, tap or PIN data is in it, and `lib/update`'s own
tests assert as much on every request this code path can send (see
`lib/update/__tests__/no-student-data.test.ts`). Downloading and verifying an
asset's bytes (rather than just its metadata) happens only in the Electron
desktop build's main process — not in the page the operator sees — because
GitHub's release-asset CDN does not send CORS headers, so a browser-side
`fetch` of the bytes is not possible at all; see
`docs/update-token-ops.md` for exactly what that process sends. A verified
theme pack is handed to Plan 04's existing loader unchanged. On the packaged
macOS app, a verified disk image replaces the installed `.app` and the app
relaunches — only after the teacher presses Check for updates and Install
and relaunch. That swap does not read or upload the student database. The
bytes downloaded are the public Release asset and its `.sha256` file.

One precision, because the stronger claim would be false: the shipped bundle
does *contain* a `fetch` call, in `@capacitor/core`'s HTTP plugin, which the
native build pulls in for the file and share plugins. Nothing in this app
calls it. The honest statement is that no code path touching student data
reaches the network, not that the bundle is incapable of a network request.

Both are verifiable — from `artifacts/nfc-attendance-scanner`:

```bash
grep -rnE '\bfetch\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource|axios' src --include=*.ts --include=*.tsx
# and, on the built bundle, the only HTTP code that ships (Capacitor's, unused):
grep -oF 'fetch(' dist/public/assets/index-*.js
```

Data leaves only when a teacher deliberately exports it, and then only to
wherever that teacher sends it.

## No AI, and what that means precisely

There is no AI or machine-learning component in the app. No model runs in it,
no data is sent to one, and no such dependency is installed in the app's
package. The built bundle contains no reference to any AI service.

The app's *source code* was written with the help of an AI coding assistant.
That is a development tool, in the same category as a compiler or an editor,
and it is not part of what gets installed on a device. No real student record
was ever used in that work: every name in the test suite is invented.

On Android the app declares `android:allowBackup="false"`, so the roster and
attendance are not eligible for Android Auto Backup to a Google account. That
default was on in the generated project and would have sent exactly the data
this document says stays local.

## The exported workbooks are the real exposure

The device writes **two** kinds of `.xlsx`, both behind the teacher /
club-operator PIN. Every export notice ends with: **Send this file only to a
school account.**

| Export | What's in it | Blast radius |
|---|---|---|
| **Attendance** (*Export this session* / *Export all history*) | For every tap: name, school email, grade level, **last four characters of the card** (never the full UID), timestamp. *Export all history* adds an *Activity* sheet of counts and filenames | Identifies who attended which meeting on **this device** |
| **Roster** (*Export roster* on Students) | Every student on the device — **including students who have never tapped** — with name, school email, graduation year, derived grade, and masked card tail (or blank if no card yet) | Wider than attendance: it is the full on-device roll, not only people who showed up |

**Import roster** is the reverse of the roster export: a club operator picks a
roster `.xlsx` and the device adds / updates students. The import **ignores
the card column** (cards bind only by tapping on that device) and can enrol a
whole class in one action. It never removes anyone. It is logged as
`import-roster` with counts only.

These files are how the device feeds the school workbook and how a
replacement device is re-provisioned. The SoR sentence, one-device-per-meeting
rule, and cache model live in `docs/data-and-backup.md` — this page does not
restate them.

Once exported, the app's guarantees stop applying. The file is an ordinary
student-records disclosure and should be handled under whatever rules the
school already applies to a spreadsheet of student names. Three things the
school still decides:

- Which school account the file goes to, and who may send it there. The
  design assumes the teacher's school OneDrive (the SoR's home).
- Whether the native build's share sheet is acceptable. It can send the file
  to any app on the device, but only an operator who has entered the PIN
  reaches it.
- How long copies outside the SoR are kept, and who deletes them.

## The activity log

Every export, every **roster import**, every removal, every retention purge and
every PIN change leaves one row on the device: when, what, how many, and for
an export the filename and how it was delivered. A row never carries a name,
an email or a UID, so the log can be read — and exported — without itself
being a disclosure. It is how an operator answers "where did that file go?",
"when was that class imported?", and "when was that student removed?", and it
is the record of disclosures a FERPA-style policy expects. The last fifty rows
are on the dashboard; the whole log (capped at five hundred rows) is the
second sheet of *Export all history*.

If a log row cannot be written, the action it describes still completes and
the notice on screen says the row is missing. A log that could fail an export
would push a teacher to export twice.

## Retention — the written schedule

The **school workbook (SoR)** is the retained attendance and roster record and
falls under the school's own records policy. The **device cache** keeps taps
for the **current school year only**. At the start of each school year, the
teacher or club operator:

1. runs *Export all history* (and *Export roster* if the SoR needs a fresh
   roll), confirms the files open, and files them into the school workbook;
2. presses **Delete attendance before {August 1}** on the dashboard, which
   deletes every tap recorded before the school-year boundary and nothing from
   the roster;
3. presses **Remove graduated students**, which removes every student whose
   class has graduated, with every tap that resolves to them.

Both actions show what they will delete before asking, both are confirmed
with their cost named, both are logged as counts, and neither ever runs on its
own. The device keeps nothing longer than a year plus the summer; longevity
lives in the SoR, not in IndexedDB.

**Imported students who never tap** are not purged by the attendance delete.
They leave when someone removes them on the Students page, or when *Remove
graduated students* reaches their class. Wave 1 deliberately keeps that on
Students rather than adding a bulk "undo import" — see
`docs/data-and-backup.md`.

## Answering a request to see a student's record

A parent, or the student, may ask to see what the device holds about them.
No feature is needed: the Students page shows the roster row (name, class
year, email, and either the card's last four or **No card yet**), and
*Export all history* filtered on the student's name is their attendance.
Corrections are made in place on the Students page; erasure is the *Remove*
button below.

## The device is the other one

The roster and the term's attendance sit on one device. That makes physical
control of it the main safeguard:

- A shared or unlocked tablet exposes the scanner — the count and the last
  student's first name — to anyone who picks it up. The roster, the dashboard
  and the exports are behind the PIN.
- "Clear storage" (Android) or deleting the app (iOS) erases everything with
  no confirmation from the app's side and no way to recover it except from an
  export.
- There is no remote wipe, because there is nothing remote.

## Erasing a student

The Students page has a **Remove** button on each student. It deletes the
student record and every attendance tap that resolves to them — both the taps
recorded against their id and any recorded against their card before it was
enrolled. Afterwards nothing in the database carries their name, address or
card UID, and the card can be enrolled again as a new student. The removal is
logged as a count of taps and sessions only; the log is not where a name
survives.

Two things follow from that, and the confirmation dialog says both before
anything happens:

- **It cannot be undone.** There is no server copy and no recycle bin.
- **Past attendance changes.** Their check-ins leave finished sessions too, so
  the dashboard's year-to-date figures and any later export will differ from
  one taken before the removal. Export first if those numbers have already
  been reported to anyone.

The taps go deliberately rather than being detached from the student. Keeping
them would leave rows carrying the UID of a card that is still in somebody's
wallet, which is a de-linked record, not an erased one.

If the school instead needs a student's *history* retained while their identity
is removed — a withdrawal rather than an erasure request — that is a different
operation and is not built. Say so and it can be added.
