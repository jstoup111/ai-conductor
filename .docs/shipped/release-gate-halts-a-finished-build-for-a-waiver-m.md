---
slug: release-gate-halts-a-finished-build-for-a-waiver-m
spec_hash: a98d0fab335c2f319e2bd6c64965248b0be49692f1b23c432815f8bed8a0e3d6
pr: https://github.com/jstoup111/ai-conductor/pull/2667
shipped: 2026-09-23
engine_version: 20260923T141639Z-c4581785bc4a
---

## Cost
input: 969747
output: 107225
cache_read: 16703233
cache_creation: 237631
cost_usd: 11.1347
dispatches: 19
retries: 2
halts: 2
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 969679, output: 86702, cache_read: 14827136, cache_creation: 0, cost_usd: 8.4477, dispatches: 14, cost_unmetered: 0
  claude: input: 68, output: 20523, cache_read: 1876097, cache_creation: 237631, cost_usd: 2.687, dispatches: 5, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","3c844665-e738-49dc-9252-f327f3045b25","lifecycle-step","finish"]

## Build Review
laps_to_pass: 1
skipped: 2
cache_hits: 0
infrastructure_failures: 0
rubrics:
  security: failures: 0, judged: 2
skip_reasons:
  test_quality_empty_scope: 2
