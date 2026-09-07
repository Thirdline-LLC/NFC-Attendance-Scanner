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

The `.xlsx` export contains student names, school email addresses and grade
levels in plain text. It is the app's system of record by design — the point is
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

There is no delete-student function in the app today. If a record has to be
removed — a withdrawal, or a request from a family — the only routes are
clearing all local data and re-enrolling, or editing the exported workbook.
If the school needs a per-student deletion path, say so and it can be built;
it is a small change, and it is better to know it is needed before a term of
data exists rather than after.
