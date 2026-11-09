---
slug: a-partial-stack-merge-or-mid-stack-push-halts-the-
spec_hash: 359085d80618659ee5e7af6ece2b8add3d0da1fadafb48d7a2c7c6f9b3fdd5a4
pr: https://github.com/jstoup111/ai-conductor/pull/3563
shipped: 2026-11-01
engine_version: 20261101T015528Z-96cf58b597a4
---

## Cost
input: 811369
output: 54264
cache_read: 15512601
cache_creation: 281445
cost_usd: 8.6306
dispatches: 19
retries: 1
halts: 1
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 4
providers:
  codex: input: 811313, output: 40241, cache_read: 14615680, cache_creation: 0, cost_usd: 5.9189, dispatches: 12, cost_unmetered: 4
  claude: input: 56, output: 14023, cache_read: 896921, cache_creation: 281445, cost_usd: 2.7116, dispatches: 7, cost_unmetered: 0

## Time
state: partial
reason: provider-outside-active-union

## Build Review
laps_to_pass: 2
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 2
  implementationQuality: failures: 1, judged: 2
  security: failures: 0, judged: 2
  testQuality: failures: 0, judged: 2
skip_reasons:
