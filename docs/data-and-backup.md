# Where the data lives, what erases it, and how to move a device

Everything this app knows is on the device it was scanned on. There is no
server, no cloud backup and no peer-device sync. **The school workbook in
OneDrive (or the school's equivalent shared drive) is the system of record** —
it holds the live roster and the attendance truth. Each device's IndexedDB is
a **cache**: useful for the meeting, allowed to be lost, and rebuilt by
exporting into the workbook and importing the roster back. The app's `.xlsx`
exports are the *feed into* that workbook, not a second SoR. This document
says exactly what that model protects you from.

**Workbook constraint (school side):** the SoR workbook stays pure Excel — no
macros, no VBA, no Office Scripts, no Power Automate — so it can be handed to
others at school without IT vetting beyond the app itself. Moving data between
the workbook and a device is a human action or app code, never Office
automation.

## What is stored

One IndexedDB database, `attendance-scanner-local`, with five tables:

| Table | Holds |
|---|---|
| `persons` | The roster: name, graduation year, email, enrolled-at, and **optionally** a card UID. A student imported from a roster file (or enrolled before a card is issued) may have **no card yet** — the row is still valid |
| `taps` | Every tap ever recorded: UID, timestamp, person id, session id, counted flag |
| `settings` | This device's settings: the per-session attendance target, and the teacher PIN as a salted PBKDF2 hash with its lockout counter (`operator-pin`, `operator-pin-attempts`). The PIN itself is never stored |
| `activity` | The device's activity log. Nine kinds: `export-session`, `export-all`, `export-roster`, `import-roster`, `remove-student`, `purge-history`, `remove-alumni`, `pin-set`, `pin-changed`. Each row is a timestamp, a kind, counts, and for exports a filename and delivery route. Never a name, an email or a UID. Capped at 500 rows |
| `scans` | Legacy. Nothing writes it; it exists so a database upgraded from v1/v2 still has its rows purged |

Plus two `localStorage` keys for the current session id and its start time.

Two properties matter more than the rest:

- **The tap log is append-only.** Starting a new session only rotates the
  session id — every previous tap stays exactly where it was, which is what
  makes year-to-date figures possible. Duplicate taps are recorded and flagged,
  never deleted.
- **Taps are deleted only by an explicit, confirmed teacher action** — *Remove*
  (one student and their taps), *Delete attendance before {August 1}* (every
  tap before the school-year boundary; the roster is untouched), *Remove
  graduated students* (each graduate and their taps) — or by
  `clearAllAttendanceHistory()`, which nothing in the UI calls. Each of the
  three on-screen actions shows what it will delete before asking, and each
  leaves a row in the activity log.

## The schema, version by version

Dexie replays these in order, so a database created at v1 upgrades cleanly to
v6 today. **No new version was added by the migration to VS Code, Android and
macOS** — packaging changed nothing about how data is stored; version 6 came later, for the activity log.

| Version | What it did |
|---|---|
| **1** | `scans` — UID and timestamp. Before enrollment existed. |
| **2** | Added `persons` (the roster) and `taps` (one row per tap, resolvable to a person). |
| **3** | Added `sessionId` and `counted` to `taps`, with a real upgrade function. Its subtlety: stamping every identified tap `counted: true` would have been wrong, because a v1/v2 database predates sessions entirely and all its taps land in one `'legacy'` session — a student who tapped at ten meetings would have arrived counted ten times. The first tap of each card in each session wins, in primary-key order. |
| **4** | Dropped the `counted` index and the two compound indexes over it. IndexedDB has no boolean key type, so they could never hold an entry; a declared index that does not exist invites a query that silently returns nothing. |
| **5** | Added `settings`, keyed by name. Device configuration, not student data — it sits beside the records so it survives with them and is cleared with them. |
| **6** | Added `activity` — what left the device and what was deleted, as counts, timestamps and filenames, never who. No upgrade function: an existing database simply gains an empty table. |

**Leave these blocks alone.** Old databases upgrade through them.

## Per platform

### Web / PWA

| | |
|---|---|
| Where | The browser's IndexedDB for the app's origin |
| Survives | Closing the tab, quitting the browser, restarting the machine, redeploying the site |
| Erased by | "Clear browsing data" / "Clear site data"; deleting the browser profile; the browser evicting storage under disk pressure |
| Also lost by | **Changing the origin.** A different domain, or moving from a domain root to a sub-path, is a different origin and the old data is not there |

The app calls `navigator.storage.persist()` at startup to ask for an exemption
from eviction. The answer is **advisory** — Chromium grants it on engagement
heuristics, WebKit on its own rules — so treat `true` as a nice-to-have.

**Uninstalling an installed PWA is not a documented, uniform operation.** Some
browsers keep the site data, some clear it, and it varies by version and
platform. Do not treat a PWA uninstall as reversible, and never treat it as a
backup.

### Android

| | |
|---|---|
| Where | The WebView's IndexedDB inside the app's private data directory, under the `https://localhost` origin |
| Survives | Force-stopping, rebooting, and **upgrading the app** with `adb install -r` or an MDM push, as long as the `applicationId` and signing key are unchanged |
| Erased by | Uninstalling the app; **Settings → Apps → SJC Attendance → Storage → Clear storage**; a factory reset |

`android:allowBackup="false"` is set in the manifest, so Android's automatic
cloud backup does **not** copy this data anywhere. That is deliberate — student
records should not be silently synced to a Google account — and it means the
`.xlsx` export is the only copy that leaves the tablet.

⚠️ A debug APK and a release APK are signed with different keys and **cannot
replace one another**. Switching between them means uninstall-then-install,
which erases everything. Export first.

### macOS

| | |
|---|---|
| Where | `~/Library/Application Support/SJC Attendance/` |
| Survives | Quitting and reopening, an OS upgrade, and **replacing the app** by dragging a new `.app` over the old one |
| Erased by | Deleting that directory; a "clean uninstall" utility that removes application-support files |

Dragging the app to the Trash leaves the directory behind, so a reinstall finds
its data again.

The app **never clears this directory at startup**, and the bundle id, the
`app://attendance` origin and the directory name are all fixed. Changing any of
them would leave the data on disk but invisible to the app.

## The teacher PIN

End Session, `/roster` and `/dashboard` — and therefore every export — sit
behind a PIN stored only as a salted hash. **It is not recoverable.** A
forgotten PIN leaves the records on the device but unreachable: nothing can be
exported until the app's data is cleared, which erases everything that was not
already exported. Treat the PIN like the records themselves: written down,
somewhere the school keeps such things.

The unlock is in memory only — it ends on the way back to the scanner, when
the summary closes, after five idle minutes, and on reload — so a reload is
never an open door.

## Exports

Both exports ask for the teacher PIN first.

| Platform | Route | Can it promise the file exists? |
|---|---|---|
| Web / PWA | A Blob behind a synthetic `<a download>` click | **No.** The click reports nothing back; a host that ignores it looks exactly like a file that saved. The app says "handed to the browser — check your downloads" and nothing stronger. |
| Android | `Filesystem.writeFile` to Documents, then the share sheet | **Yes.** The write is awaited, and a failure is thrown rather than swallowed. Dismissing the *share sheet* afterwards is not a failure — the file is already on disk. |
| macOS | The native Save dialog, then a write the main process confirms by size | **Yes.** And closing the dialog reports "Export cancelled", never "the export did not run". |

Two exports, two scopes: **End Session** covers the session on screen;
**Export all history** on the dashboard covers every tap ever recorded on the
device, including sessions that have rotated away and the taps the v3 upgrade
stamped `'legacy'`, and adds a second sheet, *Activity*, with the device's
activity log. The card column in both is the card's last four (`••••1F90`),
never the full UID. Every export notice ends with *Send this file only to a
school account.*

## The procedure for teachers

**Every meeting.** End Session → Export → check the file exists → send it
somewhere off the device (email it to yourself, drop it in Drive). Two minutes,
and it is the only thing standing between a broken tablet and a lost term.

**Once a term.** Dashboard → **Export all history**. Keep it with the school's
records.

**Export before you do any of these — no exceptions:**

- Uninstalling the app, or clearing its storage
- Replacing, wiping or factory-resetting the tablet or Mac
- Switching between a debug and a release APK
- Moving the web app to a different address
- Handing the device to anybody else
- Any change to the app's identity — package name, bundle id, origin

### Replacing a device

1. On the **old** device: Dashboard → **Export all history**, and on Students
   → **Export roster**. Confirm both files open and the rows look right.
2. Copy those files into the school workbook / OneDrive folder (the SoR) —
   somewhere that is not either device.
3. Set the **new** device up and install the app.
4. On the new device: Students → **Import roster** from the SoR roster file
   (or from the roster export you just made). Import is idempotent: it adds,
   updates, or leaves unchanged; it never removes anyone; it **ignores the
   card column** — cards bind only when tapped on that device.
5. Keep the old device untouched until the new one has been used for a real
   meeting. Students then tap once on the new device to bind cards.

The SoR workbook keeps attendance history. The new device starts with an empty
tap log; its dashboard year-to-date figures are **per device** and start from
the meetings held on that device.

### One device per meeting

Use **one kiosk per meeting**. Two devices at the same door produce two
exports that a person must combine in the school workbook — the app does not
merge attendance and will not in Wave 1. A second device is for a different
meeting, or for replacing a broken kiosk, not for a second lane at one door.

Dashboard figures (session count, year-to-date, unclaimed cards) are always
**this device's cache**, never the whole club's numbers. Read the SoR workbook
for the club-wide picture.

### Imported students who never tap (retention)

An imported student who never taps stays on the device roster until a teacher
removes them on the **Students** page, or until *Remove graduated students*
catches their class. Wave 1 does **not** add a bulk "undo this import" action:
mistaken imports are corrected one student at a time from Students (previewed
remove, same as anyone else). That is deliberate — a store-level undo would
duplicate Students and risk a silent mass delete.

## What the app will never do

- Silently swallow a persistence failure. `storageStatus` distinguishes a store
  that never opened (`'unavailable'`, which blocks enroll-mode scans) from one
  write that did not land (`'save-failed'`, which belongs to the session that
  hit it). There is deliberately no quiet `localStorage` fallback: a kiosk that
  stops persisting without saying so is worse than one that says so.
- Report an export as successful before the platform confirms it, on the two
  platforms that can confirm it.
- Delete a tap except through an explicit, confirmed, logged teacher action —
  *Remove*, *Delete attendance before {August 1}*, *Remove graduated
  students* — or the clear-all function nothing in the UI calls. Nothing is
  deleted on a schedule.
- Delete roster entries when attendance history is purged.
- Show a full card UID anywhere — on screen or in an export. One helper,
  `maskCardUid`, produces the `••••` + last-four string everywhere a card is
  named, the workbook included.
- Store the teacher PIN in plain text, or write a name, an email or a UID into
  the activity log.
