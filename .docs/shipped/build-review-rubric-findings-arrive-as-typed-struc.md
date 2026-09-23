---
slug: build-review-rubric-findings-arrive-as-typed-struc
spec_hash: 5b231ce7288cca1293f3bc43bd93f651a8898b552f3b056925e53cd9cd578a0f
pr: https://github.com/jstoup111/ai-conductor/pull/2660
shipped: 2026-09-23
engine_version: 20260923T174345Z-bac5a548b9cc
---

## Cost
input: 3607024
output: 488906
cache_read: 114226668
cache_creation: 1913112
cost_usd: 81.2342
dispatches: 66
retries: 5
halts: 6
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 3606628, output: 311832, cache_read: 101211776, cache_creation: 0, cost_usd: 40.0695, dispatches: 40, cost_unmetered: 0
  claude: input: 396, output: 177074, cache_read: 13014892, cache_creation: 1913112, cost_usd: 41.1647, dispatches: 26, cost_unmetered: 0

## Time
state: measured
active_ms: 27145418
provider_active_ms: 22452438
no_provider_active_ms: 4692980

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  security: failures: 0, judged: 6
  testQuality: failures: 0, judged: 6
skip_reasons:
