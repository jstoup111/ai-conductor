---
slug: 30-of-33-bash-tests-never-execute-and-smoke-gating
spec_hash: a7c978a11b028779473e7a026975afce4849f4b2acf639475f3b6e58fcf8aa10
pr: https://github.com/jstoup111/ai-conductor/pull/3174
shipped: 2026-10-11
engine_version: 20261011T003623Z-5f233d35b433
---

## Cost
input: 663960
output: 79354
cache_read: 17199960
cache_creation: 269523
cost_usd: 10.4823
dispatches: 10
retries: 1
halts: 0
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 663906, output: 57009, cache_read: 15695744, cache_creation: 0, cost_usd: 7.5782, dispatches: 7, cost_unmetered: 0
  claude: input: 54, output: 22345, cache_read: 1504216, cache_creation: 269523, cost_usd: 2.9041, dispatches: 3, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","ecd1c211-1db9-416d-b49f-c4799da92183","lifecycle-step","finish"]

## Build Review
laps_to_pass: not reached
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
skip_reasons:
