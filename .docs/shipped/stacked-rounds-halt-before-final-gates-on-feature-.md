---
slug: stacked-rounds-halt-before-final-gates-on-feature-
spec_hash: c931cc42fc33c81e962dbebc82babdf10d9e184b1aa089eca638cc1cf3152746
pr: https://github.com/jstoup111/ai-conductor/pull/3755
shipped: 2026-11-22
engine_version: 20261122T020604Z-3379a47ff8d4
---

## Cost
input: 2662654
output: 225248
cache_read: 43616821
cache_creation: 911258
cost_usd: 28.9335
dispatches: 54
retries: 9
halts: 0
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 2662496, output: 156280, cache_read: 39868288, cache_creation: 0, cost_usd: 19.5138, dispatches: 35, cost_unmetered: 0
  claude: input: 158, output: 68968, cache_read: 3748533, cache_creation: 911258, cost_usd: 9.4198, dispatches: 19, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","7a0c31c4-da8d-4e82-92e8-95e7d21bad99","lifecycle-step","build_review"],step:execution\u0000["timing-rollup","persisted-ledger","b0e9ec91-2bbd-490b-8482-03784d4f9881","lifecycle-step","build_review"]

## Build Review
laps_to_pass: 3
skipped: 5
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 5
  implementationQuality: failures: 5, judged: 5
  security: failures: 0, judged: 5
  testQuality: failures: 1, judged: 5
skip_reasons:
  paths-unmatched: 5
