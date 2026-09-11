---
slug: roll-back-a-failed-rewind-fully-including-never-ru
spec_hash: 4c008d2ed703e14fa55394b316822844ac8c23a3569dcc363898acb237c98562
pr: https://github.com/jstoup111/ai-conductor/pull/2512
shipped: 2026-09-11
engine_version: 20260910T220211Z-39b4ec92e0a6
---

## Cost
input: 385171
output: 49420
cache_read: 10485390
cache_creation: 189197
cost_usd: 6.6106
dispatches: 7
retries: 0
halts: 0
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 385141, output: 35877, cache_read: 9198848, cache_creation: 0, cost_usd: 3.7366, dispatches: 5, cost_unmetered: 0
  claude: input: 30, output: 13543, cache_read: 1286542, cache_creation: 189197, cost_usd: 2.874, dispatches: 2, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:finish

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  testQuality: failures: 0, judged: 1
skip_reasons:
