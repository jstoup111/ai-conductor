---
slug: halt-records-committed-on-stacked-child-branches-m
spec_hash: 7fa02d9d283529b6213b894948a0fa664fc6146d5a2093525bfd2d2657dc7a2e
pr: https://github.com/jstoup111/ai-conductor/pull/3553
shipped: 2026-10-31
engine_version: 20261031T092626Z-5ecd86e21e59
---

## Cost
input: 2193157
output: 188580
cache_read: 34955817
cache_creation: 1062895
cost_usd: 26.5112
dispatches: 42
retries: 1
halts: 0
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 7
providers:
  codex: input: 2193039, output: 115067, cache_read: 32125952, cache_creation: 0, cost_usd: 15.9713, dispatches: 27, cost_unmetered: 7
  claude: input: 118, output: 73513, cache_read: 2829865, cache_creation: 1062895, cost_usd: 10.5399, dispatches: 15, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","1bd17f41-da30-4514-b5e2-33b900e63380","lifecycle-step","finish"]

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 4
  implementationQuality: failures: 1, judged: 4
  security: failures: 0, judged: 4
  testQuality: failures: 0, judged: 4
skip_reasons:
