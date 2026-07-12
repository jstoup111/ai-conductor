# ADR: Progress-aware build halt/park + progress-gated cross-dispatch re-kick (#280)

**Date:** 2026-07-12
**Status:** APPROVED
**Track:** technical · **Tier:** M · **Issue:** jstoup111/ai-conductor#280

## Context

The daemon builds a merged spec by dispatching the `build` step inside a retry loop in
`Conductor.run` (`src/conductor/src/engine/conductor.ts:1638`, `while (attempt < stepMaxRetries)`).
`stepMaxRetries` resolves to `max_retries`, whose default is `FALLBACK_RETRIES = 3`
(`resolved-config.ts:153`). The loop is bounded **only** by that fixed attempt count.

An M/L-tier plan is built batch-by-batch across many sessions. A 22-task plan cannot complete in
3 attempts, so the loop exhausts its budget with `succeeded = false`, the step is marked `failed`,
and in daemon mode the build HALTs or auto-parks (`checkAndAutoPark`, `daemon-auto-park.ts`) — even
though each attempt resolved additional tasks and nothing is wedged. Issue #280 documents the same
spec halting three times in 24h, each dispatch completing more tasks, self-remediating only when an
**unrelated** merge advanced `origin/main` and `rekickSweep` (FR-7, base-advance-gated) re-kicked it.
On a quiet main, a progressing build parks indefinitely.

The primitives to decide this correctly already exist and are ground truth:
- `countResolvedTasks` / `resolvedTasksBefore` (`conductor.ts:1625/2132`) read `task-status.json`,
  which persists in the build worktree across attempts **and** across re-kick dispatches.
- The durable `TaskEvidence` sidecar (`task-evidence.ts`: `noEvidenceAttempts`, `noEvidenceReasons`)
  already accrues across attempts, runs, and re-kicks, and is reset on progress.
- Today the stall breaker (`conductor.ts:2136`) marks `no_task_progress` only when
  `attempt >= 2 && resolvedTasksAfter <= resolvedTasksBefore` — so it already declines to call a
  progress-making attempt "stalled." The gap is purely that the **fixed budget still terminates the
  loop** regardless of that positive signal.

## Decision (Approach C — hybrid)

Make **forward-progress delta the primary continue/halt signal**, keep an **absolute ceiling as a
safety backstop**, and add a **progress-gated, bounded cross-dispatch re-kick**.

### D1 — Within-dispatch: progress retries do not consume the halt budget
A completion-gate miss that coincides with a **positive** resolved-task delta
(`resolvedTasksAfter > resolvedTasksBefore`) is a *progress retry*: the loop re-dispatches and the
`noEvidenceAttempts` counter is reset (as it is today). A progress retry is bounded not by
`stepMaxRetries` but by a separate **absolute attempt ceiling** (`build_progress_ceiling`, config,
default 30). Only a **zero-delta** miss counts toward the existing halt/park path
(`noEvidenceAttempts` increment → `checkAndAutoPark` threshold) — unchanged behavior for genuine
wedges. If the absolute ceiling is reached while still progressing (pathological slow-drip), the
run parks with a distinct, self-explaining reason (`build progressing but hit absolute attempt
ceiling N`), never a misleading "tasks not completed" halt.

### D2 — Across-dispatch: progress-gated re-kick, bounded per spec
Persist the resolved-count observed at the **end** of each build dispatch to the `TaskEvidence`
sidecar (new additive field `lastResolvedCount`, default 0; the sidecar already survives re-kicks).
On the daemon idle/poll tick, a parked/halted build whose most recent dispatch's ending resolved
count exceeds its starting count (i.e. the last dispatch made progress) becomes **re-kick-eligible
without a base advance**, bounded by a per-spec **dispatch ceiling** (`build_dispatch_ceiling`,
config, default 20). This is additive to `rekickSweep` (base-advance path is untouched) and must
route through the daemon's existing double-dispatch guards (the `started`/`parked` sets and
`isParked`/`isHalted` checks in `daemon.ts`) so it never double-dispatches a live build.

### D3 — Config + safe defaults + kill switch
New optional `build_progress_halt` config block (`HarnessConfig`, pattern mirrors `OtelConfig`):
`enabled` (default true), `attempt_ceiling` (default 30, positive int), `dispatch_ceiling`
(default 20, positive int). Validated in `validateConfig`: positive integers only;
`attempt_ceiling >= max_retries` (a ceiling below the existing budget would regress). `enabled:
false` reverts exactly to today's fixed-budget behavior (the ceiling and re-kick are inert).

## Consequences

- Progressing M/L builds finish across dispatches instead of parking on a quiet main; genuine
  zero-progress wedges still park at the **same** threshold as today.
- Worst case is bounded by two explicit, configurable ceilings — no infinite retry or re-kick storm.
- Reuses existing counters/primitives; no parallel progress bookkeeping. One additive sidecar field
  (`lastResolvedCount`), backward-compatible with the tolerant sidecar parse (`|| 0`).
- The #347 sibling (`build-progress-watcher`, observability) reads the same `task-status.json`
  primitive read-only and shares **no mutable state** — independent; a conflict-check note, not a
  dependency.

## Assumptions (verify-claims)

- **A1 (95%, verified):** `task-status.json` resolved count persists in the build worktree across
  re-kick dispatches (it is the completion gate's ground truth and the worktree is not wiped between
  re-kicks; cf. #549 pipeline-wipe crash was the exception being fixed). *If wrong:* cross-dispatch
  progress can't be measured and D2 must snapshot elsewhere. **Load-bearing → pinned in stories as
  an acceptance check on a real worktree.**
- **A2 (85%, inferred):** the daemon's `started`/`parked`/`isParked`/`isHalted` guards are
  sufficient to admit a progress-gated re-kick without double-dispatch, the same way a cleared HALT
  is re-admitted today (`daemon.ts:125-140`). *If wrong:* D2 needs an explicit re-kick lease.
  **Surfaced for the plan step to confirm at the call site.**
- **A3 (90%, inferred):** default `max_retries` for `build` is 3 (`FALLBACK_RETRIES`); no
  `DEFAULT_STEP_RETRIES['build']` override supersedes it. *If wrong:* only the `attempt_ceiling >=
  max_retries` validation bound shifts, not the design.

No unconfirmed assumption changes the chosen approach or track, so no hard-block. A1/A2 are pinned
as acceptance checks rather than blockers.
