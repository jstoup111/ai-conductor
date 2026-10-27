---
slug: stack-preflight-refusals-end-the-run-with-no-halt-
spec_hash: e21ae943e4536b3f1e6e91c8ef7d8646b5cc825767c83e4363d19b1b9280a325
pr: https://github.com/jstoup111/ai-conductor/pull/3470
shipped: 2026-10-27
engine_version: 20261027T031452Z-97f09b9bd067
---

## Cost
input: 870323
output: 86122
cache_read: 29582488
cache_creation: 477665
cost_usd: 16.2435
dispatches: 15
retries: 0
halts: 1
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 870239, output: 51211, cache_read: 26890368, cache_creation: 0, cost_usd: 11.1852, dispatches: 9, cost_unmetered: 0
  claude: input: 84, output: 34911, cache_read: 2692120, cache_creation: 477665, cost_usd: 5.0583, dispatches: 6, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","4cacf779-9b66-4242-be0e-0c5d4c36ceab","lifecycle-step","finish"]

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
