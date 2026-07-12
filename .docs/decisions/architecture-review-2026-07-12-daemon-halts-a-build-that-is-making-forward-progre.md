# Architecture Review (lightweight, M): Progress-aware build halt (#280)

**Date:** 2026-07-12 · **Design:** adr-2026-07-12-progress-aware-build-halt.md (APPROVED)

## Scope reviewed
Approach C — progress-delta as the primary within-dispatch continue signal, an absolute attempt
ceiling backstop, and a bounded progress-gated cross-dispatch re-kick.

## Feasibility findings

| # | Finding | Verdict |
|---|---------|---------|
| F1 | The retry loop (`conductor.ts:1638`) already computes `resolvedTasksAfter` vs `resolvedTasksBefore` and declines to mark progress-making misses as `no_task_progress`. Making progress retries bypass the fixed budget is a localized change to the loop-continuation condition, not a rewrite. | Feasible |
| F2 | Cross-dispatch measurement needs a durable per-spec resolved-count snapshot. `TaskEvidence` already persists across re-kicks and has a tolerant parse; one additive field (`lastResolvedCount`) is backward-compatible. | Feasible |
| F3 | Progress-gated re-kick must not double-dispatch. The daemon already re-admits a slug past `started` only for a cleared HALT via `isHalted` (`daemon.ts:125-140`); the new path reuses those guards. Needs an explicit test asserting no double-dispatch while a build is live. | Feasible, guard required |
| F4 | Two new terminal conditions (attempt ceiling, dispatch ceiling) must emit distinct, self-explaining reasons so operators never see a progressing build reported as "tasks not completed." | Feasible |
| F5 | Interaction with `checkAndAutoPark` / durable `noEvidenceAttempts`: zero-progress path is unchanged; the change only prevents positive-progress attempts from reaching the budget-exhaustion `failed` branch. No regression to the wedge-park threshold. | Feasible |

## Risks + mitigations
- **Slow-drip (1 task/dispatch forever):** bounded by `attempt_ceiling` (within) and
  `dispatch_ceiling` (across); both configurable, both park with an explicit reason.
- **Re-kick storm on a busy daemon:** re-kick is gated on *positive last-dispatch progress* and the
  per-spec dispatch ceiling, and routes through existing double-dispatch guards.
- **Config regressions:** `attempt_ceiling >= max_retries` validation prevents a ceiling that would
  shrink today's budget; `enabled: false` is an exact revert.

## Alignment
- Deterministic-first: the decision is computed from `task-status.json` + sidecar counters, not
  agent judgement — consistent with the harness "deterministic where possible" principle.
- No new subsystem; reuses `countResolvedTasks`, `TaskEvidence`, `checkAndAutoPark`, `rekickSweep`.
- Independent of #347 (observability); shared primitive is read-only.

## ADRs
- adr-2026-07-12-progress-aware-build-halt.md — **APPROVED**

## Verdict
**APPROVED for stories.** No architectural blockers. Carry A1 (worktree resolved-count persistence)
and A2 (double-dispatch guard sufficiency) into stories/plan as explicit acceptance checks.
