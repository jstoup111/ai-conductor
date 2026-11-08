---
slug: manual-test-failure-routed-to-a-child-that-can-t-h
spec_hash: b7cac449040237af9d72799af1209901c3b1f64596da029dca52799566661523
pr: https://github.com/jstoup111/ai-conductor/pull/3655
shipped: 2026-11-08
engine_version: 20261108T000318Z-7a2ff38b78c5
---

## Cost
input: 3472723
output: 314869
cache_read: 71013876
cache_creation: 1898913
cost_usd: 49.9429
dispatches: 63
retries: 6
halts: 0
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 3472495, output: 211203, cache_read: 63699840, cache_creation: 0, cost_usd: 31.2146, dispatches: 40, cost_unmetered: 0
  claude: input: 228, output: 103666, cache_read: 7314036, cache_creation: 1898913, cost_usd: 18.7283, dispatches: 23, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","ec6a4bd3-9b80-4098-a881-2dac50af5848","lifecycle-step","finish"]

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 6
  implementationQuality: failures: 1, judged: 6
  security: failures: 0, judged: 6
  testQuality: failures: 1, judged: 6
skip_reasons:
