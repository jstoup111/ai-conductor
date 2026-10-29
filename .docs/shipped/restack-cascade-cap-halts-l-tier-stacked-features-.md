---
slug: restack-cascade-cap-halts-l-tier-stacked-features-
spec_hash: 074fa6bda928cc5ea34f354fe21a6e50b934d0b698342a5cd3bacf66f8055ab5
pr: https://github.com/jstoup111/ai-conductor/pull/3523
shipped: 2026-10-29
engine_version: 20261029T113550Z-f30879854aa9
---

## Cost
input: 1354532
output: 123600
cache_read: 28463999
cache_creation: 446133
cost_usd: 16.6245
dispatches: 22
retries: 3
halts: 1
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 1
providers:
  codex: input: 1354452, output: 92541, cache_read: 26464640, cache_creation: 0, cost_usd: 12.0341, dispatches: 14, cost_unmetered: 1
  claude: input: 80, output: 31059, cache_read: 1999359, cache_creation: 446133, cost_usd: 4.5904, dispatches: 8, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","833089c6-ea76-43ff-aca1-04746eadee07","lifecycle-step","finish"]

## Build Review
laps_to_pass: 3
skipped: 3
cache_hits: 2
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 2
  implementationQuality: failures: 2, judged: 2
  security: failures: 0, judged: 2
  testQuality: failures: 0, judged: 3
skip_reasons:
  scope-empty: 3
