---
slug: prd-audit-halts-on-a-stale-report-when-the-audit-d
spec_hash: 21aeb02af18c2ca3459d7e659afacad481ad955248e929da6db9f960b82da444
pr: https://github.com/jstoup111/ai-conductor/pull/1891
shipped: 2026-08-26
engine_version: 20260826T032530Z-e77b20b881a4
---

## Cost
input: 1784238
output: 217520
cache_read: 55499525
cache_creation: 1165540
cost_usd: 41.7593
dispatches: 25
retries: 3
halts: 3
unmetered: count: 7, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 1783924, output: 119307, cache_read: 31942400, cache_creation: 0, cost_usd: 15.8684, dispatches: 13, cost_unmetered: 0
  claude: input: 314, output: 98213, cache_read: 23557125, cache_creation: 1165540, cost_usd: 25.8909, dispatches: 5, cost_unmetered: 0

## Time
state: partial
reason: open-executions:parallel:wiring_check,step:build,step:finish

## Build Review
laps_to_pass: 3
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  testQuality: failures: 2, judged: 3
skip_reasons:
