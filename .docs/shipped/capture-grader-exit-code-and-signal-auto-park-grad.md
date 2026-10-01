---
slug: capture-grader-exit-code-and-signal-auto-park-grad
spec_hash: 16864b3f826081fda88197046dbf8923c38c5f8bc85c763fb3d64d22df7b29b1
pr: https://github.com/jstoup111/ai-conductor/pull/2853
shipped: 2026-09-30
engine_version: 20260930T225148Z-18b2a2a206ea
---

## Cost
input: 1723471
output: 164338
cache_read: 38049814
cache_creation: 979411
cost_usd: 28.9372
dispatches: 31
retries: 1
halts: 6
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 1723251, output: 85851, cache_read: 32260736, cache_creation: 0, cost_usd: 17.6045, dispatches: 13, cost_unmetered: 0
  claude: input: 220, output: 78487, cache_read: 5789078, cache_creation: 979411, cost_usd: 11.3327, dispatches: 18, cost_unmetered: 0

## Time
state: measured
active_ms: 10284478
provider_active_ms: 7848503
no_provider_active_ms: 2435975

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 2
  security: failures: 0, judged: 2
  testQuality: failures: 0, judged: 2
skip_reasons:
