---
slug: decide-artifacts-are-too-repetitive-for-people-to-
spec_hash: 81b150090f6f33e1b25abea0c1a9bfad09067b63f60b76a829b1e0e8deb2226b
pr: https://github.com/jstoup111/ai-conductor/pull/3426
shipped: 2026-10-27
engine_version: 20261026T134330Z-de66138a044b
---

## Cost
input: 4722217
output: 494108
cache_read: 103198818
cache_creation: 2844025
cost_usd: 77.7767
dispatches: 96
retries: 4
halts: 6
unmetered: count: 8, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 4721865, output: 335646, cache_read: 92146560, cache_creation: 0, cost_usd: 49.6434, dispatches: 60, cost_unmetered: 0
  claude: input: 352, output: 158462, cache_read: 11052258, cache_creation: 2844025, cost_usd: 28.1333, dispatches: 36, cost_unmetered: 0

## Time
state: partial
reason: active-evidence-incomplete

## Build Review
laps_to_pass: 1
skipped: 20
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 13
  security: failures: 0, judged: 7
  testQuality: failures: 1, judged: 12
skip_reasons:
  disabled: 13
  leaf-only: 6
  test_quality_empty_scope: 1
