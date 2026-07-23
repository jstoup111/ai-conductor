# ADR: Repair missing session hooks at the build preflight instead of removing the gate

**Status:** APPROVED
**Date:** 2026-07-23
**Issue:** jstoup111/ai-conductor#896
**Supersedes:** nothing. **Related:** #676 (guard introduced), #505 (mutation gate / Surface B),
#773 + PR #834 / `115f0556` (attribution lane removal), #549 (mid-loop `.pipeline` wipe).

## Context

`checkAttributionMachineryIntact` (`conductor.ts:727-746`) returns a terminal diagnostic when any
of `.pipeline/session-hooks/{pre-dispatch,post-dispatch,mutation-gate}.sh` is missing. The
conductor turns that into `{ success: false }` at `conductor.ts:3225-3227`, which re-fails
identically on every retry and terminates in a HALT. Two builds died this way
(`.daemon/daemon.log.1`, 2026-07-21T14:40:01Z and 2026-07-22T00:35:30Z), one of them at 12 of 13
tasks resolved.

#896 proposes deleting the branch as #773 residue. **Investigation disproves the premise.**
`.pipeline/current-task`, written by `pre-dispatch.sh`, is still consumed for two *gating*
decisions:

1. `mutation-gate.sh` (#505 Surface B) `exit 2`-blocks unstamped `Edit`/`Write`/`NotebookEdit` and
   `git commit` whenever `.pipeline/build-step-active` exists and the stamp does not. That marker
   is still written at `conductor.ts:3207` and both matcher entries are still wired at
   `worktree-prepare.ts:199-210`.
2. `prepare-commit-msg` stamps `Task:` trailers from the same file; `resolveTaskIds` unions those
   ids into `countResolvedTasks`, which drives the `no_task_progress` stall breaker
   (`conductor.ts:3768-3776`) — itself a terminal-HALT path.

What #773 *did* retire is narrower than the intake assumes: the citation/attribution lane
(`115f0556`), `detectZeroWorkProduct` (pinned `false`), Surface A commit-evidence rejection, and
the `attribution_verify` step (`steps.ts:289-298`, `advisory`, 0 log occurrences). Only
`.pipeline/dispatch-count` was left consumer-less.

Separately: the failure is transient. At 14:40:01Z the hooks had already served 12 dispatched
tasks and then vanished mid-loop (`.pipeline`-wipe class, #549). The scripts are pure constants in
`session-hook-assets.ts` with no per-worktree state.

## Decision

**Repair, then re-check. Do not remove and do not demote.**

1. Extract an exported, idempotent `ensureSessionHooks(worktreeRoot, log?)` from the private
   `writeSessionHooks` + `wireSessionHookSettings` in `worktree-prepare.ts`. It rewrites all four
   scripts 0755 (`pre-dispatch`, `post-dispatch`, `mutation-gate`, `docs-guard`) and re-merges the
   settings entries, returning `{ repaired: string[]; failed: Array<{file, error}> }`.
2. On the session-hooks branch of `checkAttributionMachineryIntact`, when scripts are missing:
   invoke the repair, emit a `console.warn('[session-hooks] …')` line naming what was restored
   (the daemon captures `console.warn` — cf. the `[warn] [autoheal]` lines in `daemon.log.1`), then
   **re-read the filesystem** and re-evaluate.
3. Return `null` (proceed) iff all three enforcement scripts now exist. Return a diagnostic — now
   naming the *repair failure*, not the mere absence — only when re-provisioning could not put them
   on disk.
4. Repair the settings wiring unconditionally as part of the same call (idempotent merge-preserve),
   so a worktree whose `.claude/settings.local.json` lost its entries is re-armed too.
5. `docs-guard.sh` (#788) joins the **repair** set but **not** the halt-check set: its absence is
   logged and repaired, never build-stopping. This closes a real provisioning gap without widening
   what can HALT.

## Consequences

**What is gained.** A regenerable-asset loss stops being terminal. The two halted features
re-dispatch cleanly. The guard becomes symmetric with the sibling branch beside it, which already
seeds `task-status.json` rather than HALTing on its absence
(`seedAndCheckAttributionMachinery`, `conductor.ts:668-686`, from
`.docs/stories/fresh-build-dispatch-halts-immediately-with-attrib.md`). Enforcement coverage
strictly increases: today a hook-less build is *blocked*; under the intake's proposal it would run
*unenforced*; under this decision it runs *enforced*.

**What protection is lost — explicitly.** In the narrow window where the hooks are missing *and*
re-provisioning also fails, behavior is unchanged (still a HALT), so nothing is lost there. In the
ordinary case nothing is lost either, because the scripts are restored before the marker is
written. The one genuine reduction: the guard no longer treats "hooks missing" as evidence of a
*deeper* worktree corruption worth stopping for. If some future failure mode both deletes
`.pipeline/session-hooks/` and corrupts something else the guard does not check, this change
removes an incidental early tripwire for it. That is accepted: the tripwire was never designed to
detect that, it costs a terminal HALT on every benign occurrence, and the repair path logs loudly
enough (`console.warn` into the daemon log, per-file) that a *recurring* repair is visible as an
anomaly to an operator or a later analysis pass.

**Ordering invariant (safety-critical).** `writeBuildStepMarker` at `conductor.ts:3207` fires only
when `machineryIssue == null`. Because the guard now returns `null` on a *repaired* worktree, the
post-repair re-check MUST re-stat the real filesystem, not trust the repair's return value alone.
If that inverted, the marker would arm the #505 Surface B mutation gate against a script that does
not exist — the fail-closed write gate would silently become a no-op for the whole build step. This
is the single defect this ADR most needs the tests to pin.

**Not in scope.** No change to the hook scripts, the settings schema, `bin/conduct`, or any
consumer in `task-progress.ts` / `attribution-enforcement.ts`. `.pipeline/dispatch-count`'s
consumer-less status is noted, not acted on. The `demote-task-stamping-to-telemetry` HALT cited by
#896 was the *plan-unresolvable* branch and is untouched.

## Alternatives rejected

- **Delete the branch (#896's primary hypothesis).** Unsafe: strands two live gating consumers.
  Also worse in practice — an unstamped build writes no `Task:` trailers, `countResolvedTasks`
  under-counts, and the build HALTs later on `no_task_progress` with a far more confusing reason.
- **Demote to a warning (#896's alternative).** Actively harmful: `machineryIssue` becomes null, so
  `writeBuildStepMarker` arms the mutation gate against a missing script, silently disabling #505
  Surface B for that step.
- **Repair at daemon dispatch instead of at the guard.** Wrong seam — it would not catch a wipe
  that happens *between* dispatch and the build step, which is precisely the observed timing.
- **Delete the hooks and their consumers wholesale.** A much larger, genuinely breaking change to
  enforcement semantics; not justified by an intake about a preflight HALT.
