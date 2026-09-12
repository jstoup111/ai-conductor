---
slug: support-astra-in-the-daemon
spec_hash: e8aa3dd21151d24d1292f6a0ab80ccbb02ac04ce7e904cb750f78abbc718ae20
pr: https://github.com/jstoup111/ai-conductor/pull/2502
shipped: 2026-09-11
engine_version: 20260911T204108Z-67049898638e
---

## Cost
input: 761296
output: 117007
cache_read: 16195515
cache_creation: 567230
cost_usd: 19.2499
dispatches: 16
retries: 1
halts: 2
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 761148, output: 72306, cache_read: 11738624, cache_creation: 0, cost_usd: 7.3549, dispatches: 9, cost_unmetered: 0
  claude: input: 148, output: 44701, cache_read: 4456891, cache_creation: 567230, cost_usd: 11.895, dispatches: 7, cost_unmetered: 0

## Time
state: measured
active_ms: 4174833
provider_active_ms: 2825099
no_provider_active_ms: 1349734

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  testQuality: failures: 0, judged: 2
skip_reasons:
