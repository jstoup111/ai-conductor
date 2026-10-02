---
slug: surface-evidence-path-overlap-as-suggested-depende
spec_hash: 19afefde95dc02280aaacd5e7b2bf5bc5f8c4fbf8d0ada2d23cbb9e2bd2401aa
pr: https://github.com/jstoup111/ai-conductor/pull/2872
shipped: 2026-10-02
engine_version: 20261002T011715Z-89506a82fed2
---

## Cost
input: 5273793
output: 718225
cache_read: 110999271
cache_creation: 2842289
cost_usd: 100.1031
dispatches: 352
retries: 7
halts: 11
unmetered: count: 262, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 5273023, output: 326656, cache_read: 85884160, cache_creation: 0, cost_usd: 49.1567, dispatches: 308, cost_unmetered: 0
  claude: input: 770, output: 391569, cache_read: 25115111, cache_creation: 2842289, cost_usd: 50.9465, dispatches: 44, cost_unmetered: 0

## Time
state: partial
reason: provider-outside-active-union

## Build Review
laps_to_pass: 2
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 5
  security: failures: 0, judged: 5
  testQuality: failures: 1, judged: 5
skip_reasons:
