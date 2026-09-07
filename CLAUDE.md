# Working in this repo

A pnpm workspace on Replit. Apps live in `artifacts/*`, shared packages in `lib/*`.
Per-app details are in each app's `.claude/skills/`; `replit.md` describes the scanner.

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

`pnpm` only — the root `preinstall` rejects npm and yarn. Vite configs **throw**
unless both `PORT` and `BASE_PATH` are set, including for `build`.

```bash
pnpm --filter @workspace/<app> run test        # vitest
pnpm --filter @workspace/<app> run typecheck   # tsc --noEmit
PORT=<port> BASE_PATH=/ pnpm --filter @workspace/<app> run build
```

There is no ESLint config anywhere in this repo. Don't try to lint.
