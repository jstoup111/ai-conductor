---
slug: coherence-artifact-passes-engineer-land-then-block
spec_hash: 4ab9cecd6a8bed9a7cf51b964b497b6c2d4a6a9c1cc62dbc8bf1e8e67f34cce0
pr: https://github.com/jstoup111/ai-conductor/pull/1945
shipped: 2026-08-28
engine_version: 20260828T131723Z-347b11891a69
---

## Cost
input: 3082698
output: 454106
cache_read: 82926809
cache_creation: 2683518
cost_usd: 76.764
dispatches: 57
retries: 2
halts: 5
unmetered: count: 14, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 3082022, output: 198053, cache_read: 44475648, cache_creation: 0, cost_usd: 24.2986, dispatches: 21, cost_unmetered: 0
  claude: input: 676, output: 256053, cache_read: 38451161, cache_creation: 2683518, cost_usd: 52.4655, dispatches: 22, cost_unmetered: 0

## Time
state: partial
reason: open-executions:parallel:prd_audit,step:build,step:finish

## Build Review
laps_to_pass: 5
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  testQuality: failures: 6, judged: 10
skip_reasons:
