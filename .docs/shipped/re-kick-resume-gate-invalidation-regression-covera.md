---
slug: re-kick-resume-gate-invalidation-regression-covera
spec_hash: 83d0dc8f3c260fa5bcac3fc60abc7dba87192ff9810acfaf621b1453a164cca4
pr: https://github.com/jstoup111/ai-conductor/pull/2246
shipped: 2026-09-06
engine_version: 20260906T032235Z-0c471cd2a03d
---

## Cost
input: 591465
output: 52620
cache_read: 12402511
cache_creation: 55374
cost_usd: 6.7476
dispatches: 12
retries: 1
halts: 0
unmetered: count: 5, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 591419, output: 42210, cache_read: 11245696, cache_creation: 0, cost_usd: 5.355, dispatches: 6, cost_unmetered: 0
  claude: input: 46, output: 10410, cache_read: 1156815, cache_creation: 55374, cost_usd: 1.3926, dispatches: 1, cost_unmetered: 0

## Time
state: measured
active_ms: 1497171
provider_active_ms: 1185391
no_provider_active_ms: 311780

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
skip_reasons:
