---
slug: unretryable-input-routing-never-fires-outside-thre
spec_hash: 1904c5a1713e15519f7993dcb9b69086d10c696366cb7cd0c1419ecc724d34e7
pr: https://github.com/jstoup111/ai-conductor/pull/3088
shipped: 2026-10-10
engine_version: 20261010T132818Z-14d7967cd432
---

## Cost
input: 570025
output: 41857
cache_read: 11110644
cache_creation: 166974
cost_usd: 7.2411
dispatches: 12
retries: 0
halts: 1
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 569971, output: 29057, cache_read: 10213632, cache_creation: 0, cost_usd: 5.4697, dispatches: 7, cost_unmetered: 0
  claude: input: 54, output: 12800, cache_read: 897012, cache_creation: 166974, cost_usd: 1.7714, dispatches: 5, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","d6ed0337-2188-414b-8ad8-4e67dd8992d7","lifecycle-step","finish"]

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
