---
slug: render-kickback-and-build-re-entry-counts-in-condu
spec_hash: da97c75035c070e6e7ca6fa7bf442c3af5301a69055b4f6eca37b2e019cfdd57
pr: https://github.com/jstoup111/ai-conductor/pull/2451
shipped: 2026-09-08
engine_version: 20260907T120758Z-4f8bdec36946
---

## Cost
input: 1082348
output: 113420
cache_read: 16281953
cache_creation: 578489
cost_usd: 16.2863
dispatches: 27
retries: 3
halts: 0
unmetered: count: 8, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 1082258, output: 71313, cache_read: 13484928, cache_creation: 0, cost_usd: 7.0225, dispatches: 12, cost_unmetered: 0
  claude: input: 90, output: 42107, cache_read: 2797025, cache_creation: 578489, cost_usd: 9.2638, dispatches: 7, cost_unmetered: 0

## Time
state: partial
reason: provider-outside-active-union

## Build Review
laps_to_pass: 2
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  testQuality: failures: 1, judged: 3
skip_reasons:
