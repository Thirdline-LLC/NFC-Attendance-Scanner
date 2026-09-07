# What this app does with student data

Written for whoever has to answer that question at St. John's. It describes the
software factually. It is not legal advice, and it does not claim compliance
with FERPA, COPPA or any other regime — that judgement belongs to the school.

## What is stored, and where

Two kinds of record, both in the browser's IndexedDB on the device running the
kiosk, in a database named `attendance-scanner-local`:

| Record | Fields |
|---|---|
| Student | first name, last name, graduation year, school email address, card UID, enrolment timestamp |
| Tap | card UID, timestamp, which student (if known), which session, whether it counted |

Nothing else about a student is collected. There is no date of birth, no
address, no photograph, no guardian information, no free-text notes, and no
identifier issued by anyone but the school.

## What leaves the device

**Nothing, on its own.** The app has no server, no account system, and no
analytics. There is no code in it capable of making a network request: no
`fetch`, no `XMLHttpRequest`, no `WebSocket`, no `sendBeacon`, no HTTP client
of any kind. Fonts are bundled rather than fetched, so the app makes zero
network requests even at startup. This is verifiable — from
`artifacts/nfc-attendance-scanner`:

```bash
grep -rnE '\bfetch\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource|axios' src --include=*.ts --include=*.tsx
```

Data leaves only when a person deliberately exports it, and then only to
wherever that person sends it.

## No AI, and what that means precisely

There is no AI or machine-learning component in the app. No model runs in it,
no data is sent to one, and no such dependency is installed in the app's
package. The built bundle contains no reference to any AI service.

The app's *source code* was written with the help of an AI coding assistant.
That is a development tool, in the same category as a compiler or an editor,
and it is not part of what gets installed on a device. No real student record
was ever used in that work: every name in the test suite is invented.

## The exported workbook is the real exposure

The `.xlsx` export contains, for every tap: the student's name, school email
address and grade level, the card's full UID, and the timestamp — all in plain
text. The card UID is masked everywhere on screen but deliberately complete
here, because the export is the record and a masked identifier could not be
reconciled later. That makes the file more identifying than any single screen
in the app. It is the app's system of record by design — the point is
that attendance survives a lost device — but it is also the only way this data
travels.

Once exported, the app's guarantees stop applying. The file is an ordinary
student-records disclosure and should be handled under whatever rules the
school already applies to a spreadsheet of student names. Worth deciding
before the first session:

- Where the file is allowed to go, and who may send it there.
- Whether the native build's share sheet is acceptable, since it can send the
  file to any app on the device.
- How long exports are kept, and who deletes them.

## The device is the other one

The roster and the term's attendance sit on one device. That makes physical
control of it the main safeguard:

- A shared or unlocked tablet exposes the roster to anyone who picks it up.
- "Clear storage" (Android) or deleting the app (iOS) erases everything with
  no confirmation from the app's side and no way to recover it except from an
  export.
- There is no remote wipe, because there is nothing remote.

## Erasing a student

The roster page has a **Remove** button on each student. It deletes the student
record and every attendance tap that resolves to them — both the taps recorded
against their id and any recorded against their card before it was enrolled.
Afterwards nothing in the database carries their name, address or card UID, and
the card can be enrolled again as a new student.

Two things follow from that, and the confirmation dialog says both before
anything happens:

- **It cannot be undone.** There is no server copy and no recycle bin.
- **Past attendance changes.** Their check-ins leave finished sessions too, so
  the dashboard's year-to-date figures and any later export will differ from
  one taken before the removal. Export first if those numbers have already been
  reported to anyone.

The taps go deliberately rather than being detached from the student. Keeping
them would leave rows carrying the UID of a card that is still in somebody's
wallet, which is a de-linked record, not an erased one.

If the school instead needs a student's *history* retained while their identity
is removed — a withdrawal rather than an erasure request — that is a different
operation and is not built. Say so and it can be added.
