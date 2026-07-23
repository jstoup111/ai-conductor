# Track: Missing session-hook files terminally HALT a build (#896)

Track: technical

## Rationale

Internal engine correctness fix at the build-dispatch preflight seam. No user-facing product
capability, no new command, no product requirements to enumerate → technical track (skip `/prd`).

## Problem (restated from evidence, not from the filer's hypothesis)

`checkAttributionMachineryIntact` (`src/conductor/src/engine/conductor.ts:727-746`) returns a
terminal diagnostic when any of `.pipeline/session-hooks/{pre-dispatch,post-dispatch,mutation-gate}.sh`
is absent. The conductor consumes that string at `conductor.ts:3200-3227` as `machineryIssue`,
which (a) suppresses `writeBuildStepMarker`, and (b) short-circuits the step into
`{ success: false, output: machineryIssue }` — a deterministic failure that re-fails identically
on every retry and ends in a terminal HALT.

Observed in `.daemon/daemon.log.1`: 1 retry + terminal HALT on
`acceptance-specs-halts-when-the-red-evidence-marke` (14:40:01Z, 2026-07-21) and on
`build-progress-marker-stays-0-n-for-the-whole-buil` (00:35:30Z, 2026-07-22).

**Correction to the intake's count.** The third cited feature,
`demote-task-stamping-to-telemetry`, halted at 02:26:25Z on the *plan-unresolvable* branch
(`"plan could not be resolved — cannot seed task-status.json"`), a different branch of the same
guard. So the session-hooks branch caused **2** terminal HALTs, not 3. The third is out of scope.

**The failure is mid-build, not at provisioning.** At 14:40:01Z the same feature had just logged
`build retry (try 2/3: 1/13 tasks pending/not completed: 12) 10→12 tasks` — 12 of 13 tasks were
already resolved. The hooks were provisioned correctly by `prepareWorktree` and then *disappeared
mid-loop* (the `.pipeline`-wipe class of failure, cf. `.docs/stories/mid-loop-pipeline-wipe-549.md`).
This is decisive for the design: the condition is a **transient, fully repairable** loss of a
regenerable engine asset, not a structural defect in the worktree.

## Load-bearing investigation: is there still a live *gating* consumer?

The intake's premise is that these hooks feed only the attribution lane that #773 (merged as
PR #834, `115f0556`) deleted, so the gate guards nothing. **That premise is false.** Verified:

**What #773 actually retired** (confirmed by reading the code, not the commit message):
- `attribution-validate.ts` / `validateCitations` / `runAttributionLane` — deleted (`115f0556`).
- `detectZeroWorkProduct` (`attribution-enforcement.ts:174-183`) — pinned `return false`
  unconditionally, explicitly "demoted from a gate to telemetry".
- `commit-msg` Surface A evidence rejection (`git-hook-assets.ts:150-152`) — "commit evidence
  rejection is retired".
- `attribution_verify` step (`steps.ts:289-298`) — `enforcement: 'advisory'`. Confirmed. 0
  occurrences in either daemon log.

**What #773 did NOT retire — the live gating consumers of these hooks' output:**

1. **`mutation-gate.sh` is a live enforcement gate (#505 Surface B), not telemetry.** It reads
   `.pipeline/current-task` — the stamp written by `pre-dispatch.sh` — and `exit 2`-blocks
   `Edit`/`Write`/`NotebookEdit` and invocation-position `git commit` whenever
   `.pipeline/build-step-active` is present and the stamp is absent
   (`session-hook-assets.ts:305-400`). Its arming marker is still written on every enforced build
   step: `writeBuildStepMarker(this.projectRoot)` at `conductor.ts:3207`. Both matcher entries are
   still wired into `.claude/settings.local.json` by `wireSessionHookSettings`
   (`worktree-prepare.ts:199-210`). Nothing about this lane is dead.

2. **The `Task:` trailer chain still feeds a gating stall breaker.** `pre-dispatch.sh` stamps
   `.pipeline/current-task`; the `prepare-commit-msg` git hook stamps a `Task:` trailer from that
   stamp (`git-hook-assets.ts:12-15`); `resolveTaskIds` (`task-progress.ts:62`) unions
   trailer-carried ids with `completed`/`skipped` rows; `countResolvedTasks` feeds the
   `no_task_progress` stall breaker at `conductor.ts:3768-3776`, which sets
   `lastBuildStallReason` and drives a terminal HALT. Per CLAUDE.md the *trailer* is telemetry for
   build-completion purposes (`build_review` judges plan-vs-diff), but the resolved-task **count**
   is still gating for stall detection.

3. `.pipeline/dispatch-count` (appended by `pre-dispatch.sh`) — genuinely telemetry only:
   `detectZeroWorkProduct` is pinned false and `detectUnattributedDispatch`
   (`attribution-enforcement.ts:205-218`) only emits the `unattributed_dispatch` event.

**Conclusion: a live gating consumer exists.** Deleting the preflight branch outright, or demoting
it to a bare warning, is therefore *not* safe as-specced. Worse, demote-to-advisory is actively
harmful: it makes `machineryIssue` null, so `writeBuildStepMarker` fires
(`conductor.ts:3204-3207`) and arms an enforcement surface whose script does not exist — silently
converting a fail-closed write gate into a no-op for the whole build step.

## Approaches considered

**A. Delete the branch (the intake's primary hypothesis).** Rejected — see above. Also strictly
worse than today at the *outcome* level: the build proceeds unstamped, no `Task:` trailers are
written, `countResolvedTasks` under-counts, and the build HALTs later on `no_task_progress`
instead. A loud early HALT is traded for a slow confusing one.

**B. Demote the branch to a warning.** Rejected — same under-counting, plus it arms the mutation
gate against a missing script (silent loss of #505 Surface B enforcement for that step).

**C. Repair-then-recheck (chosen).** Session hooks are pure, stateless, regenerable engine
assets — the exact byte content of `PRE_DISPATCH_HOOK` / `POST_DISPATCH_HOOK` /
`MUTATION_GATE_HOOK` / `DOCS_GUARD_HOOK` in `session-hook-assets.ts`. Nothing about restoring them
is ambiguous or lossy. So the guard re-provisions them in place (and re-merges the settings
wiring), logs the repair, and re-checks — HALTing only if the repair itself fails, which means the
worktree is unwritable, a genuine correctness precondition already HALTed one branch later by the
`current-task` stamp-path-writability check.

**Direct in-repo precedent.** The sibling branch of this *same guard* had this *same* defect and
was fixed exactly this way: `task-status.json` missing used to HALT, and
`seedAndCheckAttributionMachinery` (`conductor.ts:668-686`) now seeds it from the resolvable plan
immediately before the check rather than deleting the branch
(`.docs/stories/fresh-build-dispatch-halts-immediately-with-attrib.md`). Approach C makes the
session-hooks branch symmetric with the branch beside it.

This also satisfies the repo Design Principle: the durable fix is deterministic machinery that
repairs at the moment of the fault, not prose or a removed check.
