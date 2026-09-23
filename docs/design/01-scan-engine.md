# Design 01 — Scan engine

**Status:** Spec 2026-09-23 · **Plan:** [plans/01-scan-engine.md](../plans/01-scan-engine.md)  
**Depends on:** local-db, domain Member/Tap; themes only for copy strings.

## Overview

Capture card identity from the hardware path (today: USB keyboard-wedge readers that type hex + Enter; future: Web NFC / native NDEF where available). Produce a normalized `cardUid`, decide pause/active, and hand off to attendance or enroll/bind flows. **Never** send UIDs off-device except masked in teacher exports.

## UI notes (anti-slop)

- Scanner is the primary editorial surface: large count, short status line, asymmetric header (brand mark left via theme, session meta right).
- Status chip: Active / Paused / Off — high contrast, not pastel purple pills.
- Feedback toast: first name + last initial only at desk; full roster never on scanner chrome.
- Fonts/colors from active theme CSS variables.

## Data flow

1. Reader → key buffer → debounce (≥100 ms gap before Enter accept — shared with PIN field rules).
2. Normalize UID (uppercase hex, strip separators).
3. If scanner paused / dialog open / non-scanner route → drop or ignore (existing pause rules).
4. Lookup Member by `cardUid` within **active body**.
5. Outcomes: counted check-in | duplicate | unknown→bind prompt if uncarded members exist | unknown saved | bad read.

## Edge cases

- Burst from reader into focused PIN field — digits-only + max length + timing (existing).
- Partial reads → “Bad read — tap again.”
- Storage unavailable → hard stop; no silent loss.
- Origin change loses IndexedDB — packaging must preserve `app://attendance` (D1).

## FERPA

UID is a building credential. Mask everywhere in UI lists and exports. Desk sees check-in feedback only. Full UID never in activity log.

## Out of scope

Writing arbitrary NDEF URLs for marketing; multi-reader load balancing; cloud validation of cards.