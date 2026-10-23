---
slug: kickback-budget-inspect-child-shows-wrong-prd-audi
spec_hash: 34c1be41a64de6473b80df4e9e63ce3bab226fffffece35f8918d7d5f23ea2a0
pr: https://github.com/jstoup111/ai-conductor/pull/3379
shipped: 2026-10-23
engine_version: 20261023T034049Z-7407bc37137f
---

## Cost
input: 1253695
output: 88212
cache_read: 16989879
cache_creation: 468102
cost_usd: 13.6326
dispatches: 27
retries: 4
halts: 0
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 1253617, output: 61024, cache_read: 15295872, cache_creation: 0, cost_usd: 9.0049, dispatches: 18, cost_unmetered: 0
  claude: input: 78, output: 27188, cache_read: 1694007, cache_creation: 468102, cost_usd: 4.6277, dispatches: 9, cost_unmetered: 0

## Time
state: measured
active_ms: 5687948
provider_active_ms: 3773423
no_provider_active_ms: 1914525

## Build Review
laps_to_pass: 1
skipped: 2
cache_hits: 0
infrastructure_failures: 0
rubrics:
  security: failures: 0, judged: 2
  testQuality: failures: 0, judged: 2
skip_reasons:
  disabled: 2
