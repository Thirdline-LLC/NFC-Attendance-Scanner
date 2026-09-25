# Design 05 — PIN and roles

**Status:** Spec 2026-09-23 · **Plan:** [plans/05-pin-and-roles.md](../plans/05-pin-and-roles.md)  
**Source of truth for shipped behavior:** `docs/data-protection.md`, FERPA kiosk spec.

## Overview

Two roles — **Desk** and **Teacher** — gated by a 4–8 digit teacher PIN (PBKDF2 hash in settings). Extend copy via theme (`teacherRoleLabel`) without weakening the gate. New surfaces (import, theme, body reconfigure, update check) are teacher-only.

## UI notes

- Lock glyph on Students/Dashboard while locked.  
- Unset-PIN banner until first set.  
- Theme strings only; layout stays high-contrast, not playful gradient modals.
- **Require teacher PIN** switch on the Dashboard's Teacher PIN card
  (`switch-pin-required`, `role="switch"`). Shown once a PIN exists — the
  normal path to the dashboard already forces one to be set first — or when
  the requirement is already off with no PIN behind it, so a device stuck in
  that state still has a way back in.
- *Amended by [Design 09](09-multi-period-classes-and-range-export.md) §3 (slice 4):* **Require PIN to switch periods** (`switch-switch-pin-required`, setting `switch-pin-required`, default off) sits on the same card. Switching periods on the scanner is not a teacher action and needs no PIN unless this is on. It follows the same protection-toggle rule: on needs no PIN, but a PIN must exist (the switch is disabled with an explanation otherwise); off asks for the current PIN; each change logs `switch-pin-enabled` / `switch-pin-disabled` with a timestamp only. With no PIN hash on the device the setting is not enforced, so the scanner never dead-ends on a PIN prompt nobody can answer.

## Data flow

`verifyOperatorPin` → in-memory unlock → idle 5 min / navigate to scanner / End Session dismiss → relock. Protected routes do not mount children while locked.

A persisted device setting, `pinRequired` (default true; missing reads as
true), gates all of that. `OperatorLockProvider` reads it once on mount and
computes `unlocked` as `!pinRequired || <in-memory unlock>` — while the
setting is off, every `LockedRoute` mounts its children immediately, and the
idle relock and `RelockOnScanner` are skipped rather than just made
ineffective. The setting survives a relaunch; the in-memory unlock never did
and still doesn't.

Turning it **off** requires entering the current PIN once (the same
`verifyOperatorPin` check the gate itself uses, via `PinDialog`'s `verify`
mode). A wrong PIN leaves it on. Turning it back **on** needs no PIN — it
just flips the setting back; the PBKDF2 hash is never touched by either
direction, and there is still no way to delete it. Turning it on when no PIN
has ever been set opens the same set-PIN form the locked-route gate itself
falls back to, rather than silently enabling a requirement with nothing
behind it. Both directions write a timestamp-only row to the activity log
(`pin-disabled` / `pin-enabled`) — no student data, same as every other row
in that log.

## Edge cases

- Reader burst into PIN field (existing mitigations).  
- Missing `crypto.subtle` → PinUnavailableError copy.  
- No recovery — forgotten PIN ⇒ clear app data after exports.
- PIN requirement off + no PIN ever set (hand-edited settings row, odd
  upgrade path) — the switch stays visible and routes an "on" tap to the
  set-PIN form instead of hiding itself with no way back.

## FERPA

PIN is a screen gate, not encryption. Does not replace OS disk encryption.
Turning the requirement off is appropriate only on a device that stays with
a teacher — never on an unattended kiosk, since it removes the one gate
between anyone who picks up the device and the roster and dashboard.
Turning it off does **not** gate export or the roster-overwrite import; that
remains deferred (see Out of scope).

## Out of scope

Biometrics; remote PIN reset; multi-teacher accounts. PIN gating on export or
on a roster-overwrite import while the requirement is off — deferred.