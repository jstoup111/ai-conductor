---
slug: exempt-vitest-temp-dir-from-tmpdir-leak-guard
spec_hash: 5aa13db27b0294ffcc20ea8527879c19156eb03af77ed455cabe97e978eb10de
pr: https://github.com/jstoup111/ai-conductor/pull/2827
shipped: 2026-09-29
engine_version: 20260929T105729Z-f7dec31e6e68
---

## Cost
input: 665986
output: 52071
cache_read: 9978997
cache_creation: 90884
cost_usd: 5.9952
dispatches: 12
retries: 0
halts: 0
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 665956, output: 44130, cache_read: 9452544, cache_creation: 0, cost_usd: 5.0733, dispatches: 9, cost_unmetered: 0
  claude: input: 30, output: 7941, cache_read: 526453, cache_creation: 90884, cost_usd: 0.9219, dispatches: 3, cost_unmetered: 0

## Time
state: measured
active_ms: 4181362
provider_active_ms: 1934828
no_provider_active_ms: 2246534

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
