# Working in this repo

A pnpm workspace. Apps live in `artifacts/*`, shared packages in `lib/*`.
Per-app details are in each app's `.claude/skills/`; `replit.md` describes the
scanner and `README.md` is the entry point for a local checkout.

**The scanner is no longer Replit-specific.** It builds for three targets — an
installable PWA, an Android APK and a macOS `.dmg` — from one source tree, and
develops on any machine with Node 22+ and pnpm. `docs/vscode-setup.md` is the
full guide. Everything in the "Several Claude sessions share ONE checkout" and
"Never `pkill -f vite`" sections below applies **only when running inside the
Replit container**; on a local checkout or a Codespace there is no runner, no
port 23205, and `pnpm ... run dev` on 5173 is simply correct.

## Agents work on code and docs only

Coding agents (Claude, Cursor, Copilot, and any other bot session in this
repo) may edit source, tests, docs, and tooling. They must **never**:

- open, download, or read a live attendance workbook, a roster export, or a
  live tap log from OneDrive, desktop Downloads, or a device;
- ask an operator to paste student names, school emails, or card UIDs into
  chat, issues, or commit messages;
- invent a parallel "scratch" copy of production student data for debugging.

Synthetic fixtures and invented examples in the repo are fine. Real student
records stay with the school. See `docs/vscode-setup.md` §7 and
`docs/data-and-backup.md`.

## Several Claude sessions share ONE checkout

Every session runs in `/home/runner/workspace` — the same files on disk, the same
branch. `git checkout -b` therefore isolates nothing: it moves the branch pointer
under everyone. Before assuming a stray edit, dev server, or commit is yours, check:
`git log --oneline -5`, `pgrep -af 'bin/vit[e].js'`.

**Use a worktree** (`EnterWorktree`) when your work would collide with that:
a multi-file or risky change while another session is active, or something
experimental you may throw away. `.claude/settings.json` is already configured for
it — new worktrees branch from local `HEAD` (this repo has no `origin`) and get all
nine `node_modules` directories symlinked in, so `pnpm test`/`typecheck`/`build`
work inside one immediately. Verified: 111/111 tests pass in a fresh worktree.

**Stay in the main checkout** for small edits, and whenever you need the Replit
preview — the runner only serves `/home/runner/workspace`, so changes in a worktree
never reach the preview URL until they land on `main`.

Commit small, verified changes straight to `main` (all history is on `main`;
there is no remote to open a PR against). Merge a worktree back when it is green.

## Never `pkill -f vite`

It kills every dev server in the container, including the Replit runner's, and the
preview then shows *"artifact crashed"* with `ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL` and
`SIGTERM` — even though Vite reached `ready` and printed no error. That message is a
shutdown notice, not a crash. Kill by PID (`lsof -t -i :<port> -sTCP:LISTEN`).

`pkill -f "<pattern>"` also kills the shell running it whenever the pattern appears
in that shell's own command line — the command dies with **exit 144** and no output,
which looks exactly like the thing you launched crashing on startup.

## One dev server per app

The Replit runner already serves each app on the `localPort` in its
`.replit-artifact` (the scanner: **23205**). Check before starting anything:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:23205/   # 200 => use it
```

Don't start a second server for an app in the main checkout. Inside a worktree, if
you must drive the app, use a free port and point the driver at it with `APP_URL`.

## Commands

`pnpm` only — the root `preinstall` rejects npm and yarn.

**The scanner's vite config no longer requires `PORT` and `BASE_PATH`.** It
takes a `BUILD_TARGET` of `web`, `capacitor` or `electron`, defaults the port
to 5173, and derives the asset base. Both variables are still honoured when
set, so the Replit runner's environment keeps working. `mockup-sandbox` still
throws without them.

```bash
pnpm --filter @workspace/<app> run test        # vitest
pnpm --filter @workspace/<app> run typecheck   # tsc --noEmit
pnpm --filter @workspace/nfc-attendance-scanner run build            # PWA
pnpm --filter @workspace/nfc-attendance-scanner run build:native     # Capacitor
pnpm --filter @workspace/nfc-attendance-scanner run build:electron   # macOS
PORT=<port> BASE_PATH=/ pnpm --filter @workspace/mockup-sandbox run build
```

There is no ESLint config anywhere in this repo. Don't try to lint.

## `allowBuilds` is not optional

pnpm 11 treats an un-approved install script as an **error**, and the
dependency-status check runs before every `pnpm run`. A dependency with a
postinstall that is missing from `allowBuilds:` in `pnpm-workspace.yaml` — or
given a non-boolean value — makes every script in the workspace fail. Add new
ones there, or run `pnpm approve-builds`.
