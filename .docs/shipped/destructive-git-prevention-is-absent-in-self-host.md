---
slug: destructive-git-prevention-is-absent-in-self-host
spec_hash: a4d39ca2e679e011d9b0c8a509c3b742b966b301f07fcd53dc022437ddef5699
pr: https://github.com/jstoup111/ai-conductor/pull/2773
shipped: 2026-10-03
engine_version: 20261003T122408Z-086e998df5dd
---

## Cost
input: 10293187
output: 1410892
cache_read: 212299539
cache_creation: 5442794
cost_usd: 170.8942
dispatches: 403
retries: 21
halts: 29
unmetered: count: 241, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 10291843, output: 703398, cache_read: 164630016, cache_creation: 0, cost_usd: 92.4348, dispatches: 325, cost_unmetered: 0
  claude: input: 1344, output: 707494, cache_read: 47669523, cache_creation: 5442794, cost_usd: 78.4594, dispatches: 78, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","30de71e9-454c-4761-b438-264fb3b2d5d5","lifecycle-step","finish"]

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 7
  security: failures: 0, judged: 12
  testQuality: failures: 2, judged: 12
skip_reasons:
