---
slug: closeout-timing-events-record-wrong-units-inflatin
spec_hash: 54dbdc6c328fb6ee94bf1815de82f3eb2c03a6ddf960310a8a620bc8283dc96c
pr: https://github.com/jstoup111/ai-conductor/pull/3176
shipped: 2026-10-11
engine_version: 20261011T003623Z-5f233d35b433
---

## Cost
input: 633646
output: 70685
cache_read: 10193608
cache_creation: 220742
cost_usd: 7.5324
dispatches: 12
retries: 2
halts: 0
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 633594, output: 50394, cache_read: 9063296, cache_creation: 0, cost_usd: 5.1344, dispatches: 8, cost_unmetered: 0
  claude: input: 52, output: 20291, cache_read: 1130312, cache_creation: 220742, cost_usd: 2.398, dispatches: 4, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","0999fa20-1977-485e-818d-db63bd792912","lifecycle-step","finish"]

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 1
  security: failures: 0, judged: 1
  testQuality: failures: 0, judged: 1
skip_reasons:
