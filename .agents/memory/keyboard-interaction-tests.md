---
name: Keyboard interaction tests
description: Testing conventions for native keyboard activation in the attendance scanner
---

When testing native button activation with `@testing-library/user-event`, use the physical key-code form `[Space]` for the Space key; `{Space}` is parsed as a literal key name that does not activate the button in this setup. Opening the roster editor also moves focus into its first field, so refocus the row action before testing a second action key.

**Why:** The test environment’s keyboard descriptor parser distinguishes physical codes from key values, and the editor intentionally places focus in the form for efficient keyboard entry.

**How to apply:** Use `[Space]` for Space-key regressions and assert focus transitions explicitly when a roster action opens or closes an inline editor.