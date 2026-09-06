---
slug: sweep-stale-vitest-run-temp-roots-at-global-setup-
spec_hash: e5b5df25a0b8f7eb5556973230407dd501bc00f9abeaac5b838631d42f158062
pr: https://github.com/jstoup111/ai-conductor/pull/2249
shipped: 2026-09-06
engine_version: 20260906T032235Z-0c471cd2a03d
---

## Cost
input: 2346783
output: 387148
cache_read: 55259621
cache_creation: 1426111
cost_usd: 52.4164
dispatches: 60
retries: 0
halts: 8
unmetered: count: 25, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 2346207, output: 192361, cache_read: 35509376, cache_creation: 0, cost_usd: 23.4077, dispatches: 17, cost_unmetered: 0
  claude: input: 576, output: 194787, cache_read: 19750245, cache_creation: 1426111, cost_usd: 29.0088, dispatches: 27, cost_unmetered: 0

## Time
state: partial
reason: open-executions:parallel:prd_audit,step:build_review

## Build Review
laps_to_pass: 2
skipped: 0
cache_hits: 0
infrastructure_failures: 6
rubrics:
  testQuality: failures: 0, judged: 3
skip_reasons:
