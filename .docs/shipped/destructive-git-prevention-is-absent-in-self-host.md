---
slug: destructive-git-prevention-is-absent-in-self-host
spec_hash: a4d39ca2e679e011d9b0c8a509c3b742b966b301f07fcd53dc022437ddef5699
pr: https://github.com/jstoup111/ai-conductor/pull/2773
shipped: 2026-10-03
engine_version: 20261003T122408Z-086e998df5dd
---

## Cost
input: 10309576
output: 1411132
cache_read: 212332819
cache_creation: 5442794
cost_usd: 170.9365
dispatches: 404
retries: 21
halts: 29
unmetered: count: 241, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 10308232, output: 703638, cache_read: 164663296, cache_creation: 0, cost_usd: 92.4772, dispatches: 326, cost_unmetered: 0
  claude: input: 1344, output: 707494, cache_read: 47669523, cache_creation: 5442794, cost_usd: 78.4594, dispatches: 78, cost_unmetered: 0

## Time
state: partial
reason: provider-outside-active-union

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
