---
slug: off-tag-checkout-reports-up-to-date-forever-tagged
spec_hash: a618b3d3e4517b71028988bc3f4202b8a6ef040e490820d5c396ac5d673bd57a
pr: https://github.com/jstoup111/ai-conductor/pull/1578
shipped: 2026-08-18
engine_version: 20260818T094036Z-4cd4f6b8878b
---

## Cost
input: 58177655
output: 276369
cache_read: 66037788
cache_creation: 613051
cost_usd: 13.7753
dispatches: 55
retries: 15
halts: 5
unmetered: count: 19, duration_ms: 0
cost_unmetered: count: 30
providers:
  codex: input: 58177423, output: 203481, cache_read: 54943232, cache_creation: 0, cost_usd: 0, dispatches: 35, cost_unmetered: 30
  claude: input: 232, output: 72888, cache_read: 11094556, cache_creation: 613051, cost_usd: 13.7753, dispatches: 12, cost_unmetered: 0

## Time
state: partial

## Build Review
laps_to_pass: 3
skipped: 0
cache_hits: 16
infrastructure_failures: 0
rubrics:
  completeness: failures: 3, judged: 7
  rootCause: failures: 0, judged: 7
  scope: failures: 6, judged: 7
  tautology: failures: 6, judged: 7
skip_reasons:
