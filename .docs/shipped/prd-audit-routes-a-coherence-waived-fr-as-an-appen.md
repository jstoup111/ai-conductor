---
slug: prd-audit-routes-a-coherence-waived-fr-as-an-appen
spec_hash: b9607ba3f07f50f24efbf448a85e274f18db7041667a5528a53a744ba30887d5
pr: https://github.com/jstoup111/ai-conductor/pull/3084
shipped: 2026-10-10
engine_version: 20261010T114134Z-4e4622f26cf4
---

## Cost
input: 426887
output: 40717
cache_read: 8881033
cache_creation: 155456
cost_usd: 5.8156
dispatches: 12
retries: 0
halts: 2
unmetered: count: 1, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 426823, output: 25950, cache_read: 7653632, cache_creation: 0, cost_usd: 4.0309, dispatches: 8, cost_unmetered: 0
  claude: input: 64, output: 14767, cache_read: 1227401, cache_creation: 155456, cost_usd: 1.7847, dispatches: 4, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","fa140060-9f7b-4954-9fab-ee6e55915ccb","lifecycle-step","finish"]

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 1
rubrics:
  eventSpine: failures: 0, judged: 1
  security: failures: 0, judged: 1
  testQuality: failures: 0, judged: 1
skip_reasons:
