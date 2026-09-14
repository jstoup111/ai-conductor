---
slug: unusable-provider-candidate-throws-instead-of-fall
spec_hash: f8488dea3ee94581bbd6c6ff803df823518b17ee636923ab611fa2ea3fdcc56c
pr: https://github.com/jstoup111/ai-conductor/pull/2538
shipped: 2026-09-14
engine_version: 20260914T134752Z-60233f3ba6d3
---

## Cost
input: 3331367
output: 460660
cache_read: 85266114
cache_creation: 1068078
cost_usd: 55.5379
dispatches: 42
retries: 10
halts: 2
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 3331021, output: 317828, cache_read: 74039040, cache_creation: 0, cost_usd: 35.671, dispatches: 28, cost_unmetered: 0
  claude: input: 346, output: 142832, cache_read: 11227074, cache_creation: 1068078, cost_usd: 19.8668, dispatches: 14, cost_unmetered: 0

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
