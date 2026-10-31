---
slug: operator-command-to-inspect-and-recover-wedged-rou
spec_hash: 7bccd72681acb12b22b69692cb6f52113c67fbbbfc7bc84d930b7ab94bcf2377
pr: https://github.com/jstoup111/ai-conductor/pull/3542
shipped: 2026-10-31
engine_version: 20261031T004009Z-fa5d3fe03904
---

## Cost
input: 3570313
output: 276678
cache_read: 57650994
cache_creation: 1361190
cost_usd: 39.1978
dispatches: 64
retries: 6
halts: 2
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 12
providers:
  codex: input: 3570115, output: 174126, cache_read: 49473920, cache_creation: 0, cost_usd: 24.621, dispatches: 43, cost_unmetered: 12
  claude: input: 198, output: 102552, cache_read: 8177074, cache_creation: 1361190, cost_usd: 14.5768, dispatches: 21, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","151e9761-9c7f-4c41-b9b0-aa759e7f51c8","lifecycle-step","finish"]

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
