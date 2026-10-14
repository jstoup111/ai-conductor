---
slug: pipeline-batch-evaluators-remain-an-unenforced-sec
spec_hash: e32ac84573c0a476d82124af601e3065034a7221772e1c02ddd9050e9e48ebb4
pr: https://github.com/jstoup111/ai-conductor/pull/3224
shipped: 2026-10-14
engine_version: 20261014T105640Z-87fdea4376c8
---

## Cost
input: 2030268
output: 196408
cache_read: 44486180
cache_creation: 466616
cost_usd: 22.9741
dispatches: 17
retries: 6
halts: 0
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 2030188, output: 165730, cache_read: 40974592, cache_creation: 0, cost_usd: 17.925, dispatches: 14, cost_unmetered: 0
  claude: input: 80, output: 30678, cache_read: 3511588, cache_creation: 466616, cost_usd: 5.0491, dispatches: 3, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","4f6c5fea-9f07-4972-ab1f-409f96626ba9","lifecycle-step","finish"]

## Build Review
laps_to_pass: 1
skipped: 2
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 1
  security: failures: 0, judged: 1
skip_reasons:
  disabled: 1
  test_quality_empty_scope: 1
