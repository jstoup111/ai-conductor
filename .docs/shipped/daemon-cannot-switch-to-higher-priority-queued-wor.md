---
slug: daemon-cannot-switch-to-higher-priority-queued-wor
spec_hash: a27632194f948d4ebf309b0e8254051e8c4e109e03a1d74f8ee0b05b3d9d3e7d
pr: https://github.com/jstoup111/ai-conductor/pull/3647
shipped: 2026-11-08
engine_version: 20261108T141634Z-8505c2b5a069
---

## Cost
input: 1420614
output: 123119
cache_read: 27004708
cache_creation: 666822
cost_usd: 18.2344
dispatches: 28
retries: 2
halts: 1
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 1420504, output: 80822, cache_read: 23267328, cache_creation: 0, cost_usd: 11.3059, dispatches: 19, cost_unmetered: 0
  claude: input: 110, output: 42297, cache_read: 3737380, cache_creation: 666822, cost_usd: 6.9284, dispatches: 9, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","940ff7bd-42ff-416d-b120-5969c4da12af","lifecycle-step","finish"]

## Build Review
laps_to_pass: 2
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 2, judged: 2
  implementationQuality: failures: 0, judged: 2
  security: failures: 0, judged: 2
  testQuality: failures: 0, judged: 2
skip_reasons:
