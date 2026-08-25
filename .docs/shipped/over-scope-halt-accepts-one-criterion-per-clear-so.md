---
slug: over-scope-halt-accepts-one-criterion-per-clear-so
spec_hash: e635bdbd1c751813c34cce1bebdfcde9630912da4044c0e4cfcdfdf7891cbd8b
pr: https://github.com/jstoup111/ai-conductor/pull/1873
shipped: 2026-08-25
engine_version: 20260825T031141Z-c0e4d818f137
---

## Cost
input: 642998
output: 87892
cache_read: 13818623
cache_creation: 155142
cost_usd: 8.2023
dispatches: 20
retries: 3
halts: 3
unmetered: count: 12, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 642932, output: 56083, cache_read: 11640576, cache_creation: 0, cost_usd: 4.7663, dispatches: 12, cost_unmetered: 0
  claude: input: 66, output: 31809, cache_read: 2178047, cache_creation: 155142, cost_usd: 3.436, dispatches: 5, cost_unmetered: 0

## Time
state: partial
reason: open-executions:parallel:prd_audit,step:finish

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
skip_reasons:
