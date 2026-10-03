---
slug: daemon-redispatch-loses-committed-task-progress-af
spec_hash: b7f52891879e41408a693fe23fdccc04ae5dd667e1438201486baf3380450f9c
pr: https://github.com/jstoup111/ai-conductor/pull/2964
shipped: 2026-10-03
engine_version: 20261003T201457Z-42a8ad9bcd91
---

## Cost
input: 607924
output: 53335
cache_read: 10334134
cache_creation: 173352
cost_usd: 7.0385
dispatches: 12
retries: 0
halts: 0
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 607858, output: 39510, cache_read: 9072000, cache_creation: 0, cost_usd: 5.1656, dispatches: 7, cost_unmetered: 0
  claude: input: 66, output: 13825, cache_read: 1262134, cache_creation: 173352, cost_usd: 1.8729, dispatches: 5, cost_unmetered: 0

## Time
state: measured
active_ms: 4672021
provider_active_ms: 3299709
no_provider_active_ms: 1372312

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 1
  security: failures: 0, judged: 1
  testQuality: failures: 0, judged: 1
skip_reasons:
