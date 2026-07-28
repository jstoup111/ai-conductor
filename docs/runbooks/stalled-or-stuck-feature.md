# Stalled or stuck feature

Diagnose and clear a feature that is dispatched but not progressing: no-task-progress stalls,
build-progress ceilings, rate-limit waits, auth parks, and kickback loops. For operators
reading `.pipeline/` state and the daemon log.

## Symptom

Any of these:

- The daemon log shows `▶ start <slug>` and then nothing for a long time.
- `■ done <slug>: halted` or `■ done <slug>: error` appears and the slug stops being dispatched.
- The startup dashboard lists the slug under HALTED instead of IN-PROGRESS or ELIGIBLE.
- The same build step retries repeatedly with the same reason.
- A feature is marked complete but the PR never appeared.

## Diagnosis

All per-feature evidence lives in the feature's own worktree: `.worktrees/<slug>/.pipeline/`.
All daemon-level evidence lives at the main repo root: `.daemon/`.

### 1. Read the halt marker first

```bash
head -1 .worktrees/<slug>/.pipeline/HALT
cat .worktrees/<slug>/.pipeline/HALT.class
```

`.pipeline/HALT` is a full stop for that feature: the daemon never advances, opens a PR, or
merges past it. The first non-empty line of the body is the reason the dashboard surfaces.

`.pipeline/HALT.class` classifies it. It is missing on halts written before the sidecar existed,
and any unrecognized content reads as `unclassified`.

| Class | Meaning | Cleared by the re-kick sweep? |
| --- | --- | --- |
| `needs-human` | Only an operator can resolve it. | No — skipped on every sweep. |
| `mechanical` | The daemon may safely retry it. | Yes, on a base-branch advance. |
| *(absent / unrecognized)* | Treated as `unclassified`. | Yes, subject to the once-per-SHA guard. |

A feature that errored rather than halted gets a diagnostic HALT written for it, so the daemon
log's bare `error` line always has a body to read — **unless the failure happened before the
worktree existed**. If `.worktrees/<slug>` is missing entirely, no HALT was written; go to
[worktree and evidence recovery](worktree-and-evidence-recovery.md).

### 2. Classify the stall

```bash
grep -E 'build_stall|build_no_progress|zero_work_product|rate_limit|credentials_park' \
  .worktrees/<slug>/.pipeline/events.jsonl | tail -20
```

#### `no_task_progress`

The build step's circuit breaker. From attempt 2 onward, the step is declared stalled only when
**both** signals stay pinned across the attempt: the count of resolved plan tasks did not
increase, **and** HEAD did not move. The resolved count is the **union** of two sources:

- rows in `.pipeline/task-status.json` whose `status` is `completed` or `skipped`, and
- plan task ids carried by `Task: <id>` trailers on commits in
  `merge-base(origin/<default-branch>, HEAD)..HEAD`.

So a task committed with a valid `Task:` trailer counts as resolved even if its row was never
flipped. Work committed with **no** `Task:` trailer and no row update is invisible to the
*count* — but not to the breaker, because it still moves HEAD.

**Commit movement is the liveness authority
(adr-2026-07-23-commit-movement-liveness-floor).** The attributed-task count is advisory
routing and telemetry; it never independently proves a build is stuck. An attempt that lands
real, committed-but-un-trailered work moves HEAD while the count stays pinned, and is
classified `unattributed_progress` — telemetry, not a stall — instead of `no_task_progress`.
A SHA read that fails on either side of the attempt is treated fail-closed, degrading to the
old count-only behavior. A genuine wedge (zero commits, count pinned) still stalls and halts
exactly as before: count alone can never kill a build.

If the build step's retry budget then exhausts with at least one HEAD-moving attempt, the run
does **not** take the generic "retries exhausted" HALT. It routes into `build_review` — the
sole completion authority — through the same seam a normally-completed build uses, recording
the unresolved plan task ids in `conduct-state.json` (`build_routed_reason`). That is not an
always-pass: `build_review` re-grades the diff independently and can still FAIL the routed
build, kicking it back to `build` under the same `MAX_KICKBACKS_PER_GATE` bound as any other
`build_review` kickback. A build with zero commit movement across every attempt never routes.

In daemon mode the engine synthesizes a remediation prompt into
`.pipeline/build-stall-question.md` and dispatches `/remediate`, bounded to 2 remediation
rounds per gate. A zero-work stall never terminal-HALTs from that path; it falls through to the
ordinary retry and park route.

#### Step-heartbeat stall (the watchdog already caught it)

If `.pipeline/HALT` reads `Step '<step>' heartbeat stalled: no provider activity in …`, the
step-heartbeat stall watchdog already diagnosed and handled this one for you — no manual
CPU/mtime sampling required. It killed the wedged Claude/Codex subprocess itself and wrote this
`mechanical`-class HALT, so the daemon's ordinary re-kick sweep clears it on the next base-branch
advance without operator action. Check the heartbeat file's last recorded step and age before
clearing anything by hand:

```bash
cat .worktrees/<slug>/.pipeline/step-heartbeat
```

The `step` recorded there is the one whose silence was measured — a heartbeat left behind by an
earlier step is ignored by the watchdog, so a HALT naming step X was always raised against X's own
pulses.

This differs from `no_task_progress`: that breaker only fires between whole build attempts and
requires the retry budget to be in play; the heartbeat watchdog fires mid-dispatch, on any
provider-aware step, purely from subprocess silence, and needs no retry to have happened yet. See
[running the daemon: step heartbeat and the stall
watchdog](../guides/running-the-daemon.md#step-heartbeat-and-the-stall-watchdog) for the
mechanism and `step_heartbeat_stall_minutes` in
[configuration](../reference/configuration.md#step_heartbeat_stall_minutes) for the threshold.
If a step is regularly this slow for legitimate reasons, raise the threshold rather than
repeatedly clearing this halt by hand.

#### `halt_marker`

The `pipeline` skill wrote `.pipeline/halt-user-input-required` — a genuine question that no
retry will answer. Its content becomes the stall question:

```bash
cat .worktrees/<slug>/.pipeline/halt-user-input-required
cat .worktrees/<slug>/.pipeline/build-stall-question.md
```

The build completion gate returns "not done" while that marker exists, so a surviving marker
also blocks the build gate directly.

#### Build-progress ceilings

A build that *is* resolving new tasks re-dispatches without consuming the fixed retry budget,
bounded by the `build_progress_halt` block. Defaults: enabled, `attempt_ceiling: 30`,
`dispatch_ceiling: 20`. Hitting the attempt ceiling parks with a distinct reason so you can tell
"genuinely stuck" apart from "still progressing but out of runway". Key details are in
[configuration](../reference/configuration.md).

#### Rate limits

A rate-limited dispatch emits `rate_limit` and waits — to the deadline parsed from the provider
message when one is available, otherwise 300 seconds. The wait does **not** burn the retry
budget. HALTs written while a rate-limit episode is active are stamped so they can be recovered
when the episode ends.

> **Known limitation.** The episode stamp is in-memory, scoped to the running daemon process.
> Restart the daemon during an episode and its episode-caused halts are no longer recognized as
> recoverable — they must be cleared by hand or by a base-branch advance.
> Tracked in [#1023](https://github.com/jstoup111/ai-conductor/issues/1023).

#### Auth parks

`credentials_park` means the run is waiting on a credential source, not stuck on your code.
`credentials_park_progress` events report readiness probes as they happen. The park times out
after `harness_self_host.auth_park_timeout_minutes` (default 60), then HALTs with an actionable
reason naming the credential to refresh.

```bash
conduct-ts build-auth-status
```

Exit 0 means clean (`state=api-key` when there is no daemon-owned token, or `state=valid`).
Exit 1 covers `missing`, `unreadable`, `invalid`, and `unverifiable`, and prints the remediation
message with the token path.

#### Kickback loops

A gate that blocks routes work back to an earlier step. Each gate allows at most 2 kickbacks;
past that the run halts instead of looping. Separately, a kickback into `build` that ends with
zero net progress **and** an unchanged gate verdict escalates to a halt immediately rather than
spending the remaining budget. Read the verdict that keeps blocking:

```bash
cat .worktrees/<slug>/.pipeline/gates/<step>.json
```

The record is `{ satisfied, reason, checkedAt, kickback }`. `reason` is the exact string the
gate computed. The concepts behind gate verdicts are in [gates](../explanation/gates.md); the
per-step evidence files are listed in [artifacts](../reference/artifacts.md).

#### Setup failures

If the project's `bin/setup` failed inside the worktree, the feature may be quarantined:
`.pipeline/QUARANTINE` exists and a `wip/setup-quarantine-<slug>` branch holds the evidence.

### 3. Re-verify SHIP evidence with `--diagnose`

`--diagnose` re-runs the SHIP-gating completion predicates — `test_suite`, `manual_test`,
`retro`, `finish` — against the on-disk evidence and reports which ones cannot reproduce a pass.
It does not modify feature state.

```bash
conduct-ts inline --diagnose "<feature description>"
```

Run from the main checkout with the feature description, or from inside the worktree with no
description at all (`conduct-ts inline --diagnose`).

| Outcome | Output | Exit |
| --- | --- | --- |
| Evidence consistent | `State OK: … has consistent SHIP-phase evidence.` | 0 |
| No state for that description | `No conductor state found for "<desc>" — nothing to diagnose.` | 0 |
| Evidence gaps | Per-step gap report on stderr, plus remediation guidance | **1** |
| State says past `worktree` but no worktree exists | `Orphaned conductor state in <path>.` | **1** |

A non-zero exit here is the precise signal that the state is marked complete while the evidence
that would justify it is missing. That combination is what silently produced "complete" features
with no PR.

### 4. Read the run timeline with `--report`

```bash
conduct-ts inline --report
```

Read-only. Renders three tables from `.pipeline/events.jsonl` — Step Durations, Retry Hotspots,
and Token Spend — then exits 0. An unreadable events log exits 1. Run it from inside the
worktree; it reads `.pipeline/` relative to the current directory.

> **Known limitation.** `--report` cannot show halts or kickbacks. `loop_halt` and `kickback`
> are among the 28 of 57 event types the engine emits but never registers as readable, so they
> never reach `events.jsonl` and no report can surface them. Use `.pipeline/HALT` and
> `.pipeline/gates/<step>.json` instead. Tracked in [#1023](https://github.com/jstoup111/ai-conductor/issues/1023) and [#1008](https://github.com/jstoup111/ai-conductor/issues/1008).

### 5. Read the daemon's own narrative

```bash
conduct-ts daemon logs --lines 200
```

`.daemon/daemon.log` carries every dispatch line, per-step result, engine warning, and the
startup dashboard snapshot.

> **Known limitation.** The log rotates to `.daemon/daemon.log.1` only when it is reopened and
> already exceeds 1 MB, and no CLI reads the rotated file. A long-running daemon never rotates
> mid-run; once it does, the previous history is only reachable by opening
> `.daemon/daemon.log.1` directly. Tracked in [#1008](https://github.com/jstoup111/ai-conductor/issues/1008).

## Recovery

Pick the branch that matches the diagnosis. Every step says what it changes.

### The stall was a false negative — real work exists

The commits are on the branch but carry no `Task:` trailer, so the resolved-task count cannot
see them and the build completion gate keeps reporting those ids as pending. (The stall breaker
itself is not fooled — those commits move HEAD — but the count still drives the gate.)
Do not re-run the tasks. Make the work visible instead:

1. Confirm the commits exist and check their trailers:
   ```bash
   git -C .worktrees/<slug> log origin/<base-branch>..HEAD \
     --format='%h %s%n  Task: %(trailers:key=Task,valueonly)'
   ```
   Substitute your repository's default branch for `<base-branch>`. A blank `Task:` line means
   that commit is invisible to the stall breaker.
2. Flip the corresponding rows in `.worktrees/<slug>/.pipeline/task-status.json` to
   `"status": "completed"`. **What it changes:** the routing input for the build gate. A row
   already marked `completed` or `skipped` is preserved verbatim across every re-seed, so this
   edit survives.
3. Confirm the gate now sees them:
   ```bash
   conduct-ts inline --diagnose
   ```
   and re-read `.pipeline/gates/build.json` after the next dispatch — its `reason` should no
   longer list those task ids as pending.

`conduct-ts task done <id>` will not help here: it clears the `.pipeline/current-task` stamp and
never modifies `task-status.json`.

### The stall was real — the build genuinely cannot proceed

1. Read `.pipeline/build-stall-question.md` (or `.pipeline/halt-user-input-required`) and act on
   the question: fix the spec, the plan, or the code.
2. Remove the user-input marker if it is still present. **What it changes:** unblocks the build
   completion predicate, which returns "not done" while the file exists.
   ```bash
   rm -f .worktrees/<slug>/.pipeline/halt-user-input-required
   ```
3. Clear the halt (next section).

### Clear a halt and let the feature resume

**Blast radius:** clearing the halt makes the feature eligible for dispatch again on the next
poll. Fix the cause first, or it halts again immediately.

```bash
rm -f .worktrees/<slug>/.pipeline/HALT .worktrees/<slug>/.pipeline/HALT.class
```

**What it changes:** the daemon registers a filesystem watcher on each halted feature's marker
and wakes when it is cleared, so removal is the resume signal. (With `--no-watch` the daemon
relies on polling instead; it still picks the feature up, just on the next poll.)

**How to confirm:** the next dashboard snapshot lists the slug under ELIGIBLE or IN-PROGRESS
rather than HALTED, and the log shows `↻ resume <slug>`.

### An auth park timed out

Refresh the credential the halt body names, then clear the halt as above. Re-check with
`conduct-ts build-auth-status` before clearing — a halt cleared against a still-broken
credential just re-parks and burns the timeout again.

### A rate-limit episode is in progress

Do nothing. The wait is deliberate and does not consume the retry budget. If you must stop the
daemon during an episode, see
[emergency stop a running feature](emergency-stop-a-running-feature.md) — and note that halts
raised during the episode will not be auto-recovered by the replacement process.

### The feature must stop being dispatched entirely

```bash
conduct-ts daemon park <slug>
```

**What it changes:** writes `.daemon/parked/<slug>` at the main repo root, which is checked
before every dispatch and first in the re-kick sweep. Full procedure and the ordering rules are
in [emergency stop a running feature](emergency-stop-a-running-feature.md).

## Verification

1. **No live halt marker remains** for a feature you intended to resume:
   ```bash
   ls .worktrees/<slug>/.pipeline/HALT 2>/dev/null || echo "no halt"
   ```
2. **SHIP evidence re-verifies** — from inside the worktree:
   ```bash
   conduct-ts inline --diagnose
   ```
   Expect exit 0 and `State OK:`. A non-zero exit still names the failing steps.
3. **The blocking gate now passes.** Re-read `.pipeline/gates/<step>.json` after the next
   dispatch: `satisfied` must be `true` and `checkedAt` must be newer than the halt you cleared.
4. **The task count moves.** After the next build attempt, the resolved-task count in
   `.pipeline/task-status.json` (unioned with `Task:` trailers) must be strictly higher than it
   was, and the log must not repeat `build_stall`.
5. **The feature reaches a terminal outcome.** The daemon log shows `■ done <slug>: done` with a
   PR link, not another `halted`/`error` line.

If the feature ships but the daemon keeps re-dispatching it, the shipped record is missing —
see [shipped record reconciliation](shipped-record-reconciliation.md).
