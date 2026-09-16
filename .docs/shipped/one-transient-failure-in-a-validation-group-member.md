---
slug: one-transient-failure-in-a-validation-group-member
spec_hash: 084c124c656402929bbd4840d96592af20d530371ef4a67f354897ad6cd47d9a
pr: https://github.com/jstoup111/ai-conductor/pull/2466
shipped: 2026-09-14
engine_version: 20260914T211543Z-5da62d0036d1
---

## Cost
input: 5680782
output: 863790
cache_read: 154616329
cache_creation: 4482933
cost_usd: 130.6029
dispatches: 87
retries: 14
halts: 15
unmetered: count: 2, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 5680084, output: 496739, cache_read: 121187200, cache_creation: 0, cost_usd: 55.9197, dispatches: 49, cost_unmetered: 0
  claude: input: 698, output: 367051, cache_read: 33429129, cache_creation: 4482933, cost_usd: 74.6832, dispatches: 38, cost_unmetered: 0

## Time
state: partial
reason: open-executions:parallel:prd_audit

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 1
rubrics:
  testQuality: failures: 1, judged: 12
skip_reasons:
