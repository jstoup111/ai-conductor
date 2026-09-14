---
slug: reliable-disk-backed-test-temporary-storage-for-co
spec_hash: b7e99a8a213f7879c0615eeb2577e3333b9d52f5b056ce8e17661e04977b2e0b
pr: https://github.com/jstoup111/ai-conductor/pull/2537
shipped: 2026-09-14
engine_version: 20260914T134752Z-60233f3ba6d3
---

## Cost
input: 1897167
output: 340202
cache_read: 53777434
cache_creation: 2043467
cost_usd: 56.6667
dispatches: 37
retries: 5
halts: 4
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 1896881, output: 178248, cache_read: 36789120, cache_creation: 0, cost_usd: 17.3553, dispatches: 19, cost_unmetered: 0
  claude: input: 286, output: 161954, cache_read: 16988314, cache_creation: 2043467, cost_usd: 39.3115, dispatches: 18, cost_unmetered: 0

## Time
state: partial
reason: open-executions:parallel:prd_audit

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  testQuality: failures: 2, judged: 6
skip_reasons:
