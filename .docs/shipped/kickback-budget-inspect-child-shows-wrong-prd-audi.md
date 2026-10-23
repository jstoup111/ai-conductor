---
slug: kickback-budget-inspect-child-shows-wrong-prd-audi
spec_hash: 34c1be41a64de6473b80df4e9e63ce3bab226fffffece35f8918d7d5f23ea2a0
pr: https://github.com/jstoup111/ai-conductor/pull/3379
shipped: 2026-10-23
engine_version: 20261023T034049Z-7407bc37137f
---

## Cost
input: 1220041
output: 87560
cache_read: 16886455
cache_creation: 468102
cost_usd: 13.5368
dispatches: 26
retries: 4
halts: 0
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 1219963, output: 60372, cache_read: 15192448, cache_creation: 0, cost_usd: 8.9091, dispatches: 17, cost_unmetered: 0
  claude: input: 78, output: 27188, cache_read: 1694007, cache_creation: 468102, cost_usd: 4.6277, dispatches: 9, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","2dc03cb1-1787-4871-b511-82e02009f746","lifecycle-step","finish"]

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
