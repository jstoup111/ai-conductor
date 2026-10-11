---
slug: kickback-ledger-json-reports-count-0-for-a-gate-wh
spec_hash: 5715d7fd324f1a27e67b1d244ed7269c3501e92e04977c85912e077a68716462
pr: https://github.com/jstoup111/ai-conductor/pull/3148
shipped: 2026-10-11
engine_version: 20261011T003623Z-5f233d35b433
---

## Cost
input: 489371
output: 43352
cache_read: 9530211
cache_creation: 178693
cost_usd: 6.1538
dispatches: 12
retries: 2
halts: 1
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 489323, output: 32275, cache_read: 8585600, cache_creation: 0, cost_usd: 4.3136, dispatches: 8, cost_unmetered: 0
  claude: input: 48, output: 11077, cache_read: 944611, cache_creation: 178693, cost_usd: 1.8402, dispatches: 4, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","704741df-9b17-4298-bd93-4d2ac2a7ae86","lifecycle-step","finish"]

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 1
  security: failures: 0, judged: 1
  testQuality: failures: 0, judged: 1
skip_reasons:
