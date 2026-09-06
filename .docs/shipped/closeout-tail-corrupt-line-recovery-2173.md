---
slug: closeout-tail-corrupt-line-recovery-2173
spec_hash: baa9e4ef2b5d1a6ea4c962617b7b5092f214a4b429523f91ff3e7d44c9232fc0
pr: https://github.com/jstoup111/ai-conductor/pull/2241
shipped: 2026-09-06
engine_version: 20260906T032235Z-0c471cd2a03d
---

## Cost
input: 761280
output: 96678
cache_read: 14416620
cache_creation: 408575
cost_usd: 13.0462
dispatches: 22
retries: 1
halts: 0
unmetered: count: 9, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 761190, output: 60295, cache_read: 11831680, cache_creation: 0, cost_usd: 6.7579, dispatches: 8, cost_unmetered: 0
  claude: input: 90, output: 36383, cache_read: 2584940, cache_creation: 408575, cost_usd: 6.2882, dispatches: 5, cost_unmetered: 0

## Time
state: measured
active_ms: 2389503
provider_active_ms: 1700485
no_provider_active_ms: 689018

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  testQuality: failures: 0, judged: 2
skip_reasons:
