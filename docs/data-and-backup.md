# Where the data lives, what erases it, and how to move a device

Everything this app knows is on the device it was scanned on. There is no
server, no cloud backup and no sync. **The exported `.xlsx` is the system of
record** — that sentence is the whole safety model, and this document exists to
say exactly what it protects you from.

## What is stored

One IndexedDB database, `attendance-scanner-local`, with four tables:

| Table | Holds |
|---|---|
| `persons` | The roster: card UID, name, graduation year, email, enrolled-at |
| `taps` | Every tap ever recorded: UID, timestamp, person id, session id, counted flag |
| `settings` | This device's settings, e.g. the per-session attendance target |
| `scans` | Legacy. Nothing writes it; it exists so a database upgraded from v1/v2 still has its rows purged |

Plus two `localStorage` keys for the current session id and its start time.

Two properties matter more than the rest:

- **The tap log is append-only.** Starting a new session only rotates the
  session id — every previous tap stays exactly where it was, which is what
  makes year-to-date figures possible. Duplicate taps are recorded and flagged,
  never deleted.
- **Only `clearAllAttendanceHistory()` deletes taps**, and it leaves `persons`
  alone. Clearing attendance history never costs you the roster.

## The schema, version by version

Dexie replays these in order, so a database created at v1 upgrades cleanly to
v5 today. **No new version was added by the migration to VS Code, Android and
macOS** — packaging changed nothing about how data is stored.

| Version | What it did |
|---|---|
| **1** | `scans` — UID and timestamp. Before enrollment existed. |
| **2** | Added `persons` (the roster) and `taps` (one row per tap, resolvable to a person). |
| **3** | Added `sessionId` and `counted` to `taps`, with a real upgrade function. Its subtlety: stamping every identified tap `counted: true` would have been wrong, because a v1/v2 database predates sessions entirely and all its taps land in one `'legacy'` session — a student who tapped at ten meetings would have arrived counted ten times. The first tap of each card in each session wins, in primary-key order. |
| **4** | Dropped the `counted` index and the two compound indexes over it. IndexedDB has no boolean key type, so they could never hold an entry; a declared index that does not exist invites a query that silently returns nothing. |
| **5** | Added `settings`, keyed by name. Device configuration, not student data — it sits beside the records so it survives with them and is cleared with them. |

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

## Exports

| Platform | Route | Can it promise the file exists? |
|---|---|---|
| Web / PWA | A Blob behind a synthetic `<a download>` click | **No.** The click reports nothing back; a host that ignores it looks exactly like a file that saved. The app says "handed to the browser — check your downloads" and nothing stronger. |
| Android | `Filesystem.writeFile` to Documents, then the share sheet | **Yes.** The write is awaited, and a failure is thrown rather than swallowed. Dismissing the *share sheet* afterwards is not a failure — the file is already on disk. |
| macOS | The native Save dialog, then a write the main process confirms by size | **Yes.** And closing the dialog reports "Export cancelled", never "the export did not run". |

Two exports, two scopes: **End Session** covers the session on screen;
**Export all history** on the dashboard covers every tap ever recorded on the
device, including sessions that have rotated away and the taps the v3 upgrade
stamped `'legacy'`.

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

1. On the **old** device: Dashboard → **Export all history**. Confirm the file
   opens and the rows look right.
2. Get that file somewhere that is not either device.
3. Set the **new** device up and install the app.
4. Enrol the students again by tapping their cards. **There is no roster
   import** — the app only ever creates new Excel files, and never reads one
   back.
5. Keep the old device untouched until the new one has been used for a real
   meeting.

The historical `.xlsx` is your record of what happened. The new device starts
with an empty history, and the dashboard's year-to-date figures start from
there.

> **No import exists, and none is planned.** The app creates new exports and
> never opens, reads or rewrites an existing workbook. If re-importing a roster
> onto a replacement device is something you need, it is a feature request —
> ask, and it can be designed properly.

## What the app will never do

- Silently swallow a persistence failure. `storageStatus` distinguishes a store
  that never opened (`'unavailable'`, which blocks enroll-mode scans) from one
  write that did not land (`'save-failed'`, which belongs to the session that
  hit it). There is deliberately no quiet `localStorage` fallback: a kiosk that
  stops persisting without saying so is worse than one that says so.
- Report an export as successful before the platform confirms it, on the two
  platforms that can confirm it.
- Delete a tap for any reason other than the explicit clear-all action.
- Delete roster entries when attendance history is cleared.
- Show a full card UID anywhere on screen. One helper, `maskCardUid`, produces
  the `••••` + last-four string everywhere a card is named.
