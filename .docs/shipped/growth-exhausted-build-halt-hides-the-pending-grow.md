---
slug: growth-exhausted-build-halt-hides-the-pending-grow
spec_hash: dfd72002a0ff034b6848763b5b924ac7682d8747ccb69044a4287b70120e18c1
pr: https://github.com/jstoup111/ai-conductor/pull/3335
shipped: 2026-10-22
engine_version: 20261021T234255Z-d50d13381061
---

## Cost
input: 767726
output: 60647
cache_read: 16885558
cache_creation: 291598
cost_usd: 9.57
dispatches: 12
retries: 0
halts: 1
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 767676, output: 41001, cache_read: 15608320, cache_creation: 0, cost_usd: 6.5886, dispatches: 8, cost_unmetered: 0
  claude: input: 50, output: 19646, cache_read: 1277238, cache_creation: 291598, cost_usd: 2.9814, dispatches: 4, cost_unmetered: 0

## Time
state: measured
active_ms: 10236782
provider_active_ms: 3726705
no_provider_active_ms: 6510077

## Build Review
laps_to_pass: 1
skipped: 1
cache_hits: 0
infrastructure_failures: 0
rubrics:
  security: failures: 0, judged: 1
  testQuality: failures: 0, judged: 1
skip_reasons:
  disabled: 1
