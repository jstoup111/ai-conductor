---
slug: make-every-gate-verdict-recoverable-from-the-event
spec_hash: d04bc2928ab327bba4df8e368465424facdeaaf7e92b749c63a47293c47ffe57
pr: https://github.com/jstoup111/ai-conductor/pull/2375
shipped: 2026-09-07
engine_version: 20260906T234411Z-c3d8a7a25a37
---

## Cost
input: 1014944
output: 110465
cache_read: 24227386
cache_creation: 462343
cost_usd: 17.0119
dispatches: 21
retries: 2
halts: 0
unmetered: count: 7, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 1014836, output: 83225, cache_read: 20882560, cache_creation: 0, cost_usd: 10.0345, dispatches: 9, cost_unmetered: 0
  claude: input: 108, output: 27240, cache_read: 3344826, cache_creation: 462343, cost_usd: 6.9774, dispatches: 5, cost_unmetered: 0

## Time
state: measured
active_ms: 5251867
provider_active_ms: 4144973
no_provider_active_ms: 1106894

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  testQuality: failures: 0, judged: 2
skip_reasons:
