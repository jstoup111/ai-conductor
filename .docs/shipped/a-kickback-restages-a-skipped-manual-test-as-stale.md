---
slug: a-kickback-restages-a-skipped-manual-test-as-stale
spec_hash: df1d5c70e2d1dd2d01b539fcbb9e27c5f3bf33c4c114ffd9591c0deb10fdbb74
pr: https://github.com/jstoup111/ai-conductor/pull/2003
shipped: 2026-08-28
engine_version: 20260828T025200Z-9b9d43ffe944
---

## Cost
input: 2187190
output: 273508
cache_read: 51357785
cache_creation: 1362261
cost_usd: 43.6142
dispatches: 35
retries: 3
halts: 0
unmetered: count: 10, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 2186810, output: 135201, cache_read: 31709184, cache_creation: 0, cost_usd: 16.7077, dispatches: 15, cost_unmetered: 0
  claude: input: 380, output: 138307, cache_read: 19648601, cache_creation: 1362261, cost_usd: 26.9065, dispatches: 10, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:finish

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  testQuality: failures: 3, judged: 6
skip_reasons:
