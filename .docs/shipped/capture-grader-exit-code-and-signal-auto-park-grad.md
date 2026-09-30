---
slug: capture-grader-exit-code-and-signal-auto-park-grad
spec_hash: 16864b3f826081fda88197046dbf8923c38c5f8bc85c763fb3d64d22df7b29b1
pr: https://github.com/jstoup111/ai-conductor/pull/2853
shipped: 2026-09-30
engine_version: 20260930T225148Z-18b2a2a206ea
findings:
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC.1
    summary: "src/conductor/src/engine/build-review-coordinator.ts:802 — narrowed structuredResultWasRejected predicate also drops the rejection from read-only-review-unavailable failures, changing that settlement from an aggregate throw to a needs-human refusal (test/integration/build-review-custom-routing.integration.test.ts, commit b7a8e089e)"
    accepted: true
    decision: accept
    rationale: "Fail-closed needs-human on unavailable read-only review matches harness convention; small adjacent change."
---

## Cost
input: 1723471
output: 164338
cache_read: 38049814
cache_creation: 979411
cost_usd: 28.9372
dispatches: 31
retries: 1
halts: 6
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 1723251, output: 85851, cache_read: 32260736, cache_creation: 0, cost_usd: 17.6045, dispatches: 13, cost_unmetered: 0
  claude: input: 220, output: 78487, cache_read: 5789078, cache_creation: 979411, cost_usd: 11.3327, dispatches: 18, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","f58f5a51-bfce-43f1-bb01-0959cf94c6a4","lifecycle-step","finish"]

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 2
  security: failures: 0, judged: 2
  testQuality: failures: 0, judged: 2
skip_reasons:
