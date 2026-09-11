---
slug: fail-land-when-a-non-small-architecture-artifact-h
spec_hash: c0d7da0e8af79c69d758a39e06582f2642af341efa9f06cfd54031101638361e
pr: https://github.com/jstoup111/ai-conductor/pull/2496
shipped: 2026-09-11
engine_version: 20260910T220211Z-39b4ec92e0a6
---

## Cost
input: 375235
output: 53535
cache_read: 8268985
cache_creation: 206839
cost_usd: 6.3915
dispatches: 7
retries: 0
halts: 1
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 375197, output: 36823, cache_read: 6915840, cache_creation: 0, cost_usd: 3.2286, dispatches: 5, cost_unmetered: 0
  claude: input: 38, output: 16712, cache_read: 1353145, cache_creation: 206839, cost_usd: 3.163, dispatches: 2, cost_unmetered: 0

## Time
state: measured
active_ms: 3354413
provider_active_ms: 2030873
no_provider_active_ms: 1323540

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  testQuality: failures: 0, judged: 1
skip_reasons:
