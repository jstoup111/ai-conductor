---
slug: prd-audit-routes-a-coherence-waived-fr-as-an-appen
spec_hash: b9607ba3f07f50f24efbf448a85e274f18db7041667a5528a53a744ba30887d5
pr: https://github.com/jstoup111/ai-conductor/pull/3084
shipped: 2026-10-10
engine_version: 20261010T132818Z-14d7967cd432
---

## Cost
input: 445682
output: 41139
cache_read: 8939657
cache_creation: 155456
cost_usd: 5.87
dispatches: 13
retries: 0
halts: 2
unmetered: count: 1, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 445618, output: 26372, cache_read: 7712256, cache_creation: 0, cost_usd: 4.0853, dispatches: 9, cost_unmetered: 0
  claude: input: 64, output: 14767, cache_read: 1227401, cache_creation: 155456, cost_usd: 1.7847, dispatches: 4, cost_unmetered: 0

## Time
state: partial
active_ms: 3912011
reason: provider-evidence-incomplete

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 1
rubrics:
  eventSpine: failures: 0, judged: 1
  security: failures: 0, judged: 1
  testQuality: failures: 0, judged: 1
skip_reasons:
