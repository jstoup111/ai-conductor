---
slug: run-memory-store-setup-on-daemon-dispatch
spec_hash: 0cd809b8ccc2dd26aea8f1844e4f560e080cb2470207190499214a361e473ec3
pr: https://github.com/jstoup111/ai-conductor/pull/2397
shipped: 2026-09-09
engine_version: 20260909T124054Z-7dc49b2ad3d5
---

## Cost
input: 974492
output: 140846
cache_read: 22093010
cache_creation: 503688
cost_usd: 18.4635
dispatches: 14
retries: 0
halts: 2
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 974396, output: 87273, cache_read: 18918272, cache_creation: 0, cost_usd: 9.9008, dispatches: 9, cost_unmetered: 0
  claude: input: 96, output: 53573, cache_read: 3174738, cache_creation: 503688, cost_usd: 8.5626, dispatches: 5, cost_unmetered: 0

## Time
state: partial
reason: open-executions:parallel:prd_audit

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  testQuality: failures: 0, judged: 2
skip_reasons:
