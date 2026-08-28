---
slug: trace-root-span-records-no-run-outcome-a-halted-ru
spec_hash: 6f841f9d1d31cc7b5ac0f14a8917b04f8a0bef865ba02e01881376d0bdc40c92
pr: https://github.com/jstoup111/ai-conductor/pull/1997
shipped: 2026-08-28
engine_version: 20260828T002007Z-9437d2c3c3be
---

## Cost
input: 612182
output: 58818
cache_read: 16422618
cache_creation: 212991
cost_usd: 9.1787
dispatches: 13
retries: 0
halts: 0
unmetered: count: 5, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 612130, output: 43592, cache_read: 14757376, cache_creation: 0, cost_usd: 5.8353, dispatches: 5, cost_unmetered: 0
  claude: input: 52, output: 15226, cache_read: 1665242, cache_creation: 212991, cost_usd: 3.3434, dispatches: 3, cost_unmetered: 0

## Time
state: measured
active_ms: 4689024
provider_active_ms: 4116718
no_provider_active_ms: 572306

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  testQuality: failures: 0, judged: 1
skip_reasons:
