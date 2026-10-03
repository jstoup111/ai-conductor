---
slug: durable-otel-export-queue-telemetry-is-buffered-wh
spec_hash: d58fedfe9224287900ea18567cb942c80ccbe1275864613dab0ca8c33888ae83
pr: https://github.com/jstoup111/ai-conductor/pull/2868
shipped: 2026-10-03
engine_version: 20261003T154506Z-bedb65cf8e47
---

## Cost
input: 7181101
output: 970511
cache_read: 141547431
cache_creation: 4473369
cost_usd: 133.137
dispatches: 135
retries: 11
halts: 21
unmetered: count: 2, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 7180157, output: 445221, cache_read: 111319808, cache_creation: 0, cost_usd: 62.2397, dispatches: 63, cost_unmetered: 0
  claude: input: 944, output: 525290, cache_read: 30227623, cache_creation: 4473369, cost_usd: 70.8973, dispatches: 72, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","abe474a7-619e-45eb-9865-beac44d22587","lifecycle-step","finish"]

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 10
  security: failures: 0, judged: 10
  testQuality: failures: 1, judged: 10
skip_reasons:
