---
slug: integrity-suite-two-checks-cannot-fail-one-warns-p
spec_hash: f462a911d1f370ef879f623748e4b714f4a4a3ef0f5779e57cac95fec1d47b26
pr: https://github.com/jstoup111/ai-conductor/pull/3240
shipped: 2026-10-15
engine_version: 20261015T004522Z-65702d1bcf72
---

## Cost
input: 559381
output: 62573
cache_read: 10605405
cache_creation: 286165
cost_usd: 8.5596
dispatches: 10
retries: 0
halts: 0
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 559313, output: 36955, cache_read: 8716160, cache_creation: 0, cost_usd: 5.3798, dispatches: 6, cost_unmetered: 0
  claude: input: 68, output: 25618, cache_read: 1889245, cache_creation: 286165, cost_usd: 3.1798, dispatches: 4, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","7f15db4a-fe90-4863-9901-7a115d52e70c","lifecycle-step","finish"]

## Build Review
laps_to_pass: 1
skipped: 1
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 1
  security: failures: 0, judged: 1
  testQuality: failures: 0, judged: 1
skip_reasons:
  disabled: 1
