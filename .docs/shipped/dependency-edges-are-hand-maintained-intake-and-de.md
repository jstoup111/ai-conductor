---
slug: dependency-edges-are-hand-maintained-intake-and-de
spec_hash: c544a39b3db73c74547c1ed245f0f7ed6d97f1a51bbb7e526269790317993e0b
pr: https://github.com/jstoup111/ai-conductor/pull/3133
shipped: 2026-10-11
engine_version: 20261011T125659Z-cc1b0a49f473
---

## Cost
input: 2169424
output: 336167
cache_read: 49505197
cache_creation: 2192311
cost_usd: 49.7055
dispatches: 48
retries: 0
halts: 6
unmetered: count: 1, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 2169190, output: 129175, cache_read: 39796480, cache_creation: 0, cost_usd: 26.0845, dispatches: 23, cost_unmetered: 0
  claude: input: 234, output: 206992, cache_read: 9708717, cache_creation: 2192311, cost_usd: 23.621, dispatches: 25, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","1c98fc06-06dd-4613-8498-4d088e72752e","lifecycle-step","finish"]

## Build Review
laps_to_pass: 2
skipped: 0
cache_hits: 2
infrastructure_failures: 1
rubrics:
  eventSpine: failures: 0, judged: 6
  security: failures: 0, judged: 6
  testQuality: failures: 3, judged: 6
skip_reasons:
