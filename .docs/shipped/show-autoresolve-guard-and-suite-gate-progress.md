---
slug: show-autoresolve-guard-and-suite-gate-progress
spec_hash: 6a67357fa41c013063f94793b677f69b2b08d951229bfee0e2686ba10d9be924
pr: https://github.com/jstoup111/ai-conductor/pull/2862
shipped: 2026-09-30
engine_version: 20260929T235835Z-35e0e6501562
---

## Cost
input: 669840
output: 48002
cache_read: 8927233
cache_creation: 129312
cost_usd: 5.9456
dispatches: 15
retries: 2
halts: 1
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 669808, output: 40244, cache_read: 8268416, cache_creation: 0, cost_usd: 4.6662, dispatches: 11, cost_unmetered: 0
  claude: input: 32, output: 7758, cache_read: 658817, cache_creation: 129312, cost_usd: 1.2794, dispatches: 4, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","21b28090-8799-4ae6-9011-f3c6ab8dbc73","lifecycle-step","finish"]

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 1
  security: failures: 0, judged: 1
  testQuality: failures: 0, judged: 1
skip_reasons:
