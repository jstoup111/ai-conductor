---
slug: one-rubric-s-rejected-contract-discards-the-whole-
spec_hash: 15d254c1aac0547564eefdd47f928f9e706e9b92e4df69562bec04d7e5f5ad39
pr: https://github.com/jstoup111/ai-conductor/pull/1801
shipped: 2026-08-22
engine_version: 20260822T023807Z-4059d30ee5fc
---

## Cost
input: 2009367
output: 160163
cache_read: 36460557
cache_creation: 305258
cost_usd: 6.3175
dispatches: 34
retries: 4
halts: 1
unmetered: count: 8, duration_ms: 0
cost_unmetered: count: 21
providers:
  codex: input: 2009243, output: 131220, cache_read: 31379200, cache_creation: 0, cost_usd: 0, dispatches: 21, cost_unmetered: 21
  claude: input: 124, output: 28943, cache_read: 5081357, cache_creation: 305258, cost_usd: 6.3175, dispatches: 9, cost_unmetered: 0

## Time
state: partial
reason: open-executions:parallel:wiring_check,step:acceptance_specs,step:finish

## Build Review
laps_to_pass: 3
skipped: 3
cache_hits: 0
infrastructure_failures: 0
rubrics:
  completeness: failures: 2, judged: 3
  rootCause: failures: 0, judged: 3
  scope: failures: 0, judged: 3
skip_reasons:
  disabled: 3
