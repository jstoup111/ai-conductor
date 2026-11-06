---
slug: routed-residue-finding-lands-on-a-taskless-host-an
spec_hash: 6c3920b57fa56830f908b8310ebd825b841a7243621f9ac1eb66fc493acaa997
pr: https://github.com/jstoup111/ai-conductor/pull/3595
shipped: 2026-11-06
engine_version: 20261106T030422Z-ec349cdd4c6c
findings:
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC-1
    summary: "This is a test-runner hygiene fix outside the routing feature's stated outcomes. It is likely a by-product of getting test_suite to pass after the halt. It changes only the test harness environment, not shipped engine behavior."
    accepted: false
    authority: engine
  - gate: architecture_review_as_built
    finding: "as-built:ea09e1b8-5e44-4b19-a705-1cf8f2e3dee4:1"
    class: REMEDIABLE
    governing_clause: "Task 5"
    outcome: remediated
    summary: "Verified (99%): src/conductor/src/engine/routing/routing-events.ts:36 exports isDerivedAlreadyCompleteRepairPhase without a production caller. Repository-wide search finds only its definition and test calls at src/conductor/test/engine/routing/routing-events.test.ts:55–57. Introduced for task 5 crash recovery, it became obsolete when recovery switched to isDerivedAlreadyCompleteHost."
---

## Cost
input: 1962166
output: 136324
cache_read: 34006655
cache_creation: 617838
cost_usd: 20.6453
dispatches: 38
retries: 3
halts: 1
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 1962076, output: 98737, cache_read: 31860096, cache_creation: 0, cost_usd: 14.5212, dispatches: 27, cost_unmetered: 0
  claude: input: 90, output: 37587, cache_read: 2146559, cache_creation: 617838, cost_usd: 6.1241, dispatches: 11, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","1f04dbdf-247c-44d3-aaa7-4bcf59273a6e","lifecycle-step","finish"]

## Build Review
laps_to_pass: 2
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 3
  implementationQuality: failures: 1, judged: 3
  security: failures: 0, judged: 3
  testQuality: failures: 0, judged: 3
skip_reasons:
