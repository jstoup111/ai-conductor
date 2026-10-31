---
slug: operator-command-to-inspect-and-recover-wedged-rou
spec_hash: 7bccd72681acb12b22b69692cb6f52113c67fbbbfc7bc84d930b7ab94bcf2377
pr: https://github.com/jstoup111/ai-conductor/pull/3542
shipped: 2026-10-31
engine_version: 20261031T004009Z-fa5d3fe03904
---

## Cost
input: 3587340
output: 276831
cache_read: 57713586
cache_creation: 1361190
cost_usd: 39.1978
dispatches: 65
retries: 6
halts: 2
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 13
providers:
  codex: input: 3587142, output: 174279, cache_read: 49536512, cache_creation: 0, cost_usd: 24.621, dispatches: 44, cost_unmetered: 13
  claude: input: 198, output: 102552, cache_read: 8177074, cache_creation: 1361190, cost_usd: 14.5768, dispatches: 21, cost_unmetered: 0

## Time
state: partial
reason: provider-outside-active-union

## Build Review
laps_to_pass: 2
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 6
  implementationQuality: failures: 1, judged: 6
  security: failures: 0, judged: 6
  testQuality: failures: 1, judged: 6
skip_reasons:
