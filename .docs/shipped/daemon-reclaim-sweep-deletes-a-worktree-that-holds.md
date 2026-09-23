---
slug: daemon-reclaim-sweep-deletes-a-worktree-that-holds
spec_hash: f80a044d8149fea92b0cac31fd0020e85a1e2e955a10c617882ce58699270356
pr: https://github.com/jstoup111/ai-conductor/pull/2649
shipped: 2026-09-23
engine_version: 20260923T174345Z-bac5a548b9cc
---

## Cost
input: 2354381
output: 347738
cache_read: 47412759
cache_creation: 1421140
cost_usd: 44.5949
dispatches: 69
retries: 9
halts: 12
unmetered: count: 18, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 2354027, output: 216598, cache_read: 35193344, cache_creation: 0, cost_usd: 22.4755, dispatches: 29, cost_unmetered: 0
  claude: input: 354, output: 131140, cache_read: 12219415, cache_creation: 1421140, cost_usd: 22.1194, dispatches: 40, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","7598f596-c556-48af-b2ef-2f078dbef761","lifecycle-step","finish"],step:execution\u0000["timing-rollup","persisted-ledger","76ae1ad3-4a51-4a02-9944-01c011311981","lifecycle-step","build"]

## Build Review
laps_to_pass: 4
skipped: 0
cache_hits: 16
infrastructure_failures: 6
rubrics:
  security: failures: 0, judged: 14
  testQuality: failures: 0, judged: 14
skip_reasons:
