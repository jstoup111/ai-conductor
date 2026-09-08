---
slug: testquality-admits-724-test-titles-for-eight-chang
spec_hash: 2ed096ddd5de7e30fe5fac4e1607960a72c89a846b0d018d297501c3fa3ea8c1
pr: https://github.com/jstoup111/ai-conductor/pull/2324
shipped: 2026-09-08
engine_version: 20260907T120758Z-4f8bdec36946
---

## Cost
input: 7736678
output: 1518991
cache_read: 368033613
cache_creation: 6960212
cost_usd: 334.2888
dispatches: 134
retries: 12
halts: 19
unmetered: count: 38, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 7734292, output: 641688, cache_read: 207493120, cache_creation: 0, cost_usd: 87.7464, dispatches: 48, cost_unmetered: 0
  claude: input: 2386, output: 877303, cache_read: 160540493, cache_creation: 6960212, cost_usd: 246.5424, dispatches: 57, cost_unmetered: 0

## Time
state: partial
reason: open-executions:parallel:prd_audit,step:build_review,step:finish

## Build Review
laps_to_pass: 3
skipped: 0
cache_hits: 1
infrastructure_failures: 3
rubrics:
  testQuality: failures: 6, judged: 14
skip_reasons:
