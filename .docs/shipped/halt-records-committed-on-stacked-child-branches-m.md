---
slug: halt-records-committed-on-stacked-child-branches-m
spec_hash: 7fa02d9d283529b6213b894948a0fa664fc6146d5a2093525bfd2d2657dc7a2e
pr: https://github.com/jstoup111/ai-conductor/pull/3553
shipped: 2026-10-31
engine_version: 20261031T092626Z-5ecd86e21e59
---

## Cost
input: 2203846
output: 188685
cache_read: 34990121
cache_creation: 1062895
cost_usd: 26.5112
dispatches: 43
retries: 1
halts: 0
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 8
providers:
  codex: input: 2203728, output: 115172, cache_read: 32160256, cache_creation: 0, cost_usd: 15.9713, dispatches: 28, cost_unmetered: 8
  claude: input: 118, output: 73513, cache_read: 2829865, cache_creation: 1062895, cost_usd: 10.5399, dispatches: 15, cost_unmetered: 0

## Time
state: partial
reason: provider-outside-active-union

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 4
  implementationQuality: failures: 1, judged: 4
  security: failures: 0, judged: 4
  testQuality: failures: 0, judged: 4
skip_reasons:
