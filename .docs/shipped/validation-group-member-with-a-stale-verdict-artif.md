---
slug: validation-group-member-with-a-stale-verdict-artif
spec_hash: 63a2c42cf6f729166de67dc3277344453f953ddb9f53e36940ffdc9d63353e6c
pr: https://github.com/jstoup111/ai-conductor/pull/3179
shipped: 2026-10-11
engine_version: 20261011T003623Z-5f233d35b433
---

## Cost
input: 1104303
output: 87867
cache_read: 19301657
cache_creation: 261097
cost_usd: 11.8895
dispatches: 18
retries: 4
halts: 0
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 1104219, output: 67497, cache_read: 17151232, cache_creation: 0, cost_usd: 8.9629, dispatches: 13, cost_unmetered: 0
  claude: input: 84, output: 20370, cache_read: 2150425, cache_creation: 261097, cost_usd: 2.9266, dispatches: 5, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","7c260d15-5218-4ee6-86f4-aa2715b687aa","lifecycle-step","finish"]

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 1
  security: failures: 0, judged: 1
  testQuality: failures: 0, judged: 1
skip_reasons:
