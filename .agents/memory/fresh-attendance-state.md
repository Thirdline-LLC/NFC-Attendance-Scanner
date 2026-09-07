---
name: Fresh attendance state
description: Concurrency rule for IndexedDB reads and live scanner state
---

When an IndexedDB read overlaps a physical tap or session rotation, its snapshot
may be valid storage data but stale UI data. Newer tap and session state must win
when the read resolves.

**Why:** A front-desk tap can arrive while the app is opening or recovering its
store. Replacing the live count with the older read makes a successfully saved
attendance event appear to disappear.

**How to apply:** Any future load, retry, or rehydration path must compare its
read snapshot with intervening writes and the current session before replacing
the displayed taps or count.