---
slug: remediation-repairs-are-blind-to-the-plan-contract
spec_hash: ec471935d3b2543c8d09567aad67c5639207c03a4e96bdb87ed92f6bfc00b078
pr: https://github.com/jstoup111/ai-conductor/pull/1637
shipped: 2026-08-16
engine_version: 20260816T141732Z-93e58a198b6a
---

## Cost
input: 13542343
output: 102536
cache_read: 15454691
cache_creation: 554937
cost_usd: 8.2491
dispatches: 37
retries: 7
halts: 3
unmetered: count: 12, duration_ms: 0
cost_unmetered: count: 16
providers:
  codex: input: 13542241, output: 51528, cache_read: 12606720, cache_creation: 0, cost_usd: 0, dispatches: 16, cost_unmetered: 16
  claude: input: 102, output: 51008, cache_read: 2847971, cache_creation: 554937, cost_usd: 8.2491, dispatches: 13, cost_unmetered: 0

## Time
state: partial

## Build Review
laps_to_pass: 4
skipped: 0
cache_hits: 24
infrastructure_failures: 0
rubrics:
  completeness: failures: 3, judged: 10
  rootCause: failures: 9, judged: 10
  scope: failures: 0, judged: 10
  tautology: failures: 0, judged: 10
skip_reasons:
