---
slug: engine-updates-reach-dispatched-features-only-afte
spec_hash: f28788a54e8aa80e38513d187c873ec1a7255077decc9626348cbc87e0e2259c
pr: https://github.com/jstoup111/ai-conductor/pull/3306
shipped: 2026-10-20
engine_version: 20261019T223530Z-89c498bda849
---

## Cost
input: 6455711
output: 1022599
cache_read: 265906087
cache_creation: 6278638
cost_usd: 161.9541
dispatches: 84
retries: 13
halts: 12
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 6455057, output: 528548, cache_read: 186525312, cache_creation: 0, cost_usd: 85.9652, dispatches: 40, cost_unmetered: 0
  claude: input: 654, output: 494051, cache_read: 79380775, cache_creation: 6278638, cost_usd: 75.9889, dispatches: 44, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","fcd7f976-71e8-4513-803f-cdb8b4d60466","lifecycle-step","finish"]

## Build Review
laps_to_pass: 1
skipped: 7
cache_hits: 0
infrastructure_failures: 0
rubrics:
  security: failures: 0, judged: 7
  testQuality: failures: 0, judged: 7
skip_reasons:
  disabled: 7
