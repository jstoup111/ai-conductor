---
slug: conflict-artifact-stem-is-validated-only-at-build-
spec_hash: 75520678e3c584dbb734bd030e279eeaddba49ee4b2521a5759b0a6ea02b13cc
pr: https://github.com/jstoup111/ai-conductor/pull/1893
shipped: 2026-08-26
engine_version: 20260825T192930Z-2f8d7937bc9e
---

## Cost
input: 1548795
output: 165837
cache_read: 29622781
cache_creation: 348179
cost_usd: 22.0662
dispatches: 22
retries: 1
halts: 3
unmetered: count: 8, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 1548561, output: 94271, cache_read: 21309696, cache_creation: 0, cost_usd: 12.6375, dispatches: 10, cost_unmetered: 0
  claude: input: 234, output: 71566, cache_read: 8313085, cache_creation: 348179, cost_usd: 9.4287, dispatches: 4, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:finish

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
skip_reasons:
