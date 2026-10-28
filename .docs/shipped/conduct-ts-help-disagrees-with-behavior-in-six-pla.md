---
slug: conduct-ts-help-disagrees-with-behavior-in-six-pla
spec_hash: 8e800c3d8f91e908bf13601d5d98a23340953a55aca85f2a6fb07d10de041116
pr: https://github.com/jstoup111/ai-conductor/pull/3241
shipped: 2026-10-15
engine_version: 20261015T004522Z-65702d1bcf72
---

## Cost
input: 1234772
output: 145625
cache_read: 22872872
cache_creation: 758326
cost_usd: 20.0166
dispatches: 27
retries: 2
halts: 0
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 1234632, output: 78346, cache_read: 18909184, cache_creation: 0, cost_usd: 11.8111, dispatches: 15, cost_unmetered: 0
  claude: input: 140, output: 67279, cache_read: 3963688, cache_creation: 758326, cost_usd: 8.2055, dispatches: 12, cost_unmetered: 0

## Time
state: measured
active_ms: 7943272
provider_active_ms: 6158931
no_provider_active_ms: 1784341

## Build Review
laps_to_pass: 1
skipped: 3
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 3
  security: failures: 0, judged: 3
  testQuality: failures: 0, judged: 3
skip_reasons:
  disabled: 3
