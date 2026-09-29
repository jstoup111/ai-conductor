---
slug: grade-diffs-for-event-spine-bypasses-in-build-revi
spec_hash: 739c306f6f7d474a8d97848b477c7794f67c46ed44d6758db51564b4cea24bb6
pr: https://github.com/jstoup111/ai-conductor/pull/2821
shipped: 2026-09-29
engine_version: 20260928T232244Z-91f41cedca69
---

## Cost
input: 695139
output: 48237
cache_read: 15576108
cache_creation: 149968
cost_usd: 7.8116
dispatches: 11
retries: 0
halts: 0
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 695111, output: 40141, cache_read: 14863104, cache_creation: 0, cost_usd: 6.3072, dispatches: 8, cost_unmetered: 0
  claude: input: 28, output: 8096, cache_read: 713004, cache_creation: 149968, cost_usd: 1.5044, dispatches: 3, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","8c25354b-8500-4bb2-ad2d-2af82d3ae22e","lifecycle-step","finish"]

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  security: failures: 0, judged: 1
  testQuality: failures: 0, judged: 1
skip_reasons:
