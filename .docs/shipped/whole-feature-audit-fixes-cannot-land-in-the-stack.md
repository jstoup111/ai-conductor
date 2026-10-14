---
slug: whole-feature-audit-fixes-cannot-land-in-the-stack
spec_hash: 230def3879f3d531531af794282eb00f57e46e53331a9237c50b2b277f29415d
pr: https://github.com/jstoup111/ai-conductor/pull/3219
shipped: 2026-10-14
engine_version: 20261013T232617Z-b88e1a809619
---

## Cost
input: 4396906
output: 420480
cache_read: 121110277
cache_creation: 1556303
cost_usd: 61.7998
dispatches: 43
retries: 12
halts: 4
unmetered: count: 1, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 4396766, output: 327968, cache_read: 113083520, cache_creation: 0, cost_usd: 45.8932, dispatches: 30, cost_unmetered: 0
  claude: input: 140, output: 92512, cache_read: 8026757, cache_creation: 1556303, cost_usd: 15.9066, dispatches: 13, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","edbbdb92-80c5-4ac8-818b-efdeac3a737b","lifecycle-step","finish"]

## Build Review
laps_to_pass: 1
skipped: 2
cache_hits: 0
infrastructure_failures: 1
rubrics:
  eventSpine: failures: 0, judged: 2
  security: failures: 0, judged: 2
  testQuality: failures: 0, judged: 2
skip_reasons:
  disabled: 2
