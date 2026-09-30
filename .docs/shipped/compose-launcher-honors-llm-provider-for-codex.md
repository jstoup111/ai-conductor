---
slug: compose-launcher-honors-llm-provider-for-codex
spec_hash: 1249452de9569db78b5807b2c8d59ba3664e85ec4c677597497cb5a4e6b38b5b
pr: https://github.com/jstoup111/ai-conductor/pull/2844
shipped: 2026-09-30
engine_version: 20260930T103720Z-7384b902bf38
---

## Cost
input: 1948989
output: 213564
cache_read: 36332515
cache_creation: 1060865
cost_usd: 27.0273
dispatches: 50
retries: 3
halts: 8
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 1948703, output: 125260, cache_read: 28556416, cache_creation: 0, cost_usd: 15.4813, dispatches: 27, cost_unmetered: 0
  claude: input: 286, output: 88304, cache_read: 7776099, cache_creation: 1060865, cost_usd: 11.5461, dispatches: 23, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","c4d1e55f-b08a-48f2-a446-8a133a9981a4","lifecycle-step","finish"]

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 5
  security: failures: 0, judged: 5
  testQuality: failures: 1, judged: 5
skip_reasons:
