---
slug: coherence-check-l-tier-model-escalation-is-documen
spec_hash: 884b748754a95c524d63deed3f32b8241c4710e525c1da7e1a77329a1e34c94e
pr: https://github.com/jstoup111/ai-conductor/pull/3000
shipped: 2026-10-06
engine_version: 20261005T132531Z-90abdd8af144
---

## Cost
input: 479408
output: 43076
cache_read: 8215251
cache_creation: 147634
cost_usd: 6.0756
dispatches: 11
retries: 0
halts: 1
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 479358, output: 31776, cache_read: 7477120, cache_creation: 0, cost_usd: 4.5802, dispatches: 6, cost_unmetered: 0
  claude: input: 50, output: 11300, cache_read: 738131, cache_creation: 147634, cost_usd: 1.4953, dispatches: 5, cost_unmetered: 0

## Time
state: measured
active_ms: 2392089
provider_active_ms: 1331774
no_provider_active_ms: 1060315

## Build Review
laps_to_pass: 1
skipped: 1
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 1
  security: failures: 0, judged: 1
skip_reasons:
  test_quality_empty_scope: 1
