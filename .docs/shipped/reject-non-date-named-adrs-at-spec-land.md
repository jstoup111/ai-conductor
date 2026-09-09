---
slug: reject-non-date-named-adrs-at-spec-land
spec_hash: 45dbcf2e1352ae96dc18e9f515cb2515a68145d1cf495aa4290a06a073607a8d
pr: https://github.com/jstoup111/ai-conductor/pull/2450
shipped: 2026-09-09
engine_version: 20260909T144830Z-b97e8d600456
---

## Cost
input: 729379
output: 89868
cache_read: 17817149
cache_creation: 543198
cost_usd: 15.2846
dispatches: 11
retries: 0
halts: 1
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 729271, output: 47666, cache_read: 13012608, cache_creation: 0, cost_usd: 5.9015, dispatches: 7, cost_unmetered: 0
  claude: input: 108, output: 42202, cache_read: 4804541, cache_creation: 543198, cost_usd: 9.383, dispatches: 4, cost_unmetered: 0

## Time
state: partial
reason: open-executions:parallel:prd_audit,step:finish

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  testQuality: failures: 0, judged: 2
skip_reasons:
