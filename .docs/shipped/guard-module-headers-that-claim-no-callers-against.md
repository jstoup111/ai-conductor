---
slug: guard-module-headers-that-claim-no-callers-against
spec_hash: 1a201889e8530f6116819c7270d8b861f74f3c6a370267dcf016b697621132c4
pr: https://github.com/jstoup111/ai-conductor/pull/2563
shipped: 2026-09-15
engine_version: 20260914T211543Z-5da62d0036d1
---

## Cost
input: 618689
output: 77737
cache_read: 7986815
cache_creation: 348427
cost_usd: 8.9618
dispatches: 14
retries: 2
halts: 0
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 618639, output: 52514, cache_read: 6818688, cache_creation: 0, cost_usd: 4.2626, dispatches: 9, cost_unmetered: 0
  claude: input: 50, output: 25223, cache_read: 1168127, cache_creation: 348427, cost_usd: 4.6992, dispatches: 5, cost_unmetered: 0

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
