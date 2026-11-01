---
slug: routed-repair-hosts-a-finding-on-a-stack-child-tha
spec_hash: 36b86c4588e3acd4109ccb06e18c28290cc5d87b3524c84c0529077111d32fc1
pr: https://github.com/jstoup111/ai-conductor/pull/3567
shipped: 2026-11-01
engine_version: 20261101T162011Z-b317a8dbaaa5
---

## Cost
input: 3787646
output: 360254
cache_read: 62225426
cache_creation: 1713150
cost_usd: 47.7193
dispatches: 75
retries: 12
halts: 2
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 10
providers:
  codex: input: 3787434, output: 203874, cache_read: 55079680, cache_creation: 0, cost_usd: 29.4565, dispatches: 49, cost_unmetered: 10
  claude: input: 212, output: 156380, cache_read: 7145746, cache_creation: 1713150, cost_usd: 18.2628, dispatches: 26, cost_unmetered: 0

## Time
state: partial
reason: provider-outside-active-union

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 6
  implementationQuality: failures: 1, judged: 6
  security: failures: 0, judged: 6
  testQuality: failures: 1, judged: 6
skip_reasons:
