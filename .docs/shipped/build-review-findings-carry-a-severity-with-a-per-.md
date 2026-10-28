---
slug: build-review-findings-carry-a-severity-with-a-per-
spec_hash: 5f2666b1ad0e0d2f9d70b5ee296043655a714ad51e80b57bfdddb348bb0fc7a6
pr: https://github.com/jstoup111/ai-conductor/pull/3374
shipped: 2026-10-23
engine_version: 20261023T115538Z-4a7e7bb2c1ad
---

## Cost
input: 2593123
output: 301486
cache_read: 76752040
cache_creation: 2033513
cost_usd: 51.7913
dispatches: 32
retries: 3
halts: 2
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 2592979, output: 203507, cache_read: 66833664, cache_creation: 0, cost_usd: 31.5794, dispatches: 18, cost_unmetered: 0
  claude: input: 144, output: 97979, cache_read: 9918376, cache_creation: 2033513, cost_usd: 20.2119, dispatches: 14, cost_unmetered: 0

## Time
state: measured
active_ms: 20072879
provider_active_ms: 8863762
no_provider_active_ms: 11209117

## Build Review
laps_to_pass: 1
skipped: 3
cache_hits: 0
infrastructure_failures: 0
rubrics:
  security: failures: 0, judged: 3
  testQuality: failures: 0, judged: 3
skip_reasons:
  disabled: 3
