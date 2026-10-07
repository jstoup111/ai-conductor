---
slug: refuse-unsupported-plugin-kinds-step-and-hook-at-l
spec_hash: 51be882d3dac23140e62838eeaa329a9b139988a4cd913b2562120eb4c2844cd
pr: https://github.com/jstoup111/ai-conductor/pull/3032
shipped: 2026-10-07
engine_version: 20261007T164331Z-36ba0cf6988b
---

## Cost
input: 469209
output: 40246
cache_read: 5394825
cache_creation: 164014
cost_usd: 5.6075
dispatches: 11
retries: 0
halts: 2
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 469183, output: 29247, cache_read: 5093504, cache_creation: 0, cost_usd: 4.0151, dispatches: 7, cost_unmetered: 0
  claude: input: 26, output: 10999, cache_read: 301321, cache_creation: 164014, cost_usd: 1.5925, dispatches: 4, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","c6e2c230-6154-4050-a0b5-52a0848187b8","lifecycle-step","finish"]

## Build Review
laps_to_pass: 1
skipped: 1
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 1
  security: failures: 0, judged: 1
skip_reasons:
  test_quality_empty_scope: 1
