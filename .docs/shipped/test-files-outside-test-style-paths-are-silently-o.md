---
slug: test-files-outside-test-style-paths-are-silently-o
spec_hash: fbf675f58cb9f16f9ffcc31cd3b263730d82a72d568c08288dee71d1c511c5e5
pr: https://github.com/jstoup111/ai-conductor/pull/3092
shipped: 2026-10-10
engine_version: 20261010T142412Z-f61646aaea57
---

## Cost
input: 967970
output: 102316
cache_read: 18009698
cache_creation: 375908
cost_usd: 12.7009
dispatches: 21
retries: 1
halts: 1
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 967894, output: 67314, cache_read: 16514176, cache_creation: 0, cost_usd: 8.6942, dispatches: 12, cost_unmetered: 0
  claude: input: 76, output: 35002, cache_read: 1495522, cache_creation: 375908, cost_usd: 4.0067, dispatches: 9, cost_unmetered: 0

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
  security: failures: 0, judged: 2
  testQuality: failures: 1, judged: 2
skip_reasons:
