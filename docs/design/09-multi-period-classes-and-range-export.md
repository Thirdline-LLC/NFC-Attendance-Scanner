# Design 09 — Multi-period classes, date-range export, and class-wide roll-up

**Status:** Spec 2026-09-24 · Build-order step 3 (§1 setup flow, §2 tree + per-period breakdown) implemented on `feat/d09-class-with-periods` · Step 4 (§3 scanner period switcher, switch-PIN setting) implemented on `feat/d09-period-switcher` · Step 5 (§4 date-range export, single body; dashboard per-period metrics aligned) implemented on `feat/d09-range-export` · Step 6 (§5 class-wide roll-up export) implemented on `feat/d09-class-export`  
**Baseline:** [Design 02](02-attendance-bodies-sessions-taps.md) (D-T2), [Design 05](05-pin-and-roles.md), [Design 06](06-export-and-sor.md), [Design 08](08-configurable-body-hierarchy.md) (08a/08b shipped, 08c deferred).  
**Amends:** Designs 02, 05, 06, 08 (see [Amendments](#amendments-to-existing-designs)). Amendments land in the implementing slices, not in this PR.

## Problem

A teacher teaches the same course (e.g. "English 11") across five periods a day and wants to manage all five from one place. Today this is possible with 08a parent/child bodies and 08b vocabulary, but setting it up is confusing: the teacher must create a root body, then create five children one at a time, pick type labels, and then switch the active body through the PIN-gated dashboard between every period.

Teachers also need attendance **metrics** they can download for a date range (a day, a month, a year, a custom span), for one period or for the whole class across all periods. Plan 06 export has no date filter, no summary, and covers only the active body.

## Decision summary

| Topic | Decision |
|---|---|
| Model for "class with periods" | Reuse 08a hierarchy: one parent body + one child body per period. **No new entity, no migration.** |
| Setup | New "Class with periods" preset flow that creates the parent and all children in one transaction. |
| Navigation | Collapsible tree in the body picker / dashboard sidebar; parents show "English 11 · 5 periods". |
| Scanner period switcher | **Allowed on the scanner, no PIN**, sibling-only, confirmed on screen, logged. Optional per-device "require PIN to switch" setting. |
| Date-range export | New Export dialog with range presets; workbook gains Summary and By meeting sheets. |
| Class-wide export | "This body + all children" scope in the same dialog; pulls forward the **export half of 08c** only. |
| 08c import half | Stays deferred (multi-body packs, path-column import). |

### Options considered and rejected

- **New "course/subject" entity grouping period bodies.** Duplicates the 08a parent/child relationship, adds a table and a migration, and creates two ways to model the same thing. Rejected.
- **One body with multiple "instances/sessions" (periods) inside it.** Breaks D-T2: a body owns its roster, and different periods have different students. Would require per-instance rosters, re-keying taps, and reworking roll-up and export. Rejected.
- **Preset/template over the existing hierarchy (chosen).** Zero data-model change; the hierarchy already supports per-period rosters, per-period taps, and parent roll-up.

## 1. "Class with periods" setup flow

Lives on the PIN-gated dashboard (same place as 08a structure edits). No new role.

1. **Add a body** → choose **Class with periods** or **Single body** (today's flow).
2. Enter the class name (e.g. "English 11").
3. Choose the number of periods (1–10).
4. Period names auto-fill "Period 1" … "Period N". Each is editable (e.g. "Period 2 – Room 114"). The teacher can instead enter their real bell periods (e.g. 1, 3, 4, 6, 7).
5. Preview: `English 11` with the period rows beneath it, in order. The default type labels ("class", "period") are pre-filled and editable before creating (e.g. "course" / "section", or "club" / "team").
6. **Create** → one transaction creates the parent (`typeLabel` "class") and N children (`typeLabel` "period"), `sortOrder` in the entered order. Labels are added to the 08b vocabulary automatically (existing behavior).
7. Follow-up prompt: **Add students to each period**. For each period: *Download template* (the roster template button, pre-filled with that period's body name/type) → *Upload*, or *Skip for now*.

Labels are defaults, not product modes (Design 08 principle): a club admin can use the same flow as "Robotics" with "Build team / Drive team", etc. Copy says "periods" only because the teacher chose that preset; the type labels remain free text.

Optional: seed a 08b `BodyFieldDef` "Period" (and "Room") for `typeLabel` "period" so the bell-period number is stored in `customFields`. No schema change (08b tables exist).

## 2. Collapsible tree / sidebar UI

- The body picker and the dashboard body list render the 08a tree as **collapsible groups**: a parent row shows `English 11 · 5 periods` with a disclosure chevron; expanding shows its children in `sortOrder`.
- Collapsed/expanded state is UI-only (component state or a non-PII settings key); it is not part of the data model.
- Selecting a parent shows the class view (roll-up); selecting a child shows that period.
- **Class view:** the existing "This body + descendants" roll-up plus a new **per-period breakdown table** (period, meetings held, unique present, average attendance %).
- Search, rename, reparent, archive, and restore behave as in 08a.

## 3. Scanner period switcher

**Recommendation and decision: no PIN, sibling-only, logged.**

- **Visibility:** the switcher is shown only when the active body has a non-null `parentId` **and** that parent has at least one other non-archived child. A root body (`parentId` null) never shows the switcher, so unrelated roots can never appear in it.
- **Scope:** it lists only the **non-archived children of the active body's parent** (e.g. when on "English 11 › Period 3", it offers Periods 1–5 of English 11). Never the parent itself, other roots, cousins, deeper descendants, or archived bodies.
- **Mid-queue rule:** switching is **disabled while a tap is pending** (a scan being resolved, an unknown-card / "Whose card is ••••?" prompt, or an enroll dialog open). The control re-enables once the queue is empty. This preserves the D-T2 rule that the scanner never flips bodies mid-queue: every tap is resolved against the body that was active when it was read.
- **Session rule:** sessions are per body. On switch, the current body's open session is left as is (it ends by End Session or the existing session rules, unchanged). Taps after the switch join the **new body's open session for the current meeting day if one exists; otherwise a new session is started for the new body** using the existing session-creation logic. A session never spans two bodies.
- Switching changes `activeBodyId` only. It never shows a roster, tap history, or metrics.
- On switch, a clear confirmation: "Now taking attendance for **Period 3**" (and the desk subtitle updates as today).
- Each switch writes an activity entry `body-switch` with body ids/labels only — no student name, email, or card UID.
- Optional per-device setting **Require PIN to switch periods** (default off) for unattended kiosks. Changing this setting follows the protection-toggle rule below.

### Protection-toggle rule (applies to this design and the Design 05 PIN switch)

- **Turning a protection off** (the Design 05 "Require teacher PIN" switch to off, or "Require PIN to switch periods" to off) **requires the current PIN**.
- **Turning a protection on** needs no PIN (Asher's decision for the PIN switch, 2026-09-24): it only adds protection and re-enables the existing PIN hash.
- Every change to either toggle, in either direction, writes a PII-free activity entry (`pin-disabled` / `pin-enabled`, `switch-pin-disabled` / `switch-pin-enabled`) with timestamp only.
- Both toggles live on the PIN-gated dashboard.

**Rationale (FERPA vs usability).** The switcher discloses no education records; its only risk is data integrity (a student switching periods so taps land in the wrong period), which is visible in the activity log and correctable. Requiring the PIN five-plus times a day pushes teachers toward turning the PIN off entirely (the Design 05 on/off switch), which is the larger privacy risk.

## 4. Date-range export (single body)

### UI
"Export" on the dashboard opens an **Export dialog**:

- **Range:** Today · Single day (date picker) · Last 7 days · Past month · Past year · This school year (from August 1) · All time · Custom (from/to).
- Day boundaries are local midnight on the school's session calendar (`formatSessionDate`, the zone the device clock reads at the school); both ends inclusive. *(Step 5: "device clock" read as the session calendar so ranges agree with Meeting Date, YTD and retention; see Build order step 5.)*
- File name carries body and range, e.g. `English 11 – Period 3 – 2026-09-01 to 2026-09-24.xlsx`.

### Workbook
| Sheet | Contents |
|---|---|
| **Summary** | Header block: body path, range, exported-at. One row per enrolled person: meetings attended, meetings held (in range), attendance %, first and last check-in in range. **Meetings held** for a person = sessions of that body in the range on or after the person's `enrolledAt` date, so a student added partway through is not penalized for earlier meetings. |
| **Attendance** | Today's per-tap rows (Design 06), filtered to the range. Masked card column unchanged. |
| **By meeting** | One row per **session** (a body can have more than one session on a date): date, session start time, present count, roster size at that session. |
| **Activity** | Only for **All time** (preserves Design 06 whole-history behavior). |

### Data model
None. Taps already carry `scannedAt` and `bodyId`; filtering happens before the workbook is built. No Dexie schema bump, no migration. (A `[bodyId+scannedAt]` compound index could be added later for performance; out of scope here.)

## 5. Class-wide roll-up export (08c export half, pulled forward)

- **Subtree depth:** "all periods" means **the body plus all non-archived-or-archived descendants at any depth** (matching the Design 08 "This body + descendants" roll-up), not only direct children. Summary by period lists each descendant with its full path.
- When the selected body has children, the Export dialog adds a scope choice: **This body only** / **This body + all periods** (wording follows the children's label; generic "children" otherwise). Same range options.
- Workbook additions for the subtree scope:
  - **Summary by period:** one row per child (meetings held, unique present, average attendance %), plus a whole-class total row.
  - **Summary** and **Attendance** gain a **Period** column holding the body path (e.g. `English 11 › Period 3`). This is the 08c `Body Path` column.
- Counting: per-period rows count a person in each period they are enrolled in; class totals de-duplicate using the Design 08 roll-up rule (email trimmed/lowercased, then `cardUid`).
- Works for any parent/child tree (clubs with branches, organizations with teams), not only classes.
- The dashboard "This body + descendants" view is on-screen only and does not satisfy the download need, so the export must be extended.

### 08c scope split
- **Pulled forward (this design):** subtree workbook export, Body Path / Period column, per-child summary.
- **Still deferred (08c):** multi-body `.nfc-pack` import, importing with Body Path / Parent Body columns. The per-period roster template covers setup in the meantime.

## Build order

Each step is one implementation slice (one Claude Code Sonnet session), then Reviewer CLEAR, then Merger. One slice at a time.

1. Roster **Download template** button (in progress).
2. **Require teacher PIN** on/off switch (queued).
3. **Class with periods** setup screen + collapsible tree + per-period breakdown on the dashboard. **Implemented** (`feat/d09-class-with-periods`). Choices made there:
   - `createClassWithPeriods` (attendance-store) writes the parent and all periods in one Dexie transaction; no schema bump. Like `createBody` it writes **no activity row** and does not require root names to be unique. A type label with a *required* 08b custom field is refused, since the flow collects none.
   - Like **Create and switch**, the device attaches to the new **class** (the parent), and the dashboard figures switch to "This body + descendants" so the per-period table shows.
   - Follow-up step: **Download template** per period (the Students page xlsx template, pre-filled with that period; not logged, as on the Students page) and **Skip for now / Done**. Per-period *upload* is not in this slice; import stays on the Students page for the active body.
   - Breakdown columns: meetings held, unique present (of enrolled), average attendance % = average students present per meeting ÷ that period's roster, year to date, computed with the roll-up rules over each child's own subtree. Archived children stay in the table, marked; the parent row's count excludes them.
   - Optional `BodyFieldDef` "Period"/"Room" seeding was not done.
4. **Scanner period switcher** + Design 08 amendment. **Implemented** (`feat/d09-period-switcher`). Choices made there:
   - Visibility and scope come from one pure helper, `periodSwitchOptions` (body-hierarchy): shown only when the active body has a parent with at least one other non-archived child; it lists exactly those siblings in sibling order. A `parentId` of `undefined` (pre-08a body) counts as a root. The title follows the siblings' shared type label ("Switch period", "Switch team"); mixed labels read "Switch within English 11".
   - **Pending state** is the hook's real queue state (`useAttendanceSession().pendingTap`): a count of scans handed to the queue and not yet finished (`scan`), the "Whose card is …?" bind prompt (`unknown-card`), the enrollment form (`enroll`), and an enroll/bind write in flight (`saving`). The trigger is disabled while it is set and says why ("Finish the current tap first — …"). The switch itself also runs **through the same queue** as scans, because `processScan` resolves the active body more than once per tap; a switch landing between those reads would split one tap across two bodies.
   - **Session join:** `findTodaysSessionForBody` answers "the new body's open session today". First choice: the session the desk was running for that body when it last switched away today (`rememberBodySession`, localStorage), so a session a teacher just started is rejoined even before its first tap. Otherwise: the session of the body's latest tap on today's meeting date (the local date `formatSessionDate` files sessions under). Either is joined with `adoptSessionId`. Otherwise it calls `createNewSessionId`, the same call Start New Session makes, so the new body never shares a session id with the one just left. The old body's session is untouched; switching back the same day rejoins it. The lookup runs before `setActiveBody`, and the session id is only changed after the switch is accepted, so a refused switch changes nothing. The queued switch also refuses (`TapPendingError`) if a card read in the moment between choosing and switching opened the bind prompt or enrollment form: the tap keeps its body and the desk says "Finish the current tap first". Switching from the dashboard picker is unchanged (it does not rotate or join sessions).
   - The desk shows a strip under the header: "Taking attendance for **Period 3**" in the display face, the 44px trigger, and one always-mounted polite live region for "Now taking attendance for **Period 3**" (cleared after 8 s) or the pending reason. The chooser is a modal dialog (focus trap, Escape, Up/Down/Home/End; the current row is marked `aria-current` and cannot be chosen). A reader-speed Enter is dropped in the chooser (`isHumanEnter`, as the PIN field does), so a card tapped while it is open cannot pick a period. Focus returns to the trigger on close and the desk then hands it back to the hidden reader input, as after every scanner dialog, so a card tap never lands on a button.
   - `body-switch` activity rows carry `fromBodyId`/`fromBodyName`/`toBodyId`/`toBodyName` only: new optional, non-indexed `ActivityEntry` fields, no Dexie version bump.
   - **Require PIN to switch periods** (settings key `switch-pin-required`, default off; only the literal `'true'` reads as on) sits on the Teacher PIN card under the Require teacher PIN switch. `setSwitchPinRequired` enforces the protection-toggle rule: on needs no PIN; off verifies the current PIN (shared lockout); both are logged `switch-pin-enabled` / `switch-pin-disabled`, timestamp only. When on, choosing a period opens `PinDialog` in `verify` mode before switching; a PIN verified there does not unlock the teacher pages.
   - **No-PIN edge case (decision):** the setting **cannot be turned on without an existing teacher PIN**. The switch is disabled with "Set a teacher PIN first …" inline. It is enforced only while a PIN hash exists (`isSwitchPinEnforced`), so a device whose hash has gone (a cleared or hand-edited settings row) switches freely instead of asking for a PIN nobody can type, and the stuck "on" can still be turned off, with no PIN to verify. It is independent of the Require teacher PIN switch: with the dashboard gate off but a PIN set, the scanner still asks.
5. **Date-range export dialog** with Summary and By meeting sheets + Design 06 amendment. **Implemented** (`feat/d09-range-export`). Choices made there:
   - **Metrics definitions (Asher's, shared).** One helper, `computeRangeMetrics` (attendance-metrics), backs the export Summary and By meeting sheets, the dialog preview and the dashboard "By period" table. *Meetings held* = the body's sessions whose day is in the range; a person's meetings held start on their `enrolledAt` day. *Average attendance %* = mean over meetings of present ÷ roster as of that meeting day (`isOnRosterAsOf`: `enrolledAt` on or before the day), `null`/"—" when there is no meeting or no roster at any of them (such meetings are left out of the mean). Summary % = meetings attended ÷ person-clipped meetings held.
   - **Dashboard aligned.** `computePeriodBreakdown` now calls `computeRangeMetrics` over `schoolYearRange(now)` (August 1 through today) with roll-up identity, so a row equals that period's "This school year" export. Previously its average was mean present ÷ *today's* roster. A test asserts row-for-row equality with the exported Summary header on a fixture with a mid-year enrollment, where the old and new formulas differ. The target card and other YTD figures are unchanged (a different metric).
   - **Retroactive taps.** A card enrolled after it was tapped still resolves (existing behaviour). Those taps stay in the Attendance sheet, in *unique present* and in first/last check-in, but *present* at a meeting only counts students on the roster that day, so a meeting never reads 5 of 4 and a student never 3 of 2.
   - **Roster removals are hard deletes** (no `leftAt`), so a removed student vanishes from past meetings' roster sizes too; documented on `isOnRosterAsOf`.
   - **Day boundaries.** Ranges are inclusive `YYYY-MM-DD` days on the session calendar (`formatSessionDate`, the school's zone, which a kiosk's device clock reads), compared as strings like the YTD filter and the retention purge, so a range and the Meeting Date column never disagree. Taps are filtered by their own day and then grouped into sessions (the `selectYearToDateTaps` rule). Presets end today and include it: Last 7 days = today and the six before; Past month / Past year = the day after this date last month / year (month-end clamped); This school year = `schoolYearStart`; All time is unbounded. Custom requires both dates, from ≤ to.
   - **Dialog.** "Export all history" is now **Export**, opening a modal (focus trap, Escape, 44px targets, radio group + labelled date fields). Scope is this body only. A live preview (same helper) shows meetings, taps, students present, sheets, file name, the retention note, and an empty state.
   - **File name.** `English 11 - Period 3 - 2026-09-01 to 2026-09-24.xlsx` (single day: one date; All time: `All time`). ASCII ` - ` rather than an en dash so the name is simple on Windows, the Android share sheet and the desktop allowlist; unsafe characters become `-`. `electron/validation.ts` gains `RANGE_EXPORT_FILENAME`, tested against real builder output. No time stamp, so re-exporting the same range reuses the name (browser renames, desktop Save asks, Android replaces with the newer file).
   - **Retention caveat.** The Summary header adds a *Note* when the range starts before the oldest tap the device holds for the body (always for All time), worded to be true whether earlier days were purged or never recorded; a body with no taps says so.
   - **Activity.** All time keeps the Activity sheet and logs `export-all` as before; other ranges omit the sheet and log a new `export-range` with `rangeFrom`/`rangeTo` (dates only, non-indexed fields, no Dexie bump).
   - **#34 nit.** The scanner turns capture off while a period switch runs ("Scanner off — switching").
6. **Class-wide export** (08c export half) with Period column and Summary by period + Design 06/08 amendments. **Implemented** (`feat/d09-class-export`, stacked on `feat/d09-range-export`). Choices made there:
   - **Scope control.** Shown in the Export dialog only when the active body has at least one descendant (`subtreeBodyIds(...).length > 1`); otherwise the dialog is exactly step 5's. It sits above Range as a two-option radio group, **This body only** / **This body + all periods**, the noun from the direct children's shared type label (`childrenNoun`: non-archived children decide it, all of them when every child is archived; a mixed set reads `children`). The dialog starts on the scope the dashboard figures show, or on the class-wide one when the active body has no roster or taps of its own (a class that only holds its periods), where "This body only" would be an empty file. Same range presets and validation. The preview, file name and sheet list come from the same `describeSubtreeExport` the workbook uses.
   - **Rows.** `computeSubtreeRangeMetrics` (attendance-metrics) lists every body in the subtree at any depth, archived or not, in preorder (parent before children, siblings in sibling order), with the full path (`English 11 › Period 3 › Lab`) and ` (archived)` appended when archived. Each row is `computeRangeMetrics` over **that body's own** taps and roster with roll-up identity — for a class whose periods are leaves, exactly the dashboard's `computePeriodBreakdown` row for This school year (tested row for row). For a nested tree the export row is the body's own, while the dashboard rolls a direct child's subtree up; the grandchild has its own row in the export, so nothing is counted twice down the column. The **root** gets a row, first, only when it has a roster or taps of its own; stray taps on a class parent are real and must not vanish into the total.
   - **Total row** ("Total (each person counted once)"). *Meetings held* = all bodies' meetings (a meeting is one session of one body). *Average attendance %* pools every body's meetings, each `present ÷ that body's roster as of that day` — the step 5 definition, pooled; dividing a Period 3 meeting by the whole class's roster would read ~17% for a full room. *Unique present* and *Enrolled* de-duplicate with `rollupIdentityKey` (email trimmed and lowercased, then `cardUid`), so a student in two periods is in both period rows and once in the total.
   - **Sheets.** Summary (header totals for the class; person table with **Period** first, one row per person per period), **Summary by period**, Attendance (Design 06 columns in place, **Period** added last; every tap resolved against the roster of the body that recorded it, never a merged roster, so a card enrolled in Period 1 reads "Unknown card" when tapped in Lab), By meeting (**Period** first, all bodies' meetings oldest first), and Activity for All time only (the device-wide log, as in step 5; no subtree filter). Sheet and column names are fixed text, not derived from type labels (Excel caps sheet names at 31 characters). Single-body export is unchanged.
   - **File name.** `English 11 - All periods - 2026-09-01 to 2026-09-24.xlsx`: the scope is a segment after the body path, kept whole when a long path is cut; it fits the existing `RANGE_EXPORT_FILENAME` allowlist unchanged (tested).
   - **Activity.** Same kinds (`export-range`, `export-all` for All time); a class-wide export adds `scope: 'subtree'` and `bodies` (the row count) — optional, non-indexed `ActivityEntry` fields, no Dexie bump — and reads "Exported a date range, with descendants … across 4 bodies". Counts, dates and the file name only.
   - Shared tweaks: `attendanceRowFor` split out of `buildAttendanceRows`; `sharedTypeLabel` in body-hierarchy now backs `childCountLabel`, `childrenNoun` and the dashboard's per-period column header. The dashboard's roll-up view and per-period table are otherwise unchanged.

Step 5 precedes 6 because 6 reuses its dialog and Summary builder.

## Amendments to existing designs

| Design | Current text | Amendment (lands with the slice noted) |
|---|---|---|
| **02 Bodies, sessions, taps (D-T2)** | Switching the active body is PIN-gated (dashboard only); the desk never flips bodies mid-queue. | A sibling-only period switcher on the scanner may change `activeBodyId` without the PIN (unless the per-device setting requires it). The no-flip-mid-queue rule is kept: switching is disabled while any tap is pending. Sessions stay per body; taps after a switch join the new body's session (slice 4). |
| **05 PIN & roles** | PIN always guards teacher pages. | PIN may be toggled off by a teacher (slice 2). Scanner period switching is not a teacher action and does not require the PIN, with an optional per-device "require PIN to switch" setting (slice 4). Protection-toggle rule: turning either protection off requires the current PIN; turning it on does not; every change is logged without PII. Note: while the PIN is off, anyone at the device can run range and class-wide exports. |
| **06 Export & SoR** | Session export and all-history export (+ Activity sheet) for the active body; no date filter. | Adds range export with Summary and By meeting sheets; Activity sheet only on All time (slice 5). Adds subtree scope with Period column and Summary by period (slice 6). |
| **08 Body hierarchy** | "No body control on the scanner." Export and retention stay on the active body; subtree workbook is 08c. | Picker renders parents as collapsible groups and offers the Class with periods preset; dashboard adds the per-period table (slice 3, landed in Design 08 UI). Allows a sibling-only period switcher on the scanner (slice 4). Moves the subtree-export half of 08c into Design 09 (slice 6); import half stays 08c. |

## Conflicts and edge cases

- **Retention vs long ranges.** The retention setting purges old taps, so "Past year" or "All time" may be incomplete. The Summary header must state when the requested range starts before the oldest retained tap.
- **Student in two periods.** Enrolled separately in each period (D-T2, explicit membership). Counted in each period's rows; counted once in class totals.
- **Archived periods.** Excluded from the scanner switcher; included in exports for ranges when they had taps, labelled "(archived)".
- **Reparenting mid-range.** Exports use the tree as it is at export time; taps stay with the body that recorded them.
- **Bell-schedule auto-switching.** Out of scope; possible later step.

## FERPA

- All data stays in the local Dexie database; no cloud sync, no remote upload. Exports are local files the teacher controls (Design 06: exports are disclosures).
- Date-range exports support **minimum-necessary disclosure**: teachers share only the slice needed rather than whole history.
- Class-wide exports aggregate existing records only; no new personal data is collected.
- Activity log entries added by this design (`body-switch`, and the setup flow's body creation) contain body ids/labels only — never student names, emails, or card UIDs.
- Exports remain on the PIN-gated dashboard; if a teacher turns the PIN off (Design 05 amendment), exports are reachable by anyone at that device. Appropriate only on teacher-controlled devices, not unattended kiosks.

## Out of scope

Student ID column; per-student custom fields; bell-schedule automation; cloud sync or LMS integration; 08c import half.
