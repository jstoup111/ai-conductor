---
slug: stage-wrapped-desired-outcome-bullets-in-full
spec_hash: 9d35b7b03b35ef616ca862bcaf821c0fddabc3d8d226d861c799757dc8c43354
pr: https://github.com/jstoup111/ai-conductor/pull/2882
shipped: 2026-09-30
engine_version: 20260930T103720Z-7384b902bf38
---

## Cost
input: 310657
output: 32295
cache_read: 4521022
cache_creation: 92913
cost_usd: 3.1567
dispatches: 10
retries: 0
halts: 0
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 310611, output: 22431, cache_read: 3820672, cache_creation: 0, cost_usd: 2.1109, dispatches: 6, cost_unmetered: 0
  claude: input: 46, output: 9864, cache_read: 700350, cache_creation: 92913, cost_usd: 1.0459, dispatches: 4, cost_unmetered: 0

## Time
state: measured
active_ms: 1650022
provider_active_ms: 997518
no_provider_active_ms: 652504

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
