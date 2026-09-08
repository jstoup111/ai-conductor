---
slug: reclaim-orphaned-full-suite-lock-recovery-claims
spec_hash: a7fe47d408dc191dc48554f5c740fd0625a467dd90d13e93d49231853dc4dd6d
pr: https://github.com/jstoup111/ai-conductor/pull/2444
shipped: 2026-09-08
engine_version: 20260907T120758Z-4f8bdec36946
---

## Cost
input: 1677315
output: 164976
cache_read: 30603938
cache_creation: 514977
cost_usd: 22.9111
dispatches: 27
retries: 2
halts: 2
unmetered: count: 7, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 1677207, output: 107379, cache_read: 26813568, cache_creation: 0, cost_usd: 12.2367, dispatches: 14, cost_unmetered: 0
  claude: input: 108, output: 57597, cache_read: 3790370, cache_creation: 514977, cost_usd: 10.6743, dispatches: 6, cost_unmetered: 0

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
