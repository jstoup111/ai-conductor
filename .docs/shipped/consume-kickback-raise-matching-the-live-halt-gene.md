---
slug: consume-kickback-raise-matching-the-live-halt-gene
spec_hash: e1fe1733e24805c7ff7c1fec6217e78e885a4711b6f5e7bc22ea7dfe63b12ba3
pr: https://github.com/jstoup111/ai-conductor/pull/2873
shipped: 2026-09-30
engine_version: 20260930T103720Z-7384b902bf38
---

## Cost
input: 556965
output: 52056
cache_read: 10450170
cache_creation: 114077
cost_usd: 5.857
dispatches: 10
retries: 0
halts: 0
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 556909, output: 39719, cache_read: 9491584, cache_creation: 0, cost_usd: 4.5397, dispatches: 6, cost_unmetered: 0
  claude: input: 56, output: 12337, cache_read: 958586, cache_creation: 114077, cost_usd: 1.3173, dispatches: 4, cost_unmetered: 0

## Time
state: measured
active_ms: 3336931
provider_active_ms: 2303902
no_provider_active_ms: 1033029

## Build Review
laps_to_pass: 1
skipped: 1
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 1
  security: failures: 0, judged: 1
skip_reasons:
  test_quality_empty_scope: 1
