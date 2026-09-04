---
slug: custom-steps-crash-the-conductor-with-step-artifac
spec_hash: d2102385b9213c6984bdab2c36ad2cee40a68d5bca90d67027d91f321e20ae6c
pr: https://github.com/jstoup111/ai-conductor/pull/2136
shipped: 2026-09-04
engine_version: 20260904T115019Z-cedc2a944d7b
---

## Cost
input: 1612879
output: 204509
cache_read: 46099089
cache_creation: 1658488
cost_usd: 40.2733
dispatches: 35
retries: 2
halts: 1
unmetered: count: 11, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 1612577, output: 111030, cache_read: 31035264, cache_creation: 0, cost_usd: 13.818, dispatches: 13, cost_unmetered: 0
  claude: input: 302, output: 93479, cache_read: 15063825, cache_creation: 1658488, cost_usd: 26.4553, dispatches: 11, cost_unmetered: 0

## Time
state: measured
active_ms: 7503884
provider_active_ms: 6872028
no_provider_active_ms: 631856

## Build Review
laps_to_pass: 3
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  testQuality: failures: 2, judged: 5
skip_reasons:
