---
slug: file-changing-rebase-rewinds-past-test-suite-and-r
spec_hash: f1120e1d3f67ec3c8b09ec1d24c9091b3f4bec3b175eb05e5401dbbc4401a129
pr: https://github.com/jstoup111/ai-conductor/pull/2555
shipped: 2026-09-21
engine_version: 20260921T014919Z-f9a937e4d19d
---

## Cost
input: 11609083
output: 2093477
cache_read: 332975911
cache_creation: 8899939
cost_usd: 402.8544
dispatches: 182
retries: 28
halts: 23
unmetered: count: 4, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 11607187, output: 1034914, cache_read: 247480832, cache_creation: 0, cost_usd: 114.7355, dispatches: 100, cost_unmetered: 0
  claude: input: 1896, output: 1058563, cache_read: 85495079, cache_creation: 8899939, cost_usd: 288.1189, dispatches: 82, cost_unmetered: 0

## Time
state: partial
reason: provider-outside-active-union

## Build Review
laps_to_pass: 1
skipped: 6
cache_hits: 0
infrastructure_failures: 0
rubrics:
  security: failures: 0, judged: 3
  testQuality: failures: 0, judged: 12
skip_reasons:
  disabled: 6
