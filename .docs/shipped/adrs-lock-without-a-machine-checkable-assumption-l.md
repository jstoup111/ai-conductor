---
slug: adrs-lock-without-a-machine-checkable-assumption-l
spec_hash: 28d9e791c771f9833c1472823fe061828b5c3a1c0819e857e6d614c40b984149
pr: https://github.com/jstoup111/ai-conductor/pull/3136
shipped: 2026-10-11
engine_version: 20261011T003623Z-5f233d35b433
---

## Cost
input: 1896004
output: 207003
cache_read: 33231399
cache_creation: 1223484
cost_usd: 30.999
dispatches: 41
retries: 2
halts: 1
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 1895856, output: 117638, cache_read: 29013376, cache_creation: 0, cost_usd: 18.5797, dispatches: 23, cost_unmetered: 0
  claude: input: 148, output: 89365, cache_read: 4218023, cache_creation: 1223484, cost_usd: 12.4194, dispatches: 18, cost_unmetered: 0

## Time
state: partial
reason: provider-outside-active-union

## Build Review
laps_to_pass: 2
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 4
  security: failures: 0, judged: 4
  testQuality: failures: 1, judged: 4
skip_reasons:
