# Emergency Stop: Halting a Running Feature

## Overview

This runbook covers the fastest safe way to stop a feature that is actively
being worked on — by a live/finish session or by the daemon's own dispatch
loop — when it is heading toward a bad outcome and you cannot wait for the
normal SDLC gates to catch it.

**Motivating incident (#520 — the "false ship" episode):** a feature's
finish/ship flow reported success and merged before the operator noticed the
underlying work was incomplete. By the time the report was read, the branch
had already landed. The gap: there was no fast, reliable way to halt a
feature mid-flight from wherever the operator happened to be — the operator
had to `cd` back to the repo root before `conduct daemon park` would even
resolve the marker path correctly.

**This runbook (#534 — park/unpark resolve the repo root from any cwd)**
closes that gap. `conduct daemon park <slug>` now resolves the repo root
independent of the caller's current working directory, so it is safe to run
from *inside the feature's own worktree* (e.g.
`.worktrees/<slug>/some/deep/path`) — exactly where an operator watching a
runaway session is likely to already be sitting.

**When to use this runbook:**

- A live or finish-phase session looks like it is about to push, merge, or
  ship something wrong (bad diff, skipped gate, hallucinated evidence,
  scope creep).
- A daemon-dispatched feature is runaway — looping, re-kicking repeatedly,
  or burning cycles without converging.
- You need to stop the work **now**, before the next commit/push/merge
  lands, and sort out the "why" afterward.

**What this runbook does NOT do:** it does not fix the underlying feature,
resolve the root cause, or clean up any bad commits already pushed. It only
stops further automated progress. Follow up with the normal debugging /
retro process once the feature is safely parked.

---

## Step 1: Park the Feature

Run the park command with the feature's slug. This works from **any**
directory — including a subdirectory inside the feature's own worktree — so
you do not need to navigate back to the repo root first:

```bash
conduct daemon park <slug>
```

Example, run from inside the feature's own worktree while watching it go
sideways:

```bash
cd .worktrees/park-and-unpark-resolve-the-repo-root-from-any-cwd/src/some/nested/dir
conduct daemon park park-and-unpark-resolve-the-repo-root-from-any-cwd
```

Parking is idempotent — if the feature is already parked, the command
reports the original park time and makes no change. It does not kill any
in-flight process by itself (see Step 3); it only sets the marker that
prevents the daemon from dispatching or re-kicking this feature going
forward.

If the command reports `error: slug '<slug>' not found in plans/ or
worktrees/`, double-check the slug — park refuses to write a marker for an
unknown slug rather than silently doing nothing useful.

## Step 2: Confirm the Marker

Verify the park actually took effect by checking for the marker file at the
repo root (not the worktree):

```bash
cat .daemon/parked/<slug>
```

- If the file exists, the feature is parked. Its first line is the
  timestamp the park was recorded.
- If the file does not exist, the park did not take effect — re-run Step 1
  and check for an error message before proceeding to Step 3.

You can also list everything currently parked:

```bash
ls .daemon/parked/
```

## Step 3: Kill the Running Process

Parking stops **future** dispatch — it does not interrupt a session that is
already mid-run. If a live/finish session or agent process is actively
executing against this feature, kill it directly:

- **If it's running in a tmux pane or session**, find and kill the session:

  ```bash
  tmux list-sessions
  tmux kill-session -t <session-name>
  ```

- **If it's a foreground/attached process**, `Ctrl-C` it, or from another
  terminal find and kill the PID:

  ```bash
  ps aux | grep <slug>
  kill <pid>
  ```

Do this **after** confirming the park marker in Step 2, so that even if the
kill is imperfect (e.g. a child process survives), the daemon will not
re-kick or re-dispatch the feature behind your back.

## Step 4: Verify Nothing Landed

Before considering the feature safely stopped, confirm no bad state made it
past you:

```bash
git -C .worktrees/<slug> status
git -C .worktrees/<slug> log --oneline -5
git log --oneline -5 origin/main
```

If a push or merge already happened before you parked, this runbook has
reached its limit — proceed to your incident/retro process (this is exactly
the #520 scenario) rather than trying to force a revert through this
runbook.

---

## Resuming Work

Once the feature has been investigated and it's safe to resume, unpark it:

```bash
conduct daemon unpark <slug>
```

This also resolves the repo root independent of cwd. If the feature was
auto-parked (not operator-parked), unparking additionally resets the
no-evidence retry counter so normal dispatch and re-kick behavior resumes
cleanly.

---

## Summary

1. **Park** — `conduct daemon park <slug>`, runnable from anywhere,
   including inside the feature's own worktree.
2. **Confirm** — check `.daemon/parked/<slug>` exists at the repo root.
3. **Kill** — stop the actual running session/process (tmux session or PID)
   directly; parking alone does not interrupt in-flight work.
4. **Verify** — check the worktree and `origin/main` for anything that may
   have already landed before you intervened.

**Remember:** parking prevents future dispatch, it does not undo work
already in flight or already pushed. Speed matters — the whole point of
resolving the repo root from any cwd (#534) is that you should never need to
`cd` away from a runaway feature to stop it.
