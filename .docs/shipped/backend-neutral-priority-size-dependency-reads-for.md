---
slug: backend-neutral-priority-size-dependency-reads-for
spec_hash: e14956ecf22e693c8db4a71bda2cd7b28f4c761b3da908835c428c5741cbe1fa
pr: https://github.com/jstoup111/ai-conductor/pull/3172
shipped: 2026-10-11
engine_version: 20261011T003623Z-5f233d35b433
---

## Cost
input: 937123
output: 95668
cache_read: 19085799
cache_creation: 387516
cost_usd: 12.4322
dispatches: 18
retries: 1
halts: 0
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 937033, output: 64424, cache_read: 17325824, cache_creation: 0, cost_usd: 8.3548, dispatches: 11, cost_unmetered: 0
  claude: input: 90, output: 31244, cache_read: 1759975, cache_creation: 387516, cost_usd: 4.0774, dispatches: 7, cost_unmetered: 0

## Time
state: measured
active_ms: 5830595
provider_active_ms: 3629576
no_provider_active_ms: 2201019

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 2
  security: failures: 0, judged: 2
  testQuality: failures: 0, judged: 2
skip_reasons:
