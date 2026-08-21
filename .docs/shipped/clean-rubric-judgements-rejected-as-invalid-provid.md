---
slug: clean-rubric-judgements-rejected-as-invalid-provid
spec_hash: 2c786cb409b3cd941ca3afb7017cbda81e6ce2b2c3f5ac12e9fca24c55f3e6be
pr: https://github.com/jstoup111/ai-conductor/pull/1748
shipped: 2026-08-21
engine_version: 20260821T000445Z-e767b0d2bc93
---

## Cost
input: 4968185
output: 570896
cache_read: 114343742
cache_creation: 2947900
cost_usd: 59.8815
dispatches: 95
retries: 35
halts: 12
unmetered: count: 9, duration_ms: 0
cost_unmetered: count: 66
providers:
  codex: input: 4967435, output: 296541, cache_read: 67264000, cache_creation: 0, cost_usd: 0, dispatches: 66, cost_unmetered: 66
  claude: input: 750, output: 274355, cache_read: 47079742, cache_creation: 2947900, cost_usd: 59.8815, dispatches: 20, cost_unmetered: 0

## Time
state: partial
reason: open-executions:parallel:wiring_check

## Build Review
laps_to_pass: not reached
skipped: 0
cache_hits: 74
infrastructure_failures: 8
rubrics:
  completeness: failures: 12, judged: 30
  rootCause: failures: 18, judged: 30
  scope: failures: 6, judged: 22
  tautology: failures: 15, judged: 30
skip_reasons:
