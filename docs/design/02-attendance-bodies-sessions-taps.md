# Design 02 — Attendance bodies, sessions, taps

**Status:** Spec 2026-09-23 · **Plan:** [plans/02-attendance-bodies-sessions-taps.md](../plans/02-attendance-bodies-sessions-taps.md)

## Overview

Domain model for **first-class AttendanceBody entities** (class, club, faculty, custom). Each body owns its roster and tap history/metrics. A device holds an `activeBodyId` attachment for scanning. Replaces club-hardcoded language while preserving Wave 1 session/metrics **per body**.

## Entity ownership + device attachment (D-T2 revised)

- Many bodies may exist on one device; each keeps its own **roster and tap history**.
- Exactly one `activeBodyId` in settings — the body the scanner is attached to.
- Creating a body / switching active body is teacher PIN-gated.
- **Reassignment** = point the device at a different body. Roster and history **stay with the entity**; nothing is wiped because the device “moved.”
- Export remains available but **not required** before switch.
- No desk UI to flip bodies mid-queue.
  - *Amended by [Design 09](09-multi-period-classes-and-range-export.md) §3 (slice 4):* a sibling-only period switcher on the scanner may change `activeBodyId` without the PIN, unless the per-device "Require PIN to switch periods" setting is on. The no-flip-mid-queue rule is kept: switching is disabled while any tap is pending and runs through the scan queue. Sessions stay per body: the left body's session is untouched; taps after the switch join the new body's session for today if it has one, otherwise a new session is started for it (`createNewSessionId`).

## Model

See blueprint §5. Metrics (unique attendance, duplicates, unknown cards) are **per body entity**, never school-wide (SoR workbook holds the merge). Dashboard figures for “this session” are the **active** body’s.

## UI notes

- Body admin card on Dashboard: name, typeLabel, createdAt; “Change body…” wizard.
- typeLabel picker fed by theme `bodyTypePresets` + custom.
- Scanner subtitle: `{body.name} · {typeLabel}` — editorial small caps / muted, not a rainbow badge grid.

## Data flow

Boot → load active body → sessions rotate via Start New Session → taps append with bodyId + sessionId. Duplicate policy: first counted tap per member per session wins (existing).

## Edge cases

- Import members while body unset → force body create first.
- Switch active body → previous body’s roster + taps remain stored under that bodyId; new active body uses its own roster/history (D-T2). Export optional.
- Alumni / retention predicates unchanged; scoped to active body’s members.

## FERPA

Body name/type are organizational, not sensitive alone; members/taps are education records — local only.

## Out of scope

Multi-lane devices merging live; server-side body directories.

> **Amended by Plan 08.** Local body directories — a tree of bodies on this device — are in scope via [08-configurable-body-hierarchy.md](08-configurable-body-hierarchy.md). Server-side directories stay out of scope. D-T2 is unchanged: each body owns its roster and taps, and the device attaches with `activeBodyId`.