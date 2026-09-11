---
slug: github-issue-text-reaches-an-autonomous-build-with
spec_hash: 185a3fa6efc98b6b25c268b689eaa850a36b926f5f7de30708cc0addceafc78b
pr: https://github.com/jstoup111/ai-conductor/pull/2372
shipped: 2026-09-11
engine_version: 20260910T220211Z-39b4ec92e0a6
---

## Cost
input: 3455956
output: 840976
cache_read: 122489165
cache_creation: 4401946
cost_usd: 149.4283
dispatches: 116
retries: 9
halts: 18
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 3454848, output: 306903, cache_read: 63783936, cache_creation: 0, cost_usd: 36.2125, dispatches: 84, cost_unmetered: 0
  claude: input: 1108, output: 534073, cache_read: 58705229, cache_creation: 4401946, cost_usd: 113.2158, dispatches: 32, cost_unmetered: 0

## Time
state: partial
reason: open-executions:parallel:prd_audit,step:build_review

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 4
infrastructure_failures: 1
rubrics:
  testQuality: failures: 0, judged: 15
skip_reasons:
