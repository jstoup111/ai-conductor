---
slug: daemon-cannot-switch-to-higher-priority-queued-wor
spec_hash: a27632194f948d4ebf309b0e8254051e8c4e109e03a1d74f8ee0b05b3d9d3e7d
pr: https://github.com/jstoup111/ai-conductor/pull/3647
shipped: 2026-11-08
engine_version: 20261108T141634Z-8505c2b5a069
findings:
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC-1
    summary: "This test-only change is unrelated to preemption, most likely a speed or timeout fix to get test_suite passing. It changes no production code, operator output or persisted state. It does narrow that test's end-to-end coverage of the increment path, which now relies on the preceding test."
    accepted: false
    authority: engine
  - gate: architecture_review_as_built
    finding: "as-built:1e3d6c41-62b3-44b7-b8a1-6958c7687387:1"
    class: REMEDIABLE
    governing_clause: "adr-2026-11-07-daemon-step-boundary-preemption decision 5"
    outcome: remediated
    summary: "Verified, 99% confidence: src/conductor/src/engine/conductor.ts:17431 passes rawOperatorParkBoundary to configured group members, bypassing the composed yield predicate required by D5. The retry gate at src/conductor/src/engine/group-core.ts:728 therefore ignores yield and permits another dispatch at :742. Exhaustion can produce failed group state at conductor.ts:17527 and return through :9054 before the post-join preemption check at :9071. This is one violating injection site; plan task 5 already requires fixing such bypasses."
---

## Cost
input: 1420614
output: 123119
cache_read: 27004708
cache_creation: 666822
cost_usd: 18.2344
dispatches: 28
retries: 2
halts: 1
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 1420504, output: 80822, cache_read: 23267328, cache_creation: 0, cost_usd: 11.3059, dispatches: 19, cost_unmetered: 0
  claude: input: 110, output: 42297, cache_read: 3737380, cache_creation: 666822, cost_usd: 6.9284, dispatches: 9, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","940ff7bd-42ff-416d-b120-5969c4da12af","lifecycle-step","finish"]

## Build Review
laps_to_pass: 2
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 2, judged: 2
  implementationQuality: failures: 0, judged: 2
  security: failures: 0, judged: 2
  testQuality: failures: 0, judged: 2
skip_reasons:
