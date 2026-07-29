# Emergency stop a running feature

Stop one feature — or the whole daemon — mid-flight without corrupting state. For operators
who need to halt work already in progress and then touch git state safely.

> **Not sure this is the right runbook?** Run `/daemon-triage` — it gathers the evidence
> read-only, classifies the failure, and routes to the one runbook that owns it.

The order is not negotiable: **park, then stop, then touch git.** Every step below states what
it changes on disk and how to confirm it landed.

## Symptom

One of these is true:

- A feature is building the wrong thing, or its spec is wrong, and you want it to stop now.
- A build is burning budget with no visible progress and you want it out of the rotation.
- You need to delete, move, or rewrite a feature's branch or worktree.
- The daemon is dispatching work you did not intend and you want the whole loop to stand down.

## Diagnosis

### Identify the slug

Every daemon-side artifact for a feature is keyed by its **slug**, which is the plan file stem:
`.docs/plans/<slug>.md` → slug `<slug>`. The build worktree is `.worktrees/<slug>` and its
branch is `feat/daemon-<slug>`.

```bash
ls .docs/plans/
git worktree list
```

### Find out what is actually running

```bash
conduct-ts daemon status
conduct-ts daemon logs --lines 60
```

`daemon status` sweeps the project registry and prints one badge line per repo. `● running`
means a live daemon owns `.daemon/daemon.pid` and can dispatch; anything else means it cannot.
The full state vocabulary is in [daemon recovery](daemon-recovery.md).

The startup dashboard in `.daemon/daemon.log` groups every known slug into exactly one of
PARKED, HALTED, PROCESSED, IN-PROGRESS, GATED, WAITING, ELIGIBLE. PARKED has absolute
precedence — a parked slug never appears anywhere else.

### Decide the scope

- **One feature, daemon keeps running** → park the slug (Recovery step 1) and stop there.
- **Everything, temporarily** → park the slug you care about, then pause the daemon.
- **Everything, and you are about to rewrite git state** → park, pause, then stop.

## Recovery

### 1. Park the feature first

```bash
conduct-ts daemon park <slug>
```

**What it changes:** writes `.daemon/parked/<slug>` under the *main* repo root. The command
resolves that root itself via `git rev-parse --git-common-dir`, so it works from inside any
worktree. It validates the slug first: if neither `.docs/plans/<slug>.md` nor
`.worktrees/<slug>` exists it prints `error: slug '<slug>' not found under <root> …` and exits 1
without writing anything.

**How to confirm:**

```bash
ls .daemon/parked/
```

Run that from the main checkout — `.daemon/` lives at the main repo root, not in the worktree.
Success prints `Parked '<slug>' — it will not be dispatched or re-kicked until unparked.` plus
the marker path. Re-parking an already-parked slug is a no-op that prints
`'<slug>' is already parked (originally parked at <timestamp>) — no change.`

A park is honored in two places: the daemon re-checks it immediately before every build start
(closing the selection-to-dispatch race), and the HALT re-kick sweep checks it **first**, ahead
of everything else, so a parked feature survives every base-branch advance.

> **Known limitation.** A park does not interrupt a dispatch that has already started. The
> in-flight build runs to its own conclusion; the park takes effect at the next dispatch
> boundary. To stop work already in progress, continue to step 2.

### 2. Pause or stop the daemon

Pause when you want the loop to stand down but keep the tmux session:

```bash
conduct-ts daemon pause
```

**What it changes:** writes `.daemon/PAUSED` (a JSON body carrying `pausedAt` — the body is
informational; existence is what counts). The check is fail-closed: any read error other than
"file not found" is treated as paused. Prints `daemon paused`, or `already paused`.

Stop when you are about to rewrite git state:

```bash
conduct-ts daemon stop
```

**What it changes:** kills the tmux session hosting the daemon. **Blast radius:** any in-flight
build in that session is terminated where it stands; its worktree and branch are left on disk,
and its `.pipeline/` state stops at whatever step it reached.

For a graceful drain instead of a kill, send SIGTERM to the daemon process. It drains in-flight
work for up to 30 seconds before releasing its lock. `conduct-ts daemon status` prints the pid;
it is also the `pid` field of the JSON in `.daemon/daemon.pid`.

```bash
kill -TERM <pid>
```

**How to confirm:** `conduct-ts daemon status` reports `⏸ paused` or `· stopped` for this repo.

### 3. Stopping an interactive run instead

An interactive `conduct-ts inline …` run is stopped with Ctrl-C. The signal handler writes
`.pipeline/conduct-state.json` before exiting with code 130, so the run is resumable. Do not
`kill -9` it — that skips the state write and leaves the last step's status unrecorded.

### 4. Only now touch git state

With the slug parked and the daemon paused or stopped, the worktree and branch are yours.

**Blast radius before you delete anything:**

- Removing `.worktrees/<slug>` destroys that worktree's `.pipeline/` directory — the run state,
  the task status file, the evidence sidecar, and the gate verdicts. That loss is recoverable
  but not free; see [worktree and evidence recovery](worktree-and-evidence-recovery.md).
- Deleting `feat/daemon-<slug>` destroys the commits. The branch is the source of truth. There
  is no other copy of the build's work.

Remove a worktree the way git expects, so the registration goes with it:

```bash
git worktree remove --force .worktrees/<slug>
```

If you already deleted the directory with `rm -rf`, the registration survives and every
subsequent `git worktree add` for that path fails with exit 128
(`fatal: '.worktrees/<slug>' is a missing but already registered worktree`). Clear it:

```bash
git worktree prune
```

Scope every delete to an explicit, named path. Never glob or loop over `.worktrees/*` — see the
hard rule in [daemon recovery](daemon-recovery.md).

### 5. Never unpark, then delete

Unparking makes the slug eligible again on the very next poll. If you delete its worktree or
branch after unparking, the daemon re-dispatches into the wreckage:

- A directory removed without `git worktree prune` still counts as registered, so the engine's
  reconcile step reports the worktree "reused" and hands the build a path that does not exist.
- A fresh `git worktree add` against that stale registration exits 128 on every attempt.
- Because the failure happens *before* a worktree exists, no `.pipeline/HALT` marker is written.
  Nothing durable records the failure — the feature is excluded only for the lifetime of the
  current daemon run and comes straight back on the next start or re-kick sweep.

Finish the git work first. Unpark last:

```bash
conduct-ts daemon unpark <slug>
```

**What it changes:** resets the no-evidence attempt counter (in `.worktrees/<slug>` when it
exists, otherwise at the repo root), then removes `.daemon/parked/<slug>`. The order matters —
a failed counter reset leaves the marker in place so you can retry.

## Verification

Work through all four:

1. **The park marker exists** (or is gone, if you unparked):
   ```bash
   ls .daemon/parked/
   ```
2. **The daemon is in the state you intended:**
   ```bash
   conduct-ts daemon status
   ```
   Expect `⏸ paused` or `· stopped`, and no `● running` badge for this repo.
3. **The worktree registry is consistent** — no entry is marked `prunable`:
   ```bash
   git worktree list --porcelain
   ```
4. **The feature is not dispatched on the next poll.** Resume the daemon and read the startup
   dashboard: the slug must appear under PARKED and nowhere else.
   ```bash
   conduct-ts daemon resume
   conduct-ts daemon logs --lines 40
   ```

If the feature is dispatched anyway, the park marker is not where the daemon is looking — it is
resolved against the main repo root, not the worktree you ran the command from. Re-run
`conduct-ts daemon park <slug>` from the main checkout and confirm the printed marker path.

Related: [stalled or stuck feature](stalled-or-stuck-feature.md) for a feature that is running
but not progressing, and [daemon recovery](daemon-recovery.md) for a daemon that will not start
or stop cleanly.
