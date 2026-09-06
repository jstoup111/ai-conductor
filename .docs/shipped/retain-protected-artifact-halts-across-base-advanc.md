---
slug: retain-protected-artifact-halts-across-base-advanc
spec_hash: e4810c9cf5cc81d94662d0004f3e30c9d01919d6668b6ce229fe75993745df21
pr: https://github.com/jstoup111/ai-conductor/pull/2248
shipped: 2026-09-06
engine_version: 20260906T032235Z-0c471cd2a03d
---

## Cost
input: 512518
output: 45713
cache_read: 10428885
cache_creation: 67402
cost_usd: 6.4957
dispatches: 11
retries: 0
halts: 0
unmetered: count: 5, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 512468, output: 33602, cache_read: 9029888, cache_creation: 0, cost_usd: 4.8191, dispatches: 5, cost_unmetered: 0
  claude: input: 50, output: 12111, cache_read: 1398997, cache_creation: 67402, cost_usd: 1.6765, dispatches: 1, cost_unmetered: 0

## Time
state: measured
active_ms: 2630110
provider_active_ms: 1338711
no_provider_active_ms: 1291399

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
skip_reasons:
