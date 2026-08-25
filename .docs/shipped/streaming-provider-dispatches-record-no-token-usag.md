---
slug: streaming-provider-dispatches-record-no-token-usag
spec_hash: 8d6817fa895c71bdb513a5c804bf38ef7b7b20ccd0ce533b0a0929a2c821e588
pr: https://github.com/jstoup111/ai-conductor/pull/1871
shipped: 2026-08-25
engine_version: 20260825T031141Z-c0e4d818f137
---

## Cost
input: 1009561
output: 89677
cache_read: 47080162
cache_creation: 70323
cost_usd: 14.5033
dispatches: 25
retries: 3
halts: 1
unmetered: count: 19, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 1009533, output: 76504, cache_read: 46146304, cache_creation: 0, cost_usd: 13.0037, dispatches: 19, cost_unmetered: 0
  claude: input: 28, output: 13173, cache_read: 933858, cache_creation: 70323, cost_usd: 1.4996, dispatches: 3, cost_unmetered: 0

## Time
state: partial
reason: open-executions:parallel:prd_audit

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
skip_reasons:
