---
name: Replit browser tests
description: Environment-specific guidance for running Playwright-backed Vitest browser tests in this workspace
---

Vitest's Playwright provider does not automatically discover Replit's managed Chromium binary. Browser test configs in this workspace should explicitly point Playwright at `/repl/tools/bin/chromium` (or a workspace-provided equivalent) rather than assuming Playwright's browser cache has been downloaded.

**Why:** The dependency install succeeds without downloading browser binaries, but the first browser run otherwise fails before any test executes.

**How to apply:** When adding a Playwright-backed browser test, configure the provider's launch options with the managed executable and keep browser installation out of the project dependency workflow.