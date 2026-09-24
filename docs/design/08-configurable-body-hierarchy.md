# Design 08 — Configurable body hierarchy

**Status:** 08a implemented (2026-09-24) · 08b implemented (2026-09-24) · 08c deferred  
**Plan:** [plans/08-configurable-body-hierarchy.md](../plans/08-configurable-body-hierarchy.md)  
**Baseline:** [Design 02](02-attendance-bodies-sessions-taps.md) (D-T2). This design extends it; it does not reopen Plans 02–07.

## Design principle

Bodies, branches, labels, and hierarchy depth are fully user-defined.

Tapin does not hard-code domain types such as “club,” “class,” “section,” or “department.” An admin configures:

- What a body is called (`name`)
- What kind of body it is (`typeLabel`, a free string)
- How bodies nest (parent → child, arbitrary depth)
- Optional per-body custom fields (stored in 08a; defined in the UI in 08b)
- Renames and restructures of the tree without code changes or theme pack updates

Club-with-branches, teacher-with-sections, department-with-programs, and house-with-teams are configuration examples, not product modes.

Product copy stays generic (“Body,” “Active body,” “This body,” “This body + descendants”). The admin’s own `name` and `typeLabel` are what show up on the desk and in the picker. Theme `bodyTypePresets` are suggestions in the type-label field, not a closed list.

## Problem

Two shapes, one model:

1. A parent body has child bodies. Each child has its own roster and attendance. Meetings on the parent are attendance on the parent itself. Queries are per node, or rolled up to the parent.
2. A parent body owns several child bodies. The device attaches to one of them at a time. Views are per node or aggregated.

## Model

D-T2 is preserved. Each node owns its roster (`Person.bodyId`) and its taps (`TapRecord.bodyId`). The device holds exactly one `activeBodyId`, and that id may be any non-archived node. The same physical card may be enrolled independently on more than one node. The scanner records taps only for the body it is attached to. It does not flip bodies mid-queue.

```ts
type AttendanceBody = {
  id?: number;
  name: string;
  typeLabel: string; // free string
  createdAt: string;
  parentId?: number | null; // null = root
  sortOrder?: number;
  customFields?: Record<string, string>;
  archivedAt?: string | null;
};
```

Dexie `bodies` indexes: `++id, parentId, createdAt, sortOrder` (schema version 8).

Existing flat bodies migrate to roots (`parentId: null`) with `sortOrder` taken from `createdAt`. `activeBodyId` is unchanged. No roster or tap rows move.

### Invariants

- One parent. No multi-parent graph.
- Depth is unlimited in data. The picker warns above 6 levels and still saves.
- Reparent refuses a cycle, including a body parenting itself.
- Reparent and rename do not move or wipe `persons` or `taps`.
- Archive is soft. An archived body cannot become `activeBodyId` until it is restored. The body the device is attached to cannot be archived.
- Deleting a subtree, and “students inherit the parent roster,” are out of scope. Membership stays explicit per body.

### Roll-up

| Mode | Meaning |
|------|---------|
| This body | `bodyId === active` (previous behavior) |
| This body + descendants | `bodyId` is the active body or one of its descendants |

Unique attendance in the roll-up prefers email (trimmed, lowercased), then `cardUid`. Two rows that share an email — or, with no email, the same card — count once. Two enrollments that share neither still count twice.

Unknown cards are summed per body. The same card in two bodies is two unknown-card rows (“sum of each body’s unknown cards”), not one pooled card. A tap is resolved against the roster of the body that recorded it.

Export and retention stay on the active body. A subtree workbook is 08c.

### Vocabulary and custom fields (08b, shipped)

`BodyTypeDef` `{ id, label, sortOrder }` (the admin's saved vocabulary) and `BodyFieldDef` `{ id, label, appliesToTypeLabel, required, sortOrder }` (which custom fields apply to which type label) are Dexie tables, schema v9. `customFields` on `AttendanceBody` (08a) is what they drive: field defs decide which keys the editor offers for a body's `typeLabel`, and whether one may be left blank.

Creating or renaming a body adds a one-off `typeLabel` to the vocabulary automatically, matched case-insensitively — the vocabulary is a record of labels in use, not a closed set the admin must pre-declare. Renaming a vocabulary entry cascades onto every body and field def that used the old label, in one transaction, so neither silently falls off the vocabulary. Deleting a vocabulary entry leaves bodies already carrying that label untouched — `typeLabel` stays free text, not a foreign key.

The admin UI (`BodySwitcherDialog`'s create/structure-edit forms, and a new `BodyVocabularyDialog`) lives on the same PIN-gated dashboard route as 08a's structure edits — no new role. Theme `bodyTypePresets` remain suggestions, merged behind the saved vocabulary in the datalist.

An upgraded device seeds its vocabulary from every distinct `typeLabel` already on a body (first-appearance order), so an upgrade never starts with an emptier picker than the bodies already on it.

### Deferred exchange (08c)

Subtree workbook export, `Body Path` / `Parent Body` columns, and multi-body pack import are 08c. Single-body roster import and export are unchanged.

## UI (08a)

- **Body switcher** (dashboard, still behind the teacher PIN route): tree ordered by `sortOrder`, search across name / type label / path, indented rows, path on nested nodes. Create a root or a child. Rename, reparent, archive, restore. Archived rows cannot be selected. Soft depth warning on create.
  - *Amended by [Design 09](09-multi-period-classes-and-range-export.md) §1–2 (slice 3):* parents render as collapsible groups (`English 11 · 5 periods`, non-archived children counted, disclosure button with `aria-expanded`), children indented in `sortOrder`, all groups open by default; collapse state is component state only. A search still lists matches flat with their paths. "Add a body" offers **Single body** (the form above, unchanged) or **Class with periods** (Design 09 §1).
- **Desk:** subtitle is `name · typeLabel` for a root and `Parent › Child · typeLabel` for a nested body. No body control on the scanner.
- **Dashboard:** toggle “This body” / “This body + descendants.” The roll-up states the email-then-card rule. Unknown cards say they are summed per body. The active-body card uses generic copy. *Design 09 §2 (slice 3):* with the subtree toggle on a body that has children, a per-child breakdown table follows the roll-up.

## FERPA

Hierarchy, rosters, and taps stay in the local Dexie database. No cloud sync. Activity log kinds `body-reparent` and `body-archive` record that the tree changed, with no student name, email, or card UID.

## Plans 02–07

| Plan | Impact |
|------|--------|
| 02 Bodies | Extended. Flat model → tree. Local directories are in scope. D-T2 preserved. |
| 03 Roster import | Unchanged in 08a. Path columns and pack import are 08c. |
| 04 Themes | Presets stay suggestions. No new hard-coded club/class copy. |
| 05 PIN | Structure edits live on the PIN-gated dashboard. No new role. |
| 06 Export | Active-body export unchanged. Subtree export is 08c. |
| 07 Updates | No functional change. |
