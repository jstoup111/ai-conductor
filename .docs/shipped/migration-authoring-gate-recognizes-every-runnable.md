---
slug: migration-authoring-gate-recognizes-every-runnable
spec_hash: 4cbbb5a62844ff5c88b68d4b79957c674d84a19033d82bf95b2e9f1d26fe6b09
pr: https://github.com/jstoup111/ai-conductor/pull/2226
shipped: 2026-09-05
engine_version: 20260905T212222Z-dbc805b66e06
---

## Cost
input: 1343635
output: 272148
cache_read: 42665393
cache_creation: 833441
cost_usd: 35.2743
dispatches: 34
retries: 1
halts: 1
unmetered: count: 12, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 1343145, output: 109828, cache_read: 24994816, cache_creation: 0, cost_usd: 14.0442, dispatches: 12, cost_unmetered: 0
  claude: input: 490, output: 162320, cache_read: 17670577, cache_creation: 833441, cost_usd: 21.2301, dispatches: 10, cost_unmetered: 0

## Time
state: partial
reason: open-executions:parallel:prd_audit,step:finish

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 1
infrastructure_failures: 1
rubrics:
  testQuality: failures: 0, judged: 3
skip_reasons:
