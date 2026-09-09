---
slug: stamp-released-harness-version-on-otel-trace-resou
spec_hash: 2018b3329a3e0e73db8eca64ac9c4592cab49590f2a061672ee55436df1cd527
pr: https://github.com/jstoup111/ai-conductor/pull/2399
shipped: 2026-09-09
engine_version: 20260909T173417Z-98f540f3bc46
---

## Cost
input: 733283
output: 129714
cache_read: 18591739
cache_creation: 755016
cost_usd: 18.9541
dispatches: 19
retries: 3
halts: 2
unmetered: count: 2, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 733147, output: 63191, cache_read: 13673600, cache_creation: 0, cost_usd: 6.7437, dispatches: 11, cost_unmetered: 0
  claude: input: 136, output: 66523, cache_read: 4918139, cache_creation: 755016, cost_usd: 12.2104, dispatches: 8, cost_unmetered: 0

## Time
state: partial
reason: open-executions:parallel:prd_audit,step:finish

## Build Review
laps_to_pass: 2
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  testQuality: failures: 1, judged: 3
skip_reasons:
