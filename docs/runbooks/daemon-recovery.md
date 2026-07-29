# Daemon recovery

Recover a daemon that will not start, will not stop, holds a stale lock, spins on the same
failure, or runs a stale engine — for one repo or across the fleet. For operators; read
[the hard safety rule](#hard-safety-rule-read-this-before-deleting-anything) before you delete
anything.

> **Not sure this is the right runbook?** Run `/daemon-triage` — it gathers the evidence
> read-only, classifies the failure, and routes to the one runbook that owns it.

## Symptom

| What you see | Section |
| --- | --- |
| `conduct-ts: missing …` or `dist symlink is broken` | [Daemon will not start](#daemon-will-not-start) |
| `Harness install is stale — …` | [Daemon will not start](#daemon-will-not-start) |
| `tmux is not installed or not found on PATH.` | [Daemon will not start](#daemon-will-not-start) |
| `another daemon is already running (pid N) …`, exit 3 | [Lock contention](#lock-contention) |
| `daemon status` shows `○ stale` | [Lock contention](#lock-contention) |
| `daemon status` shows `⚠ session-up/process-dead` | [Orphaned process or session](#orphaned-process-or-session) |
| `daemon status` shows `⏳ restart-pending` | [A restart is queued](#a-restart-is-queued) |
| `daemon status` shows `⏸ paused (process dead)` | [A paused daemon that looks dead](#a-paused-daemon-that-looks-dead) |
| The same feature fails identically on every start | [Spin loops](#spin-loops) |
| `[daemon] engine stale after rebuild — …` | [Stale engine](#stale-engine) |
| Several repos are wrong at once | [Fleet-wide recovery](#fleet-wide-recovery) |

## Diagnosis

Start here regardless of symptom.

```bash
conduct-ts daemon status
conduct-ts daemon logs --lines 100
```

`daemon status` sweeps the project registry and prints, per repo: state badge, name, path, pid,
start time, `version:<engine-version-id>`, pause metadata, the last log line with its mtime, and
`session:up|down`. It exits 0 for the sweep itself — stale and missing entries are *reported*,
not treated as command failures. It exits 1 only when the registry itself cannot be read. An
empty registry prints `No projects registered.` followed by a hint to register one.

Read the state badge first — the Symptom table above routes each failing badge to its recovery
section. All nine badges and what each one means are in
[cli reference](../reference/cli.md#daemon-status).

The daemon's own narrative is `.daemon/daemon.log`. `conduct-ts daemon logs` also accepts
`--repo <path>`, `--all` (iterate the registry, with `==> <path> <==` headers), `--follow`/`-f`
(single repo only; combined with `--all` it prints a downgrade notice and shows a static
snapshot), and `--lines <n>`/`-n <n>` (default: the whole current file).

## Recovery

### Hard safety rule: read this before deleting anything

**Never bulk-delete worktrees or branches.** Do not `rm -rf` over a globbed or computed set
(`for d in .worktrees/*`), and never loop-delete branches. Scope every destructive delete to an
explicit, enumerated list of named paths. Print the list. Confirm it. Then delete.

```bash
# Enumerate and print FIRST — do not pipe this into rm.
git worktree list --porcelain | grep '^worktree '
```

**Shell trap:** `mapfile` and `readarray` are bash builtins with no zsh equivalent. Under zsh the
command fails, the target array stays empty, and the script continues with exit status 0:

```bash
zsh -c 'mapfile -t arr < <(printf "a\nb\n"); echo "count=${#arr[@]}"'
# zsh:1: command not found: mapfile
# count=0
```

Any logic that reads an empty array as "no filter selected" then proceeds unfiltered. A guard
built that way once came back empty and deleted all 74 worktrees instead of the intended 4. Never
guard a delete with an array you have not proven is populated.

### Daemon will not start

Work down in this order — each is a distinct refusal with its own fix.

1. **The engine bundle is missing or broken.** `bin/conduct-ts` refuses before Node ever runs:
   `conduct-ts: missing <path>/dist/index.js` with `run 'npm run build' in src/conductor/`, or
   `conduct-ts: dist symlink is broken (<path>)` with `run 'npm run build' to rebuild, or
   republish the engine, to fix it`. Both exit 1.
   ```bash
   cd src/conductor && npm run build
   ```
   **Confirm:** `conduct-ts --help` prints the command list.

2. **The harness install is stale.** `daemon start` runs an install-freshness check *before*
   launching anything — a stale install never starts a daemon. It prints `Harness install is
   stale — one or more skills are missing or out of date in ~/.claude/skills or
   ~/.agents/skills. …` On a TTY it offers `Run \`bin/install --update\` now? [y/N]`; declining
   throws `Declined the harness install refresh — not starting on a stale install.`
   Non-interactively it throws immediately.
   ```bash
   ./bin/install --update
   ```
   **Confirm:** `./bin/install --check` exits 0 (clean) or 2 (unrelated installer readiness);
   both are accepted by the freshness gate.

3. **tmux is missing.** `daemon start`, `stop`, `restart`, `connect`, and `debug` all host the
   daemon in tmux and fail with `tmux is not installed or not found on PATH. Please install
   tmux to use daemon hosting.` (exit 1). Install tmux. A bare `conduct-ts daemon` run needs no
   tmux, but you lose session hosting, attach, and in-place restart.

4. **Another daemon already owns the repo.** See the next section.

### Lock contention

One daemon per repo, arbitrated by an `O_EXCL`-created pidfile at `.daemon/daemon.pid`. The
record is JSON: `pid`, `uuid`, `startedAt`, and usually `engineDir`.

- On startup the daemon tries to acquire. If a **live** owner holds it, it polls for up to 10
  seconds at 250 ms intervals, then logs `another daemon is already running (pid <n>) engineDir
  <dir> for <path>; exiting` and **exits 3**.
- If the recorded pid is **dead**, the lock is reclaimed automatically (unlink and re-create via
  `O_EXCL`) — a stale pidfile self-heals and needs no operator action. Liveness is conservative:
  a permission error on the probe counts as alive and is never reclaimed.
- Records carrying `transient: true` are handoff records briefly held by a CLI process, not by a
  running daemon. Do not read one as "a daemon is running".

**Recovery when a stale or contended lock will not clear:**

```bash
conduct-ts daemon restart
```

**What it changes:** clears a stale or absent lock through the same acquire/reclaim primitives
(a live owner is left untouched — that is the process the respawn is about to replace),
reconciles an orphaned process, relinks harness skills, then respawns the tmux session.
**Blast radius:** the running daemon process is replaced. In-flight work in that session is
interrupted unless the daemon is idle — which is why `restart` refuses to interrupt a busy
daemon; see [A restart is queued](#a-restart-is-queued).

**Confirm:** `conduct-ts daemon status` shows `● running` with a new pid, and the restart
outcome message is printed (degraded restarts — where the session had to be killed and
recreated, losing scrollback — are always reported explicitly).

**Blast radius of deleting the pidfile by hand:** do not. Removing `.daemon/daemon.pid` while a
daemon is live lets a second daemon win the `O_EXCL` race and run concurrently against the same
repo — two builders, one worktree tree. The dead-pid reclaim path already handles every case
where deletion would be safe.

### Orphaned process or session

`⚠ session-up/process-dead` means the tmux session exists but the recorded daemon process is
gone. The mirror case — process alive, session gone — is what `restart` calls an orphan.

```bash
conduct-ts daemon restart
```

**What it changes:** when it detects a pidfile whose process is alive but whose tmux session is
absent, it sends SIGTERM, waits 100 ms, sends SIGKILL if the process is still alive, then
reclaims the lock. It prints `orphaned daemon process (pid <n>) terminated; lock reclaimed.`

**Confirm:** `conduct-ts daemon status` no longer shows `⚠` or `○ stale` for this repo.

### A restart is queued

`restart` never blocks. When the daemon is busy it writes `.daemon/RESTART-PENDING` and returns
at once with `restart queued: daemon is busy on <slug>; it will restart automatically once
idle.` The marker carries `requestedAt`, and optionally `requestedBy` and `blockingSlug`.

- Consume-once: the marker is removed and its intent acted on exactly once, at the next daemon
  boot. A crash before firing leaves it on disk to be consumed by the next boot. It can never
  fire twice or dangle.
- Re-requesting a restart refreshes the payload rather than queueing a second one.
- **A paused daemon counts as idle.** `restart` short-circuits the busy probe when
  `.daemon/PAUSED` exists and respawns immediately. Pause does not defer a restart.

To restart now rather than waiting on the blocking feature, park that feature and stop the
daemon first — see
[emergency stop a running feature](emergency-stop-a-running-feature.md).

**Confirm:** `conduct-ts daemon status` drops the `⏳ restart-pending` badge and reports
`● running` with a new pid.

### A paused daemon that looks dead

`.daemon/PAUSED` is authoritative by existence; its JSON body (`pausedAt`, `pausedBy`) is
informational only. The check is **fail-closed** — any read error other than "file not found" is
treated as paused, so an unreadable marker keeps the daemon stood down.

```bash
conduct-ts daemon resume
```

**What it changes:** removes `.daemon/PAUSED`. Prints `daemon resumed`, or `not paused` if there
was no marker. **Confirm:** `conduct-ts daemon status` no longer shows `⏸`.

### Spin loops

The characteristic shape: the daemon starts, picks the same feature, fails the same way, and the
failure never becomes durable.

#### `git worktree add` exits 128 on every attempt

Cause: `.worktrees/<slug>` was deleted without `git worktree prune`, so git still counts it as
registered. Every recreate attempt fails with `fatal: '.worktrees/<slug>' is a missing but
already registered worktree`.

Worse, the failure happens *before* a worktree exists, so no `.pipeline/HALT` is written. Nothing
durable records it: an errored feature is excluded only for the lifetime of the current daemon
run, and comes straight back on the next start or on the next base-branch re-kick sweep.

Fix, in order — park, prune, recreate, unpark — in
[worktree and evidence recovery](worktree-and-evidence-recovery.md). Do not unpark before the
repair is verified.

#### A feature halts, is cleared, and halts again immediately

Read the halt body before clearing it. Clearing a halt without fixing the cause just puts the
feature back in the rotation to fail again. Diagnosis is in
[stalled or stuck feature](stalled-or-stuck-feature.md).

#### The project's `bin/setup` fails in every worktree

The feature is quarantined: `.pipeline/QUARANTINE` in the worktree and a
`wip/setup-quarantine-<slug>` branch holding the evidence. Fix `bin/setup` in the repo, not in
the worktree — every new worktree re-runs it.

#### A feature that already shipped keeps being re-dispatched

That is not a daemon fault. It is a missing shipped record — see
[shipped record reconciliation](shipped-record-reconciliation.md).

**Emergency brake for any spin:** park the offending slug. It is honored before every dispatch
*and* first in the re-kick sweep, so it stops the loop without stopping the daemon.

```bash
conduct-ts daemon park <slug>
```

### Stale engine

When the daemon builds the harness itself, it checks at idle boundaries whether the engine it is
running matches the engine on disk. If it drifted, it fast-forwards the engine source, rebuilds,
and — if still stale — requests a restart, logging
`[daemon] engine stale after rebuild — captured: <id>, target: <id> — restarting before next
task`. Source refresh and rebuild failures are logged and degrade to the current engine; they are
never fatal.

When self-heal is off (or the repo is not self-hosting), the same boundary runs an advisory
staleness probe only — it warns, never rebuilds, never restarts.

Each launched process pins the resolved `dist-versions/<id>/index.js` rather than the floating
`dist` symlink, so a republish mid-run cannot change the engine under a running daemon. That is
also why `daemon status` prints `version:<engine-version-id>`: two repos on different engine
versions is expected and visible.

**Recovery:** rebuild, then restart.

```bash
cd src/conductor && npm run build
conduct-ts daemon restart
```

**Confirm:** `conduct-ts daemon status` prints the expected `version:` id for the repo, and the
log stops repeating the staleness line. Self-hosting specifics are in
[self-hosting](../guides/self-hosting.md).

### Fleet-wide recovery

`pause`, `resume`, and `restart` accept a fleet selector: `--all`, or one or more bare repo
names. With a selector the verb iterates the project registry instead of acting on the current
directory. Each repo gets its own error handling, so one failure never aborts the sweep.

```bash
conduct-ts daemon pause --all
conduct-ts daemon restart --all
conduct-ts daemon resume --all
```

Per-repo `restart` outcomes: paused → respawn, idle → respawn, busy → queued (marker written),
stopped with no session → `daemon started (was stopped)`, error → reported and the sweep
continues.

**Blast radius:** `--all` touches every registered project, including ones you are not thinking
about. Enumerate first:

```bash
conduct-ts daemon status
```

**Confirm:** re-run `conduct-ts daemon status` and check every row individually. A sweep that
reports errors for some repos still exits after attempting all of them.

## Verification

1. **The repo has exactly one live daemon:**
   ```bash
   conduct-ts daemon status
   ```
   Expect one `● running` row for this repo, with a plausible `pid` and `since`.
2. **The lock matches the process.** The `pid` in `.daemon/daemon.pid` is the pid `daemon status`
   reports, and that process exists:
   ```bash
   ps -p <pid>
   ```
3. **No queued restart is dangling:**
   ```bash
   ls .daemon/RESTART-PENDING 2>/dev/null || echo "none queued"
   ```
4. **The daemon is making progress, not looping.** The log advances past the startup dashboard
   into dispatch lines, and no single slug repeats the same failure:
   ```bash
   conduct-ts daemon logs --lines 60
   ```
5. **The worktree registry is consistent** — no `prunable` entries:
   ```bash
   git worktree list --porcelain
   ```
6. **Nothing was deleted that you did not name.** Confirm the branches you expect still exist:
   ```bash
   git for-each-ref --format='%(refname:short)' refs/heads/feat
   ```

Flag semantics for every daemon subcommand live in [the CLI reference](../reference/cli.md);
day-to-day start/stop/park procedure is in
[running the daemon](../guides/running-the-daemon.md).
