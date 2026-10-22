---
slug: shipped-features-decide-artifacts-accumulate-in-do
spec_hash: 63b3d7467e6fcbf4f03c135523ab72e4aac38188e5583c14b6e887d36c3ed7bb
pr: https://github.com/jstoup111/ai-conductor/pull/3348
shipped: 2026-10-22
engine_version: 20261022T120907Z-f265ea536135
---

## Cost
input: 2964378
output: 364456
cache_read: 57895106
cache_creation: 2039605
cost_usd: 48.4249
dispatches: 60
retries: 11
halts: 5
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 2964108, output: 204708, cache_read: 47761664, cache_creation: 0, cost_usd: 26.8853, dispatches: 31, cost_unmetered: 0
  claude: input: 270, output: 159748, cache_read: 10133442, cache_creation: 2039605, cost_usd: 21.5396, dispatches: 29, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","73c0fada-cb92-4e3f-9925-4377838e339c","lifecycle-step","finish"]

## Build Review
laps_to_pass: 1
skipped: 7
cache_hits: 0
infrastructure_failures: 0
rubrics:
  security: failures: 0, judged: 7
  testQuality: failures: 3, judged: 7
skip_reasons:
  disabled: 7
