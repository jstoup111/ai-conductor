---
slug: mechanically-enforce-otel-handler-coverage-for-ote
spec_hash: 19c2ecb679cfc95d34ab0e600715322e2e9dd5d3a2724f1654539b8326e9d5e7
pr: https://github.com/jstoup111/ai-conductor/pull/2395
shipped: 2026-09-10
engine_version: 20260909T231115Z-a985c68b5d37
---

## Cost
input: 3008053
output: 627598
cache_read: 72645158
cache_creation: 2466411
cost_usd: 84.3224
dispatches: 56
retries: 5
halts: 11
unmetered: count: 1, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 3007471, output: 291325, cache_read: 50737664, cache_creation: 0, cost_usd: 30.3487, dispatches: 30, cost_unmetered: 0
  claude: input: 582, output: 336273, cache_read: 21907494, cache_creation: 2466411, cost_usd: 53.9737, dispatches: 26, cost_unmetered: 0

## Time
state: partial
reason: open-executions:parallel:prd_audit,step:finish

## Build Review
laps_to_pass: 2
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  testQuality: failures: 2, judged: 9
skip_reasons:
