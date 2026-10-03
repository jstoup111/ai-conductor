---
slug: harness-skills-and-context-files-reach-pi-sessions
spec_hash: 5bdf537814c8684c096e4fccc9fa39970491ec6e10d56c2163cb6f711acef94b
pr: https://github.com/jstoup111/ai-conductor/pull/2863
shipped: 2026-10-03
engine_version: 20261003T073458Z-05ea0de5cafb
---

## Cost
input: 4023036
output: 377381
cache_read: 65506915
cache_creation: 1179765
cost_usd: 51.1794
dispatches: 56
retries: 5
halts: 4
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 4022592, output: 225243, cache_read: 51245440, cache_creation: 0, cost_usd: 34.1348, dispatches: 33, cost_unmetered: 0
  claude: input: 444, output: 152138, cache_read: 14261475, cache_creation: 1179765, cost_usd: 17.0446, dispatches: 23, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","a3c847ca-46e4-4e4d-9671-4f3223a9f72c","lifecycle-step","finish"]

## Build Review
laps_to_pass: 1
skipped: 4
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 5
  security: failures: 0, judged: 5
  testQuality: failures: 0, judged: 1
skip_reasons:
  test_quality_empty_scope: 4
