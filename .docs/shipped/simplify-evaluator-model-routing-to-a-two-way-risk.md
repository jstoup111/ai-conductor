---
slug: simplify-evaluator-model-routing-to-a-two-way-risk
spec_hash: cb223a9eb93ea40823dfeb8db1b21c23cf5c775e36131640eef5e439b2d04d96
pr: https://github.com/jstoup111/ai-conductor/pull/2460
shipped: 2026-09-08
engine_version: 20260907T120758Z-4f8bdec36946
---

## Cost
input: 562519
output: 59523
cache_read: 12006253
cache_creation: 191520
cost_usd: 7.9971
dispatches: 14
retries: 1
halts: 0
unmetered: count: 5, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 562467, output: 40449, cache_read: 10061696, cache_creation: 0, cost_usd: 4.6325, dispatches: 7, cost_unmetered: 0
  claude: input: 52, output: 19074, cache_read: 1944557, cache_creation: 191520, cost_usd: 3.3646, dispatches: 2, cost_unmetered: 0

## Time
state: measured
active_ms: 4618106
provider_active_ms: 3561858
no_provider_active_ms: 1056248

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  testQuality: failures: 0, judged: 1
skip_reasons:
