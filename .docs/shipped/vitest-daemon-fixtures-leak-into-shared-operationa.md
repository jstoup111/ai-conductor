---
slug: vitest-daemon-fixtures-leak-into-shared-operationa
spec_hash: fba05815fcf22a9d09e4a468e86800641f675d1925cddaec46b5827afa30ebd2
pr: https://github.com/jstoup111/ai-conductor/pull/2984
shipped: 2026-10-04
engine_version: 20261004T174827Z-4925f7bb7cbf
findings:
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC.1
    summary: "src/conductor/test/integration/engineer-emission.test.ts:44 and src/conductor/test/engine/daemon-runner.test.ts:173 — test fixtures isolate engineer-store state, which lies outside the user-config/OTLP boundary; test-only"
    accepted: true
---

## Cost
input: 3005342
output: 269397
cache_read: 54671302
cache_creation: 769423
cost_usd: 33.3837
dispatches: 44
retries: 3
halts: 5
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 3005138, output: 181988, cache_read: 49263872, cache_creation: 0, cost_usd: 22.8453, dispatches: 29, cost_unmetered: 0
  claude: input: 204, output: 87409, cache_read: 5407430, cache_creation: 769423, cost_usd: 10.5385, dispatches: 15, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","3fedc2c5-4162-4b60-9c85-a982702ec40f","lifecycle-step","architecture_review_as_built"],step:execution\u0000["timing-rollup","persisted-ledger","7c149664-4462-47b4-87f2-6a030216d226","lifecycle-step","prd_audit"],step:execution\u0000["timing-rollup","persisted-ledger","97df56af-5104-44d9-9f1d-ff32afdc5eed","lifecycle-step","finish"]

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 3
  security: failures: 0, judged: 3
  testQuality: failures: 0, judged: 3
skip_reasons:
