---
slug: stop-counting-provider-free-step-completions-as-un
spec_hash: 50791120a061e3eaab5c1d81f89da910ab0e1184fda88cbd1d64c097cc3ff465
pr: https://github.com/jstoup111/ai-conductor/pull/2401
shipped: 2026-09-07
engine_version: 20260907T120758Z-4f8bdec36946
---

## Cost
input: 793199
output: 113492
cache_read: 16409287
cache_creation: 451569
cost_usd: 13.9756
dispatches: 22
retries: 1
halts: 1
unmetered: count: 8, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 793115, output: 62173, cache_read: 13482368, cache_creation: 0, cost_usd: 6.1895, dispatches: 9, cost_unmetered: 0
  claude: input: 84, output: 51319, cache_read: 2926919, cache_creation: 451569, cost_usd: 7.786, dispatches: 5, cost_unmetered: 0

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
