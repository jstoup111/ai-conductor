---
slug: stale-manual-test-discovered-at-finish-is-unroutab
spec_hash: 2529601560ff3683512f57a8e3e0f2f33d67de8a979f6e78949a1ac4ab4d0441
pr: https://github.com/jstoup111/ai-conductor/pull/1673
shipped: 2026-08-17
engine_version: 20260817T161751Z-f6143c05d7fb
---

## Cost
input: 105753279
output: 611239
cache_read: 124171652
cache_creation: 2151590
cost_usd: 40.1933
dispatches: 110
retries: 35
halts: 5
unmetered: count: 19, duration_ms: 0
cost_unmetered: count: 63
providers:
  codex: input: 105752639, output: 337771, cache_read: 100496640, cache_creation: 0, cost_usd: 0, dispatches: 64, cost_unmetered: 63
  claude: input: 640, output: 273468, cache_read: 23675012, cache_creation: 2151590, cost_usd: 40.1933, dispatches: 33, cost_unmetered: 0

## Time
state: partial

## Build Review
laps_to_pass: 11
skipped: 0
cache_hits: 93
infrastructure_failures: 0
rubrics:
  completeness: failures: 24, judged: 35
  rootCause: failures: 0, judged: 35
  scope: failures: 7, judged: 35
  tautology: failures: 15, judged: 35
skip_reasons:
