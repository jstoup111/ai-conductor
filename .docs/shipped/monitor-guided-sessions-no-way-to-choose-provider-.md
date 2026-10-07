---
slug: monitor-guided-sessions-no-way-to-choose-provider-
spec_hash: 628a54d13c78e6965d92fc7f5fc64c7058b751a172787390568f20b10894eb0b
pr: https://github.com/jstoup111/ai-conductor/pull/3030
shipped: 2026-10-07
engine_version: 20261007T134220Z-a1a68521069c
---

## Cost
input: 1177326
output: 148800
cache_read: 19586224
cache_creation: 490943
cost_usd: 15.9016
dispatches: 22
retries: 2
halts: 0
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 1177196, output: 88445, cache_read: 16136064, cache_creation: 0, cost_usd: 10.1487, dispatches: 12, cost_unmetered: 0
  claude: input: 130, output: 60355, cache_read: 3450160, cache_creation: 490943, cost_usd: 5.7529, dispatches: 10, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","20af0f38-77d8-4ff9-871c-c3a61cd1afcf","lifecycle-step","architecture_review_as_built"],step:execution\u0000["timing-rollup","persisted-ledger","f39c67e2-f187-405e-a0dd-91c8dfbbe6f0","lifecycle-step","prd_audit"]

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
