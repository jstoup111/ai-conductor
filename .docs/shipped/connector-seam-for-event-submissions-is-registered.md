---
slug: connector-seam-for-event-submissions-is-registered
spec_hash: 32d8ee4016b4de2d667cd1a41d609fd154a87c505b978762db92dcf7903a8386
pr: https://github.com/jstoup111/ai-conductor/pull/1958
shipped: 2026-08-27
engine_version: 20260827T134019Z-eaa70631ea5e
---

## Cost
input: 1913136
output: 260613
cache_read: 51296370
cache_creation: 986199
cost_usd: 39.4213
dispatches: 28
retries: 2
halts: 2
unmetered: count: 6, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 1912768, output: 142621, cache_read: 35171584, cache_creation: 0, cost_usd: 18.5452, dispatches: 13, cost_unmetered: 0
  claude: input: 368, output: 117992, cache_read: 16124786, cache_creation: 986199, cost_usd: 20.876, dispatches: 9, cost_unmetered: 0

## Time
state: partial
reason: open-executions:parallel:prd_audit,step:build,step:finish

## Build Review
laps_to_pass: 2
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  testQuality: failures: 1, judged: 3
skip_reasons:
