---
slug: record-land-gate-rejections-on-the-event-spine
spec_hash: 5c0e8271e3b559c06b0c4bcc7d7ef2b1936105811d14fb0c61075606946fa61e
pr: https://github.com/jstoup111/ai-conductor/pull/2447
shipped: 2026-09-15
engine_version: 20260914T211543Z-5da62d0036d1
---

## Cost
input: 4156578
output: 532803
cache_read: 82684493
cache_creation: 2228341
cost_usd: 74.2756
dispatches: 60
retries: 5
halts: 11
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 4156052, output: 318069, cache_read: 66302336, cache_creation: 0, cost_usd: 36.4723, dispatches: 33, cost_unmetered: 0
  claude: input: 526, output: 214734, cache_read: 16382157, cache_creation: 2228341, cost_usd: 37.8033, dispatches: 27, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:finish

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  testQuality: failures: 0, judged: 6
skip_reasons:
