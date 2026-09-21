---
slug: file-changing-rebase-rewinds-past-test-suite-and-r
spec_hash: f1120e1d3f67ec3c8b09ec1d24c9091b3f4bec3b175eb05e5401dbbc4401a129
pr: https://github.com/jstoup111/ai-conductor/pull/2555
shipped: 2026-09-21
engine_version: 20260921T014919Z-f9a937e4d19d
findings:
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC.1
    summary: "`src/conductor/src/engine/gate-invalidation.ts:59,89` — `.docs/decisions/` is now a coverage document input and the as-built review uses the `feature-runtime-or-coverage-inputs` surface; `src/conductor/src/engine/artifacts.ts:1009,3440` apply it on ordinary completion and the stale-artifact sweep, with no rebase needed"
    accepted: true
    decision: accept
    rationale: "Operator (James) accepts 2026-09-19: an as-built or coverage verdict should go stale when a governing ADR changes, rebase or not. Non-rebase coverage added in gate-code-validity.test.ts ('with no rebase involved' cases)."
  - gate: architecture_review_as_built
    finding: AB-1
    class: REMEDIABLE
    governing_clause: "Task rem-as-built-rem-ab3-1"
    outcome: remediated
    summary: "Applied build_review invalidation bypasses the required operation-scoped, exactly-once convergence refund."
  - gate: architecture_review_as_built
    finding: AB-2
    class: REMEDIABLE
    governing_clause: "adr-2026-08-18-rebase-invalidation-refunds-build-review-convergence D3"
    outcome: remediated
    summary: "Applied generic kickback telemetry carries no convergence credit."
  - gate: architecture_review_as_built
    finding: AB-3
    class: REMEDIABLE
    governing_clause: "Task rem-as-built-rem-ab4-1"
    outcome: remediated
    summary: "Applied fail-closed invalidations emit no generic rebase kickback."
  - gate: architecture_review_as_built
    finding: AB-4
    class: REMEDIABLE
    governing_clause: "Task rem-as-built-rem-ab5-1"
    outcome: remediated
    summary: "Coverage has no preserved-identity parser and cannot bind replay authority."
  - gate: architecture_review_as_built
    finding: AB-5
    class: REMEDIABLE
    governing_clause: "Task rem-as-built-rem-ab5-2"
    outcome: remediated
    summary: "Neither production tail refreshes coverage in place or clamps continuation to test_suite or later."
  - gate: architecture_review_as_built
    finding: AB-6
    class: REMEDIABLE
    governing_clause: "adr-2026-09-11-selective-post-rebase-verification D5"
    outcome: remediated
    summary: "Preservation does not detect a governing ADR added after the bound input set was captured."
  - gate: architecture_review_as_built
    finding: AB-7
    class: REMEDIABLE
    governing_clause: "Task 10"
    outcome: remediated
    summary: "The applied-transition path never records the required operation-scoped build_review convergence credit."
  - gate: architecture_review_as_built
    finding: AB-8
    class: REMEDIABLE
    governing_clause: "Task 19"
    outcome: remediated
    summary: "The applied-transition path emits rebase-specific events but never emits the required generic kickback events for its applied invalidations."
  - gate: architecture_review_as_built
    finding: AB-9
    class: REMEDIABLE
    governing_clause: "Task 9"
    outcome: remediated
    summary: "A skipped gate can remain skipped in state/verdict while the durable operation and event report it invalidated."
---

## Cost
input: 11574275
output: 2092188
cache_read: 332834343
cache_creation: 8899939
cost_usd: 402.741
dispatches: 180
retries: 28
halts: 22
unmetered: count: 4, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 11572379, output: 1033625, cache_read: 247339264, cache_creation: 0, cost_usd: 114.6221, dispatches: 98, cost_unmetered: 0
  claude: input: 1896, output: 1058563, cache_read: 85495079, cache_creation: 8899939, cost_usd: 288.1189, dispatches: 82, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","113ee66b-3007-49a2-9c3f-f2146075bef1","lifecycle-step","finish"]

## Build Review
laps_to_pass: 1
skipped: 6
cache_hits: 0
infrastructure_failures: 0
rubrics:
  security: failures: 0, judged: 3
  testQuality: failures: 0, judged: 12
skip_reasons:
  disabled: 6
