---
slug: stacked-features-cannot-be-published-reviewed-and-
spec_hash: 474180df87406325a626f0c970e59489d0539fd184d97470069a73c584aa6125
pr: https://github.com/jstoup111/ai-conductor/pull/3311
shipped: 2026-10-21
engine_version: 20261021T104534Z-ab27d89b2af7
---

## Cost
input: 10397120
output: 1504675
cache_read: 329083716
cache_creation: 10330388
cost_usd: 234.0093
dispatches: 110
retries: 30
halts: 20
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 10396700, output: 822907, cache_read: 278394752, cache_creation: 0, cost_usd: 127.5914, dispatches: 60, cost_unmetered: 0
  claude: input: 420, output: 681768, cache_read: 50688964, cache_creation: 10330388, cost_usd: 106.4179, dispatches: 50, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","bfebbdaa-bc2d-481f-a586-c89fc4e15d35","lifecycle-step","finish"]

## Build Review
laps_to_pass: 1
skipped: 15
cache_hits: 5
infrastructure_failures: 0
rubrics:
  security: failures: 0, judged: 15
  testQuality: failures: 1, judged: 15
skip_reasons:
  disabled: 15
