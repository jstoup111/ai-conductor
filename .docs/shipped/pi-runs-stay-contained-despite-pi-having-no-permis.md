---
slug: pi-runs-stay-contained-despite-pi-having-no-permis
spec_hash: 1cdb7e10a6fde3a2a5fb4cc825407ba6d735e83439febf8e45457ff37c89efbd
pr: https://github.com/jstoup111/ai-conductor/pull/2896
shipped: 2026-10-03
engine_version: 20261003T190855Z-1725f930ca6b
---

## Cost
input: 1614638
output: 233116
cache_read: 34231018
cache_creation: 815141
cost_usd: 23.7957
dispatches: 37
retries: 4
halts: 8
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 1614354, output: 119813, cache_read: 23689216, cache_creation: 0, cost_usd: 11.8737, dispatches: 22, cost_unmetered: 0
  claude: input: 284, output: 113303, cache_read: 10541802, cache_creation: 815141, cost_usd: 11.922, dispatches: 15, cost_unmetered: 0

## Time
state: partial
reason: provider-outside-active-union

## Build Review
laps_to_pass: 2
skipped: 2
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 3
  security: failures: 1, judged: 3
  testQuality: failures: 0, judged: 1
skip_reasons:
  test_quality_empty_scope: 2
