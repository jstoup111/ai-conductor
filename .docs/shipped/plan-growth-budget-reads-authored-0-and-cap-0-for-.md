---
slug: plan-growth-budget-reads-authored-0-and-cap-0-for-
spec_hash: 08d33372b272c0d585b31097224c45c7ea269b645da8da9d17bfc1786bb04d4b
pr: https://github.com/jstoup111/ai-conductor/pull/3143
shipped: 2026-10-11
engine_version: 20261011T003623Z-5f233d35b433
---

## Cost
input: 862509
output: 69700
cache_read: 14657486
cache_creation: 244937
cost_usd: 9.0684
dispatches: 15
retries: 3
halts: 1
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 862445, output: 54323, cache_read: 12906368, cache_creation: 0, cost_usd: 6.4509, dispatches: 11, cost_unmetered: 0
  claude: input: 64, output: 15377, cache_read: 1751118, cache_creation: 244937, cost_usd: 2.6175, dispatches: 4, cost_unmetered: 0

## Time
state: measured
active_ms: 5580970
provider_active_ms: 2657511
no_provider_active_ms: 2923459

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
