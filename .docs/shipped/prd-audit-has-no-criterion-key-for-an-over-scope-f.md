---
slug: prd-audit-has-no-criterion-key-for-an-over-scope-f
spec_hash: 6ff833d3dda66a6a62bfdb1b7a47f36271457d1a0098bc81587c75cf42ea48f2
pr: https://github.com/jstoup111/ai-conductor/pull/1909
shipped: 2026-08-27
engine_version: 20260827T023439Z-be04459a0215
---

## Cost
input: 2196948
output: 369313
cache_read: 84613337
cache_creation: 2109193
cost_usd: 70.0485
dispatches: 40
retries: 0
halts: 4
unmetered: count: 10, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 2196200, output: 151250, cache_read: 43938560, cache_creation: 0, cost_usd: 21.6909, dispatches: 14, cost_unmetered: 0
  claude: input: 748, output: 218063, cache_read: 40674777, cache_creation: 2109193, cost_usd: 48.3577, dispatches: 16, cost_unmetered: 0

## Time
state: partial
reason: open-executions:parallel:prd_audit,step:finish

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  testQuality: failures: 3, judged: 6
skip_reasons:
