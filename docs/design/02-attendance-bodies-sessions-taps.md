# Design 02 — Attendance bodies, sessions, taps

**Status:** Spec 2026-09-23 · **Plan:** [plans/02-attendance-bodies-sessions-taps.md](../plans/02-attendance-bodies-sessions-taps.md)

## Overview

Domain model for **one AttendanceBody per device**, sessions, and append-only taps. Replaces club-hardcoded language with configurable `typeLabel` while preserving Wave 1 session/metrics behavior.

## One-device–one-body

- Exactly one `activeBodyId` in settings.
- Creating/replacing a body is teacher PIN-gated.
- **D-T2 (2026-09-23):** On switch, **KEEP** existing taps on the device and reassign; export is available but **not required**; do **not** block the swap for export.
- No desk UI to flip bodies mid-meeting.

## Model

See blueprint §5. Metrics (unique attendance, duplicates, unknown cards) are **per device / per body**, never school-wide (SoR workbook holds the merge).

## UI notes

- Body admin card on Dashboard: name, typeLabel, createdAt; “Change body…” wizard.
- typeLabel picker fed by theme `bodyTypePresets` + custom.
- Scanner subtitle: `{body.name} · {typeLabel}` — editorial small caps / muted, not a rainbow badge grid.

## Data flow

Boot → load active body → sessions rotate via Start New Session → taps append with bodyId + sessionId. Duplicate policy: first counted tap per member per session wins (existing).

## Edge cases

- Import members while body unset → force body create first.
- Reconfigure body with existing taps → **KEEP** taps and reassign to the new active body (D-T2). Export optional.
- Alumni / retention predicates unchanged; scoped to active body’s members.

## FERPA

Body name/type are organizational, not sensitive alone; members/taps are education records — local only.

## Out of scope

Multi-lane devices merging live; server-side body directories.