---
slug: accept-trailing-hyphen-slugs-in-compose-handoff
spec_hash: a764e151fd603a820388886ab8d7cb00b62b082e493916dd0c489c5e1091780b
pr: https://github.com/jstoup111/ai-conductor/pull/2828
shipped: 2026-09-29
engine_version: 20260929T105729Z-f7dec31e6e68
---

## Cost
input: 528437
output: 38662
cache_read: 7316729
cache_creation: 71021
cost_usd: 4.394
dispatches: 10
retries: 0
halts: 0
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 528401, output: 31307, cache_read: 6692224, cache_creation: 0, cost_usd: 3.6023, dispatches: 7, cost_unmetered: 0
  claude: input: 36, output: 7355, cache_read: 624505, cache_creation: 71021, cost_usd: 0.7917, dispatches: 3, cost_unmetered: 0

## Time
state: measured
active_ms: 2797387
provider_active_ms: 1551643
no_provider_active_ms: 1245744

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
