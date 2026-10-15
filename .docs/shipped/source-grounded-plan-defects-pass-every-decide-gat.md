---
slug: source-grounded-plan-defects-pass-every-decide-gat
spec_hash: 2b5abfd7cc8c0139b5baec78b52961ab1d1f2ab4b9be7e75d5b59f8fe117ffdd
pr: https://github.com/jstoup111/ai-conductor/pull/3207
shipped: 2026-10-15
engine_version: 20261014T234454Z-805e0d2c452c
---

## Cost
input: 5685809
output: 633844
cache_read: 134954615
cache_creation: 4371056
cost_usd: 96.3066
dispatches: 81
retries: 18
halts: 11
unmetered: count: 1, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 5685417, output: 390673, cache_read: 107808000, cache_creation: 0, cost_usd: 51.0438, dispatches: 52, cost_unmetered: 0
  claude: input: 392, output: 243171, cache_read: 27146615, cache_creation: 4371056, cost_usd: 45.2628, dispatches: 29, cost_unmetered: 0

## Time
state: partial
reason: provider-outside-active-union

## Build Review
laps_to_pass: 3
skipped: 6
cache_hits: 0
infrastructure_failures: 1
rubrics:
  eventSpine: failures: 0, judged: 6
  security: failures: 0, judged: 6
  testQuality: failures: 2, judged: 6
skip_reasons:
  disabled: 6
