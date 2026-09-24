---
slug: skip-prd-audit-as-built-re-dispatch-after-a-kickba
spec_hash: 8c0ea5290e6d581450a64dd2ea10f042c79352bf2a9e36951c8d2f9eb591453d
pr: https://github.com/jstoup111/ai-conductor/pull/2708
shipped: 2026-09-24
engine_version: 20260924T091032Z-b2f8c0a660c9
---

## Cost
input: 1377717
output: 149629
cache_read: 29020065
cache_creation: 614090
cost_usd: 17.8686
dispatches: 32
retries: 4
halts: 3
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 1377589, output: 111865, cache_read: 25547520, cache_creation: 0, cost_usd: 11.5056, dispatches: 20, cost_unmetered: 0
  claude: input: 128, output: 37764, cache_read: 3472545, cache_creation: 614090, cost_usd: 6.363, dispatches: 12, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","2b42a955-d2b0-4de5-a256-06d39e8743c9","lifecycle-step","finish"],step:execution\u0000["timing-rollup","persisted-ledger","32150ff0-d1dd-468d-8809-91dd160368c2","lifecycle-step","prd_audit"],step:execution\u0000["timing-rollup","persisted-ledger","3baf75ff-48e6-4563-9970-59c506072294","lifecycle-step","architecture_review_as_built"]

## Build Review
laps_to_pass: 2
skipped: 0
cache_hits: 2
infrastructure_failures: 5
rubrics:
  security: failures: 0, judged: 2
  testQuality: failures: 0, judged: 3
skip_reasons:
