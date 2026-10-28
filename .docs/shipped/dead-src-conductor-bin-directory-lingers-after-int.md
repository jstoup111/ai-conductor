---
slug: dead-src-conductor-bin-directory-lingers-after-int
spec_hash: 98cbd588e599a465870720f6e1691015b10693323b6665a41e52fe0ad2e2321a
pr: https://github.com/jstoup111/ai-conductor/pull/3116
shipped: 2026-10-11
engine_version: 20261011T003623Z-5f233d35b433
---

## Cost
input: 792447
output: 52502
cache_read: 7951216
cache_creation: 112270
cost_usd: 6.2863
dispatches: 18
retries: 4
halts: 1
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 792413, output: 45458, cache_read: 7516928, cache_creation: 0, cost_usd: 5.1602, dispatches: 13, cost_unmetered: 0
  claude: input: 34, output: 7044, cache_read: 434288, cache_creation: 112270, cost_usd: 1.126, dispatches: 5, cost_unmetered: 0

## Time
state: measured
active_ms: 2730540
provider_active_ms: 1608655
no_provider_active_ms: 1121885

## Build Review
laps_to_pass: 1
skipped: 2
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 2
  security: failures: 0, judged: 2
skip_reasons:
  test_quality_empty_scope: 2
