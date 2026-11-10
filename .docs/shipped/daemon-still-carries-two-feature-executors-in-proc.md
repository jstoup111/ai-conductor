---
slug: daemon-still-carries-two-feature-executors-in-proc
spec_hash: a51733e04cb17b7efed066f3a344167d88d551e2e9b57ee9eca45ed8e6ea500f
pr: https://github.com/jstoup111/ai-conductor/pull/3665
shipped: 2026-11-10
engine_version: 20261109T160131Z-3c6fb4eda614
---

## Cost
input: 7987151
output: 864806
cache_read: 220365084
cache_creation: 5720077
cost_usd: 133.5281
dispatches: 103
retries: 13
halts: 26
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 7986307, output: 563701, cache_read: 160259200, cache_creation: 0, cost_usd: 69.7208, dispatches: 71, cost_unmetered: 0
  claude: input: 844, output: 301105, cache_read: 60105884, cache_creation: 5720077, cost_usd: 63.8073, dispatches: 32, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","de160feb-8f51-4a17-92d0-0169bfa720ad","lifecycle-step","finish"]

## Build Review
laps_to_pass: 1
skipped: 12
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 8
  implementationQuality: failures: 0, judged: 8
  security: failures: 0, judged: 4
  testQuality: failures: 0, judged: 5
skip_reasons:
  leaf-only: 4
  paths-unmatched: 5
  test_quality_empty_scope: 3
