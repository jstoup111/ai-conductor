---
slug: clear-kickback-raise-halts-without-a-halt-record
spec_hash: 0d88dbe193551458eb0f22f4ba5fa8b02cb08f15392dfaa0e12f9d7a2a295fa5
pr: https://github.com/jstoup111/ai-conductor/pull/2820
shipped: 2026-09-29
engine_version: 20260928T232244Z-91f41cedca69
---

## Cost
input: 458665
output: 33139
cache_read: 6868799
cache_creation: 69762
cost_usd: 4.0465
dispatches: 8
retries: 0
halts: 0
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 458649, output: 28712, cache_read: 6566784, cache_creation: 0, cost_usd: 3.3394, dispatches: 6, cost_unmetered: 0
  claude: input: 16, output: 4427, cache_read: 302015, cache_creation: 69762, cost_usd: 0.7071, dispatches: 2, cost_unmetered: 0

## Time
state: measured
active_ms: 2051795
provider_active_ms: 1471331
no_provider_active_ms: 580464

## Build Review
laps_to_pass: 1
skipped: 1
cache_hits: 0
infrastructure_failures: 0
rubrics:
  security: failures: 0, judged: 1
skip_reasons:
  test_quality_empty_scope: 1
