---
slug: cover-nested-bin-shell-files-in-both-lint-gates
spec_hash: 5b6c73a5540c2f07cf12790f516414383a85b4b592af5afc93c69066579a6050
pr: https://github.com/jstoup111/ai-conductor/pull/2408
shipped: 2026-09-15
engine_version: 20260915T052256Z-1abdc040ee64
---

## Cost
input: 645795
output: 107882
cache_read: 12735468
cache_creation: 275889
cost_usd: 10.9088
dispatches: 13
retries: 1
halts: 2
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 645717, output: 69406, cache_read: 10866304, cache_creation: 0, cost_usd: 6.253, dispatches: 8, cost_unmetered: 0
  claude: input: 78, output: 38476, cache_read: 1869164, cache_creation: 275889, cost_usd: 4.6558, dispatches: 5, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:finish

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
skip_reasons:
