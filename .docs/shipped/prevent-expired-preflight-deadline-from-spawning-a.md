---
slug: prevent-expired-preflight-deadline-from-spawning-a
spec_hash: 27f350e337f99ca455553f345d9105ef75883731172e00e8bf2d90335c24e93c
pr: https://github.com/jstoup111/ai-conductor/pull/2436
shipped: 2026-09-09
engine_version: 20260909T010219Z-decd14cb6c54
---

## Cost
input: 559937
output: 56308
cache_read: 11652864
cache_creation: 228833
cost_usd: 7.9495
dispatches: 13
retries: 0
halts: 2
unmetered: count: 4, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 559871, output: 33786, cache_read: 9778432, cache_creation: 0, cost_usd: 4.1606, dispatches: 6, cost_unmetered: 0
  claude: input: 66, output: 22522, cache_read: 1874432, cache_creation: 228833, cost_usd: 3.7889, dispatches: 3, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:finish

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  testQuality: failures: 0, judged: 1
skip_reasons:
