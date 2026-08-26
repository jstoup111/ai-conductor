---
slug: a-gate-halt-marks-a-completed-build-failed-and-the
spec_hash: b8a1d17e4599823310e71f690d3db4a87ece02db8bc49ee804437e283f2f8ea9
pr: https://github.com/jstoup111/ai-conductor/pull/1870
shipped: 2026-08-25
engine_version: 20260825T031141Z-c0e4d818f137
---

## Cost
input: 1408062
output: 121974
cache_read: 30492272
cache_creation: 363205
cost_usd: 16.8355
dispatches: 37
retries: 4
halts: 3
unmetered: count: 22, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 1407990, output: 95645, cache_read: 28171264, cache_creation: 0, cost_usd: 11.2944, dispatches: 18, cost_unmetered: 0
  claude: input: 72, output: 26329, cache_read: 2321008, cache_creation: 363205, cost_usd: 5.5411, dispatches: 13, cost_unmetered: 0

## Time
state: partial
reason: open-executions:parallel:prd_audit,parallel:wiring_check

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  testQuality: failures: 0, judged: 2
skip_reasons:
