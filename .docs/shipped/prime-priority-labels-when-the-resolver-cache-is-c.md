---
slug: prime-priority-labels-when-the-resolver-cache-is-c
spec_hash: c1fda100be2b6ff7c698f43b1d64bc89b16aabf62487c4b075ec43f96803bfeb
pr: https://github.com/jstoup111/ai-conductor/pull/2561
shipped: 2026-09-15
engine_version: 20260915T105227Z-df26a1d8ebd1
---

## Cost
input: 544251
output: 62372
cache_read: 9669162
cache_creation: 106017
cost_usd: 6.4725
dispatches: 9
retries: 1
halts: 1
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 544225, output: 50833, cache_read: 9091328, cache_creation: 0, cost_usd: 4.8348, dispatches: 7, cost_unmetered: 0
  claude: input: 26, output: 11539, cache_read: 577834, cache_creation: 106017, cost_usd: 1.6377, dispatches: 2, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:finish

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
skip_reasons:
