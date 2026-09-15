---
slug: report-progress-bypassed-build-retries-against-the
spec_hash: 28da5c98a5c893e4561a352859f3491cfececfccb11ee731849ed3f5d5a85d98
pr: https://github.com/jstoup111/ai-conductor/pull/2501
shipped: 2026-09-15
engine_version: 20260915T105227Z-df26a1d8ebd1
---

## Cost
input: 2018613
output: 314562
cache_read: 47591519
cache_creation: 1638852
cost_usd: 47.2714
dispatches: 38
retries: 2
halts: 8
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 2018343, output: 195557, cache_read: 38706816, cache_creation: 0, cost_usd: 22.2401, dispatches: 19, cost_unmetered: 0
  claude: input: 270, output: 119005, cache_read: 8884703, cache_creation: 1638852, cost_usd: 25.0313, dispatches: 19, cost_unmetered: 0

## Time
state: partial
reason: open-executions:parallel:prd_audit,step:finish

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  testQuality: failures: 0, judged: 6
skip_reasons:
