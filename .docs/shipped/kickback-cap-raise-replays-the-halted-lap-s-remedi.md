---
slug: kickback-cap-raise-replays-the-halted-lap-s-remedi
spec_hash: 5c946cb067d561bb6f39f84c5f54ec235f5b34503df02e74ebf04db001ccb97d
pr: https://github.com/jstoup111/ai-conductor/pull/2869
shipped: 2026-09-30
engine_version: 20260930T225148Z-18b2a2a206ea
findings:
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC.1
    summary: "src/conductor/src/engine/conductor.ts:4868-4886 — when engine state has no active plan path, remediation now persists the resolved fallback path and halts mechanical if that write fails; no plan task specifies this write"
    accepted: true
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC.2
    summary: "src/conductor/src/engine/conductor.ts:1523 — buildOutcomeRung changes the rung stamped into every BUILD outcome record to the escalated model and effort actually used, not only on kickback builds"
    accepted: true
  - gate: architecture_review_as_built
    finding: AB-KCR-1
    class: REMEDIABLE
    governing_clause: "Task 3"
    outcome: remediated
    summary: "[verified, 99%] recordGrowth was materially changed but has no non-test production caller; its former conductor caller was replaced by settlePendingRepair."
  - gate: architecture_review_as_built
    finding: AB-KCR-2
    class: REMEDIABLE
    governing_clause: "adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback decision 5"
    outcome: remediated
    summary: "An exhausted prd_audit existing-task repair renders only bound task IDs because its pending receipt omits the originating criteria; the required halt therefore does not list every finding."
  - gate: architecture_review_as_built
    finding: AB-KCR-3
    class: REMEDIABLE
    governing_clause: "adr-2026-08-05-build-settle-outcome-stamp decision 3"
    outcome: remediated
    summary: "[verified, 98%] Pending-repair settlement charges allowances and removes the receipt before later durable-retry, live-boundary, and protected-artifact refusals can prevent the BUILD provider dispatch."
  - gate: architecture_review_as_built
    finding: AB-KCR-4
    class: REMEDIABLE
    governing_clause: "Task 5"
    outcome: remediated
    summary: "[verified, 99%] A globally unreadable ledger is converted to an exhausted budget that planRemediation no longer checks, allowing appendRemediationTasks to mutate the plan before unreadability halts the round."
  - gate: architecture_review_as_built
    finding: AB-KCR-5
    class: REMEDIABLE
    governing_clause: "adr-2026-08-05-build-settle-outcome-stamp decision 3"
    outcome: remediated
    summary: "The pending-repair resume path re-enters BUILD without the approved definite-match pre-dispatch no-op check. The implemented sameNoOpCycle, latestBuildOutcome, and halt-reason helpers have no production caller."
  - gate: architecture_review_as_built
    finding: AB-KCR-6
    class: REMEDIABLE
    governing_clause: "adr-2026-08-05-build-settle-outcome-stamp decision 3"
    outcome: remediated
    summary: "[verified, 99%] The definite-match guard compares the current actual escalation effort, but success, failure, and no-verdict stamps persist resolved.effort instead of the actual StepRunResult effort. An escalated no-movement attempt can therefore be misrecorded as the base rung and falsely refuse a later dispatch."
  - gate: architecture_review_as_built
    finding: AB-KCR-7
    class: REMEDIABLE
    governing_clause: "adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback decision 5"
    outcome: remediated
    summary: "[verified, 99%] Pending-repair settlement charges allowances and removes the receipt before self-host dispatch admission. Operator parking and safety/auth preflights can still return afterward without invoking a provider, so a repair can be charged even though BUILD never dispatches."
---

## Cost
input: 3422808
output: 316039
cache_read: 67777837
cache_creation: 1037120
cost_usd: 45.3259
dispatches: 50
retries: 6
halts: 6
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 3422502, output: 203788, cache_read: 58143360, cache_creation: 0, cost_usd: 28.1515, dispatches: 30, cost_unmetered: 0
  claude: input: 306, output: 112251, cache_read: 9634477, cache_creation: 1037120, cost_usd: 17.1744, dispatches: 20, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","6ad1a2be-b16f-4d8b-9ebe-15f45dbbc6aa","lifecycle-step","finish"]

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 4
  security: failures: 0, judged: 4
  testQuality: failures: 0, judged: 4
skip_reasons:
