---
slug: exported-telemetry-carries-no-cost-signal-so-spend
spec_hash: 72ae3720c5adfb4fab2d2687d2c2979487aad62631e611d72f5c1d2648cabd41
pr: https://github.com/jstoup111/ai-conductor/pull/1972
shipped: 2026-08-29
engine_version: 20260829T124007Z-0fc0ed0e907e
---

## Cost
input: 1382817
output: 189387
cache_read: 26505282
cache_creation: 686319
cost_usd: 25.2297
dispatches: 30
retries: 0
halts: 5
unmetered: count: 9, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 1382549, output: 107863, cache_read: 18805760, cache_creation: 0, cost_usd: 12.4773, dispatches: 10, cost_unmetered: 0
  claude: input: 268, output: 81524, cache_read: 7699522, cache_creation: 686319, cost_usd: 12.7524, dispatches: 11, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:finish

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  testQuality: failures: 0, judged: 2
skip_reasons:
