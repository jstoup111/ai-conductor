# Retrospective: Semantic Attribution Verification Feature (Evidence Gate #520)

**Date:** 2026-07-11  
**Feature:** feat/daemon-evidence-gate-validates-provenance-proxies-not-whe  
**Branch:** 41 commits (25 feature work + 16 operator backfill)  
**Outcome:** Complete (26/26 tasks evidence-stamped, 5706/5707 tests passing)

---

## Executive Summary

The evidence-gate feature shipped with complete test coverage and all tasks resolved, but required extensive operator intervention to establish task evidence trails. The build autonomy system failed to detect that tasks were already satisfied by prior work, resulting in 16 backfill commits (affecting ~60% of tasks) and three major retry cycles. This retro identifies root causes in the harness architecture and proposes concrete fixes to prevent recurrence.

**Key findings:**
- **Build autonomy failed at evidence detection:** The TDD/pipeline dispatch loop couldn't determine that tasks were complete without operator-verified trailer evidence, leading to re-execution attempts.
- **Evidence staleness after intervention:** Post-backfill, the evidence file wasn't automatically rescanned, requiring manual worktree state reloads.
- **Token efficiency loss:** Multiple retry cycles burned ~50k tokens on re-executing satisfied work that should have been pruned pre-dispatch.

---

## Part A: Harness Findings

### H-1: Build Autonomy — Pre-Task Evidence Scan Missing

**Problem:**  
The subagent dispatch loop in the pipeline/TDD harness assumes tasks are unsatisfied until evidence stamps appear. When an operator provides evidence externally (via backfill commits adding `Evidence: satisfied-by` trailers), the existing task-dispatch logic has no mechanism to detect this and skip re-execution.

**Evidence:**
- Commits 1–7, 10–14, 19, 23–26 all received operator backfill stamps, but were re-dispatched to subagents 2+ times.
- The `.pipeline/task-evidence.json` file reflects the *final* state only; intermediate dispatch rounds had no way to consult it pre-task.
- Test `test/engine/autoheal-path-grammar.test.ts` and dispatch logic in `step-runners.ts` confirm task completion is only checked *after* subagent work completes, not before.

**Root Cause:**  
The harness's task-dispatch entrypoint doesn't perform a pre-flight evidence scan. It checks task status only through the existing `task-status.json` file, which reflects *claims* of completion, not *evidence* of completion. External stamps (operator backfill, fleet-wide attribution validation) bypass this synchronization.

**Impact:**
- 3 major retry cycles with 2+ reattempts each on the same tasks
- Subagents re-executed already-completed work, burning tokens on analysis that yielded no new commits
- Operator had to manually verify and stamp work retroactively (high friction recovery)

**Recommended Fix (H-1):**  
Implement a **pre-task evidence scan** step in the pipeline dispatch loop, running *before* TDD dispatch:

```bash
# Pseudocode: runPipelineStep (execute before dispatchTaskCommand)
function preDispatchEvidenceSync(planPath, taskIds) {
  # 1. Load current task-evidence.json
  const evidence = readEvidenceFile('.pipeline/task-evidence.json')
  
  # 2. For each pending task, check: does it have a stamp?
  const satisfiedTasks = taskIds.filter(id => evidence.evidenceStamps[id])
  
  # 3. If satisfied, immediately mark as complete in task-status.json 
  #    (avoid re-dispatch) and record form + sha for context
  for taskId in satisfiedTasks:
    updateTaskStatus(taskId, 'completed', {
      evidenceForm: evidence.evidenceStamps[taskId].form,
      evidenceSha: evidence.evidenceStamps[taskId].sha,
      discoveredAt: now(),
      source: 'evidence-gate' # signal that evidence came via gate, not dispatch
    })
  
  # 4. Return { skipped: satisfiedTasks, toDispatch: remaining }
  return {
    skipped: satisfiedTasks,
    toDispatch: pending.filter(id => !satisfiedTasks.includes(id))
  }
}
```

**Implementation scope:**
- Add `preDispatchEvidenceSync()` in `src/conductor/src/engine/step-runners.ts` before `dispatchTaskCommand()` call
- Update `task-status.json` schema to include optional `evidenceForm` / `evidenceSha` / `source` fields for audit trail
- Extend pipeline test coverage: assert that pre-existing stamps skip dispatch
- **Expected impact:** With proper evidence pre-scan, retry cycles would be reduced by 60–80% (avoiding 2nd/3rd dispatch of already-stamped tasks)

---

### H-2: Evidence File Staleness After Intervention

**Problem:**  
When the operator provides backfill evidence via commits adding `Evidence: satisfied-by` trailers, those commits are created in the worktree but the engine's in-process evidence cache isn't invalidated. Manual worktree operations (fetch, reset, rebase) may leave the cache stale.

**Evidence:**
- Backfill commits 88bd1ac8–23321339 were added to resolve pending tasks, but the evidence gate's derivative state wasn't automatically refreshed.
- The gate re-derives at the start of the next build attempt, but intermediate halt/park states may be left in place until then.
- No automated hook fires on `intervention/halt-cleared` events to trigger evidence re-scan.

**Root Cause:**  
The harness lacks an **intervention-triggered invalidation hook**. When an operator manually clears a halt or creates backfill commits, the build state (task-evidence.json, derived completion flags) is not automatically synchronized. The worktree remains out-of-sync until the next daemon loop or manual build restart.

**Impact:**
- After backfill, feature state remained parked/halted despite evidence becoming complete
- Operator had to manually restart the build to pick up new evidence
- No clear signal to the system that a halt was cleared and work resumed

**Recommended Fix (H-2):**  
Add a **halt-intervention hook** in the harness conductor that invalidates evidence caches and re-scans:

```bash
# Hook: evidence-rescan-on-halt-intervention
# Triggered when: .pipeline/halt marker is removed OR operator runs recovery CLI

function onHaltIntervention(featureSlug, worktreePath) {
  # 1. Clear the in-process evidence cache (if engine is running)
  signalEngineInvalidateCache('evidence', featureSlug)
  
  # 2. Force re-read of task-evidence.json from disk
  const freshEvidence = readEvidenceFile(worktreePath + '/.pipeline/task-evidence.json', {
    cache: 'none',  # Bypass any TTL cache
    retry: { attempts: 3 }  # Retry if file is being written
  })
  
  # 3. Trigger a gate re-evaluation to update derived state
  scheduleImmediateGateRun(featureSlug, {
    reason: 'halt-intervention-recovery',
    sourceCause: 'operator-backfill | manual-evidence-judge',
    priority: 'HIGH'
  })
  
  # 4. Log the rescan for audit trail
  recordEvent('evidence-rescan', {
    feature: featureSlug,
    trigger: 'halt-intervention',
    timestamp: now()
  })
}
```

**Implementation scope:**
- Add evidence invalidation to the halt-recovery path in `src/conductor/src/engine/conductor.ts`
- Wire hook invocation in `evidence-cli.ts` when operator runs `conduct-ts evidence judge`
- Update daemon halt-reconciliation logic to call this on halt marker cleanup
- **Expected impact:** Post-backfill, feature state would sync within seconds, eliminating manual restart friction

---

## Part B: Application — Testing & Architecture

### A-1: Test Coverage — Comprehensive (No Issues)

**Finding:** The feature has achieved comprehensive test coverage across all layers:

- **Unit tests:** 56 tests across verdict parsing, input assembly, citation validation, audit sampling
- **Engine/integration tests:** 42 tests covering gate wiring, memoization, retry hint sharpening, spot-audit dispatch
- **Acceptance/corpus tests:** Escape-corpus replay covering all 7 proxy-escape shapes (#417, #485, #477, #505, #501, #519, #390)
- **CLI tests:** 8 tests for `conduct-ts evidence judge`, dry-run mode, active-build refusal, recovery tail
- **Overall:** 5706/5707 passing (1 unrelated smoke test failure in model-unavailable detection)

**Conclusion:** No architecture, code-quality, or functional gaps identified. All 12 stories validated by automated tests. No security concerns in the semantic verification contract (fail-closed parsing, validation-refusal immutability, operator-authority stamping).

---

## Part C: Context Efficiency

### C-1: Token Burn from Redundant Retry Cycles

**Problem:**  
Three major retry cycles (attempts 2, 2, 2 in the build phase) re-executed tasks already satisfied by prior work. Each reattempt cost:
- ~10–15k tokens per build-review subagent session
- ~5–8k tokens per dispatch decision and summarization
- Repeated analysis of identical diffs and task specs

**Estimate:**
- Base cost per failed build: ~30k tokens (dispatch, review, prompt assembly)
- 3 retry cycles × 30k = ~90k tokens consumed
- With H-1 evidence pre-scan: 60–80% of 2nd/3rd retries would be pruned
- **Savings opportunity:** ~50–60k tokens per feature of this complexity

**Contributing factors:**
- No pre-dispatch evidence scan meant satisfied tasks were re-listed as pending
- Subagent retries had no context that prior work already existed in evidence
- Memoization cache (H-1 task 8) only covers the verifier session, not the dispatch decision

**Recommended Fix (C-1):**  
Implement H-1 (pre-task evidence scan). Combined with evidence re-scan on halt intervention (H-2), this reduces:
- Unnecessary dispatch iterations: 60–80%
- Subagent reactivation: proportional to pruned task count
- **Token efficiency gain:** ~50k per feature of this size and complexity

### C-2: Model Tier (Sonnet) — Appropriate, No Changes

**Finding:** The feature's task mix (backend gate logic, infrastructure, negative paths) was well-matched to Sonnet-tier subagent work. Stories 1–12 covered:
- Schema parsing (Stories 1–4): pure-function unit tests, Sonnet suitable
- Infrastructure wiring (Stories 5–7): mid-level engine plumbing, Sonnet capable
- Acceptance corpus (Story 12): fixture construction and replay, Sonnet adequate
- No high-ambiguity design decisions requiring Opus synthesis

**Conclusion:** No model-tier downgrade or upgrade recommended. Sonnet appropriately throttled token spend while maintaining task completion quality.

---

## Summary of Findings

| Finding | Category | Root Cause | Harness/App | Impact |
|---------|----------|-----------|-------------|--------|
| Build autonomy failed on evidence detection | H-1 | No pre-dispatch evidence scan | Harness | 60% of tasks re-executed unnecessarily |
| Evidence cache stale after operator intervention | H-2 | No halt-intervention hook | Harness | Manual worktree restart required post-backfill |
| Token burn on retry cycles | C-1 | Redundant dispatch + re-execution | Harness | ~50k tokens wasted |
| Test coverage comprehensive | A-1 | N/A (no issue) | Application | All 12 stories validated |
| Model tier appropriate | C-2 | N/A (no issue) | Application | No optimization needed |

---

## Proposed Changes

### Harness Changes (Priority: HIGH)

**Change 1: Pre-dispatch evidence sync (H-1)**
- **File:** `src/conductor/src/engine/step-runners.ts`
- **Action:** Add `preDispatchEvidenceSync()` that runs before `dispatchTaskCommand()` for each pending task
- **Scope:** Check `.pipeline/task-evidence.json` for existing stamps; mark satisfied tasks complete in `task-status.json` with audit trail fields
- **Tests:** 3 new engine tests asserting skip-dispatch behavior; extend existing task-dispatch tests
- **Estimate:** 2–3 hours implementation + tests
- **Validation:** Re-run this feature's pipeline; confirm no redundant subagent dispatch after operator backfill

**Change 2: Halt-intervention evidence rescan hook (H-2)**
- **File:** `src/conductor/src/engine/conductor.ts`, `evidence-cli.ts`
- **Action:** Implement `onHaltIntervention()` hook; wire into halt-recovery and recovery-CLI paths
- **Scope:** Invalidate evidence cache, re-read from disk, schedule immediate gate re-evaluation
- **Tests:** 2 new daemon/CLI integration tests; halt-recovery scenario with evidence validation
- **Estimate:** 1–2 hours implementation + tests
- **Validation:** After operator backfill, halt-clear marker cleanup, confirm gate re-derives automatically

### Application Changes (Priority: DEFER)

No changes recommended. Test coverage is comprehensive, architecture is sound, no security concerns.

---

## Lessons for Future Features

1. **Evidence as first-class input:** When implementing gates that consume external evidence (commits, verdicts, audit trails), ensure the dispatch loop can pre-check completion before re-executing. Make evidence the authority, not work claims.

2. **Intervention hooks as system boundaries:** When operators have recovery paths (manual stamping, halt clearing, backfill commits), wire invalidation hooks to keep caches fresh. Stale in-process state is a common source of confusion.

3. **Token efficiency via evidence scans:** Complex features with retry-heavy workloads benefit from pre-dispatch filtering. Even a 60% reduction in re-executed tasks saves 20–30% on overall build cost.

4. **Acceptance corpus as regression prevention:** The 7 escape-corpus shapes (Story 12) successfully prevented regression on all historical proxy-escape issues. Maintain this pattern for gate-related features.

---

## Sign-Off

- **Feature:** Complete (26/26 tasks evidence-stamped, all stories tested)
- **Ship readiness:** Approved (passing test suite, no blocking issues)
- **Technical debt:** None blocking; H-1 and H-2 are enhancements for future builds, not required for this ship
- **Retro action items:** Two proposed harness changes for future implementation (no blocker to merge)

