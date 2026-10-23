---
slug: remediation-tasks-close-on-a-reported-commit-that-
spec_hash: 797de30f5a744f135c9ddb2c33e71154c172e172e117ccb2add2265a8eeba1df
pr: https://github.com/jstoup111/ai-conductor/pull/3384
shipped: 2026-10-23
engine_version: 20261023T170550Z-7949f582080b
---

## Cost
input: 2215760
output: 231760
cache_read: 47732331
cache_creation: 943672
cost_usd: 32.4176
dispatches: 37
retries: 8
halts: 0
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 2215638, output: 161894, cache_read: 43868288, cache_creation: 0, cost_usd: 22.6976, dispatches: 25, cost_unmetered: 0
  claude: input: 122, output: 69866, cache_read: 3864043, cache_creation: 943672, cost_usd: 9.72, dispatches: 12, cost_unmetered: 0

## Time
state: measured
active_ms: 11244577
provider_active_ms: 8231492
no_provider_active_ms: 3013085

## Build Review
laps_to_pass: 1
skipped: 3
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 3
  security: failures: 0, judged: 3
  testQuality: failures: 0, judged: 3
skip_reasons:
  disabled: 3
