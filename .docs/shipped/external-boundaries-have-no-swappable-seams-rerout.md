---
slug: external-boundaries-have-no-swappable-seams-rerout
spec_hash: 956e39cea21c206c7083956967fd6f1f67d7a540fee1e67715e1d7686e690498
pr: https://github.com/jstoup111/ai-conductor/pull/3660
shipped: 2026-11-08
engine_version: 20261108T000318Z-7a2ff38b78c5
---

## Cost
input: 733976
output: 58126
cache_read: 13906526
cache_creation: 342908
cost_usd: 8.7811
dispatches: 21
retries: 0
halts: 0
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 733904, output: 37552, cache_read: 12451328, cache_creation: 0, cost_usd: 5.3351, dispatches: 12, cost_unmetered: 0
  claude: input: 72, output: 20574, cache_read: 1455198, cache_creation: 342908, cost_usd: 3.4461, dispatches: 9, cost_unmetered: 0

## Time
state: partial
reason: provider-outside-active-union

## Build Review
laps_to_pass: 2
skipped: 0
cache_hits: 0
infrastructure_failures: 1
rubrics:
  eventSpine: failures: 0, judged: 2
  implementationQuality: failures: 1, judged: 2
  security: failures: 0, judged: 2
  testQuality: failures: 0, judged: 1
skip_reasons:
