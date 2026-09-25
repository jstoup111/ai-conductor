---
slug: offer-ship-or-continue-at-remediation-budget
spec_hash: eaae009a290f5deccbe99dc0f11275f1e8ddba03a1b84dfb37d5ee328b8213ea
pr: https://github.com/jstoup111/ai-conductor/pull/2719
shipped: 2026-09-24
engine_version: 20260924T134314Z-2bce17700f0b
---

## Cost
input: 875280
output: 79513
cache_read: 13806065
cache_creation: 187356
cost_usd: 10.5503
dispatches: 14
retries: 0
halts: 0
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 875252, output: 66215, cache_read: 13159040, cache_creation: 0, cost_usd: 7.1973, dispatches: 11, cost_unmetered: 0
  claude: input: 28, output: 13298, cache_read: 647025, cache_creation: 187356, cost_usd: 3.3531, dispatches: 3, cost_unmetered: 0

## Time
state: measured
active_ms: 4627318
provider_active_ms: 4106995
no_provider_active_ms: 520323

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  security: failures: 0, judged: 1
  testQuality: failures: 0, judged: 1
skip_reasons:
