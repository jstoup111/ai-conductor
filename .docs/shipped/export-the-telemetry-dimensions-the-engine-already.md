---
slug: export-the-telemetry-dimensions-the-engine-already
spec_hash: b237ad7211c443897f3812274a87375f77db7fe289d53d7bcab579271c19c923
pr: https://github.com/jstoup111/ai-conductor/pull/2486
shipped: 2026-09-10
engine_version: 20260910T154008Z-613ad9ba89a7
---

## Cost
input: 2808153
output: 471758
cache_read: 101380383
cache_creation: 2594146
cost_usd: 89.9392
dispatches: 37
retries: 8
halts: 8
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 2807695, output: 241241, cache_read: 70667136, cache_creation: 0, cost_usd: 30.1471, dispatches: 22, cost_unmetered: 0
  claude: input: 458, output: 230517, cache_read: 30713247, cache_creation: 2594146, cost_usd: 59.7922, dispatches: 15, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:finish

## Build Review
laps_to_pass: 2
skipped: 0
cache_hits: 4
infrastructure_failures: 0
rubrics:
  testQuality: failures: 3, judged: 10
skip_reasons:
