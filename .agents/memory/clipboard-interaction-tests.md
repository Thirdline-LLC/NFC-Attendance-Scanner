---
name: Clipboard interaction tests
description: Testing clipboard actions with the attendance scanner's user-event setup
---

When testing a clipboard action with `@testing-library/user-event`, create the user with `userEvent.setup()` before spying on `navigator.clipboard.writeText`; user-event installs its own Clipboard object during setup.

**Why:** Spying on the browser clipboard before user-event setup targets an object that user-event replaces, so the test sees zero calls even though the button handler is running.

**How to apply:** In a test, render/create the user first, then attach the clipboard spy and restore all mocks in `afterEach`.