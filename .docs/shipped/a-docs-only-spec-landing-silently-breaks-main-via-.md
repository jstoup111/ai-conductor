---
slug: a-docs-only-spec-landing-silently-breaks-main-via-
spec_hash: af3b7029356da8f717381ad3691125a3a5e8df76315e806727cadf4ad5f2a3fc
pr: https://github.com/jstoup111/ai-conductor/pull/3168
shipped: 2026-10-11
engine_version: 20261011T003623Z-5f233d35b433
---

## Cost
input: 383611
output: 35363
cache_read: 7936703
cache_creation: 167696
cost_usd: 5.5856
dispatches: 9
retries: 0
halts: 0
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 383577, output: 23159, cache_read: 7347968, cache_creation: 0, cost_usd: 3.8821, dispatches: 5, cost_unmetered: 0
  claude: input: 34, output: 12204, cache_read: 588735, cache_creation: 167696, cost_usd: 1.7035, dispatches: 4, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","4c8c4685-03f5-44a7-8ade-e8f37caeb5eb","lifecycle-step","finish"]

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 1
  security: failures: 0, judged: 1
  testQuality: failures: 0, judged: 1
skip_reasons:
