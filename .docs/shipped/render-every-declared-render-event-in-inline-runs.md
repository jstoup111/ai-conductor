---
slug: render-every-declared-render-event-in-inline-runs
spec_hash: 86c8a205354ae1b4a29abd16db95391548ad368eedf5feeb3c514d88674472e1
pr: https://github.com/jstoup111/ai-conductor/pull/2448
shipped: 2026-09-11
engine_version: 20260910T220211Z-39b4ec92e0a6
---

## Cost
input: 1319204
output: 184323
cache_read: 34339861
cache_creation: 762272
cost_usd: 26.416
dispatches: 21
retries: 2
halts: 6
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 1318954, output: 91820, cache_read: 25290880, cache_creation: 0, cost_usd: 10.6998, dispatches: 14, cost_unmetered: 0
  claude: input: 250, output: 92503, cache_read: 9048981, cache_creation: 762272, cost_usd: 15.7162, dispatches: 7, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:build,step:finish

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  testQuality: failures: 0, judged: 2
skip_reasons:
