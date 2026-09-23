---
slug: claude-weekly-limit-message-bypasses-rate-limit-re
spec_hash: f37e5d5d43417c6316e385020bcf860103de9463a2cb205caaf767512413050a
pr: https://github.com/jstoup111/ai-conductor/pull/2663
shipped: 2026-09-23
engine_version: 20260922T220754Z-95f2b12d2932
---

## Cost
input: 675043
output: 82937
cache_read: 12574590
cache_creation: 218773
cost_usd: 8.7607
dispatches: 15
retries: 0
halts: 1
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 674987, output: 62202, cache_read: 11289088, cache_creation: 0, cost_usd: 6.3385, dispatches: 10, cost_unmetered: 0
  claude: input: 56, output: 20735, cache_read: 1285502, cache_creation: 218773, cost_usd: 2.4222, dispatches: 5, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","825ed875-139f-4789-acc4-0c8ea9d7a45f","lifecycle-step","finish"]

## Build Review
laps_to_pass: 1
skipped: 2
cache_hits: 0
infrastructure_failures: 0
rubrics:
  security: failures: 0, judged: 2
skip_reasons:
  test_quality_empty_scope: 2
