---
slug: finish-validates-shipped-record-slug-instead-of-fi
spec_hash: 568dd9862bb5db087eaf454e368aa635f5b3a57c6eabc8b2915eb5663b5b135a
pr: https://github.com/jstoup111/ai-conductor/pull/2732
shipped: 2026-09-24
engine_version: 20260924T134314Z-2bce17700f0b
---

## Cost
input: 799313
output: 53013
cache_read: 10229756
cache_creation: 81232
cost_usd: 6.0031
dispatches: 11
retries: 0
halts: 0
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 799293, output: 46839, cache_read: 9802496, cache_creation: 0, cost_usd: 5.1442, dispatches: 9, cost_unmetered: 0
  claude: input: 20, output: 6174, cache_read: 427260, cache_creation: 81232, cost_usd: 0.8589, dispatches: 2, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","5f849c3a-9265-4538-af13-d7f6d54e87de","lifecycle-step","finish"]

## Build Review
laps_to_pass: 1
skipped: 1
cache_hits: 0
infrastructure_failures: 0
rubrics:
  security: failures: 0, judged: 1
skip_reasons:
  test_quality_empty_scope: 1
