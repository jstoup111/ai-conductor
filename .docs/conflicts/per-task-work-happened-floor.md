# Conflict Check — Per-task work-happened floor

**Stem:** `per-task-work-happened-floor` · 2026-07-22 · **Result: CLEAR (resolved)**

Checked the new advisory against every adjacent gate/contract it could contradict.

## 1. build_review grader prompt (anti-per-task-SHA rule) — POTENTIAL, RESOLVED

`buildGraderPrompt` forbids per-task SHA/reachability/corroboration reasoning. A naive
design that injected the floor's per-task findings into that prompt would contradict it.
**Resolved by design:** the floor stays OUT of the grader prompt entirely (ADR Alt B
rejected). The grader's input isolation (diff + plan only) and anti-per-task rule are
untouched. No conflict remains.

## 2. Deleted #773 wedge class (path/dirname/SHA/pinned stamps) — POTENTIAL, RESOLVED

The floor must not re-derive any deleted corroboration. **Resolved:** inputs are strictly
`Task:` trailer presence (via `listCommitsWithTrailers`/`canonicalTaskId`), plan
verify-only markers (`parsePlanTaskVerifyOnly`), and `task-status` skipped rows. It never
calls `filesForCommit`, never matches `**Files:**` paths, never checks SHA reachability
against a pinned stamp. Verified against the parsers listed in the map. No revival.

## 3. no_task_progress stall breaker (`conductor.ts` / `countResolvedTasks`) — NO CONFLICT

The stall breaker reads `countResolvedTasks` (telemetry) to detect build stalls across
retries. The floor is a separate, read-only computation with its own artifact
(`.pipeline/per-task-floor.json`) and does not write `task-status.json` or the stall
inputs. Independent. (Note: the `no_task_progress` *park* is disabled post-#773; the
floor does not re-enable or depend on it.)

## 4. wiring_check gate (`wiring-probe.ts` / `conductor.ts:4119`) — NO CONFLICT

`wiring_check` is a separate BLOCKING deterministic gate at a different seam
(build_review → manual_test) with its own evidence file `WIRING_EVIDENCE`. The floor
writes a distinct artifact, is non-blocking, and adds no step to `ALL_STEPS`. No overlap
in artifacts, ordering, or kickback routing.

## 5. Config schema (`build_review` block) — NO CONFLICT

`build_review.perTaskFloor?` is additive and optional; absent/malformed defaults to on.
It does not alter existing `build_review` fields or `validateConfig()` behavior for them.
No breaking schema change → no migration block required (see release-gate note in plan).

## 6. Telemetry-only `Task:` trailers (#773) — NO CONFLICT, DEPENDS-ON

The floor consumes `Task:` trailers, which #773 kept as telemetry. This is a *read*
dependency, not a re-gating: the floor treats a missing trailer as an advisory prompt to
confirm/mark, NOT as a hard failure — precisely because trailer stamping is best-effort.
Consistent with the telemetry-only contract.

**No blocking conflicts. State/resource/ordering all disjoint. CLEAR.**
