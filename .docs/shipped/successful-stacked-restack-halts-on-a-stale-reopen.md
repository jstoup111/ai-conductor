---
slug: successful-stacked-restack-halts-on-a-stale-reopen
spec_hash: 460ec0617f9b3e6207b2f3737d223100ef6fb1d0a0a44e6d387471140aa8534c
pr: https://github.com/jstoup111/ai-conductor/pull/3515
shipped: 2026-10-28
engine_version: 20261028T113352Z-172d3daf40b7
---

## Cost
input: 913088
output: 69170
cache_read: 20320249
cache_creation: 238972
cost_usd: 10.339
dispatches: 15
retries: 2
halts: 1
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 913046, output: 54842, cache_read: 19419392, cache_creation: 0, cost_usd: 7.9604, dispatches: 10, cost_unmetered: 0
  claude: input: 42, output: 14328, cache_read: 900857, cache_creation: 238972, cost_usd: 2.3787, dispatches: 5, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","be466462-7a06-4773-9dda-4d585608a863","lifecycle-step","finish"]

## Build Review
laps_to_pass: not reached
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 1
  implementationQuality: failures: 1, judged: 1
  security: failures: 0, judged: 1
  testQuality: failures: 0, judged: 1
skip_reasons:
