---
slug: docs-guard-canonical-path-protection-2163
spec_hash: 8744277a366ba27fba41076d86f820e815727f6911a076b4ebf0cff90003d4fc
pr: https://github.com/jstoup111/ai-conductor/pull/2242
shipped: 2026-09-06
engine_version: 20260906T032235Z-0c471cd2a03d
---

## Cost
input: 729318
output: 113855
cache_read: 16307029
cache_creation: 466887
cost_usd: 14.9515
dispatches: 17
retries: 0
halts: 2
unmetered: count: 5, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 729164, output: 56120, cache_read: 10856704, cache_creation: 0, cost_usd: 6.1134, dispatches: 7, cost_unmetered: 0
  claude: input: 154, output: 57735, cache_read: 5450325, cache_creation: 466887, cost_usd: 8.8382, dispatches: 5, cost_unmetered: 0

## Time
state: partial
reason: open-executions:parallel:prd_audit,step:finish

## Build Review
laps_to_pass: 2
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  testQuality: failures: 1, judged: 2
skip_reasons:
