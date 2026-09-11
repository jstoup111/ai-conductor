---
slug: report-live-durable-intake-queue-depth-in-brain-st
spec_hash: 5278281344ef9dd3a362598a3a596f085ed662d993ae1681ef81f1d98484ba72
pr: https://github.com/jstoup111/ai-conductor/pull/2510
shipped: 2026-09-11
engine_version: 20260910T220211Z-39b4ec92e0a6
---

## Cost
input: 801040
output: 90195
cache_read: 15739596
cache_creation: 404390
cost_usd: 12.0611
dispatches: 16
retries: 3
halts: 0
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 800970, output: 67784, cache_read: 13767680, cache_creation: 0, cost_usd: 6.4706, dispatches: 10, cost_unmetered: 0
  claude: input: 70, output: 22411, cache_read: 1971916, cache_creation: 404390, cost_usd: 5.5905, dispatches: 6, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:finish

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  testQuality: failures: 0, judged: 2
skip_reasons:
