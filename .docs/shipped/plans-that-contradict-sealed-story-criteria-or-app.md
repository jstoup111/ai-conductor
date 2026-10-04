---
slug: plans-that-contradict-sealed-story-criteria-or-app
spec_hash: 15d79bf5da99b6e9fe4e08b4280893592f550e86604ae1a3295d06fb1656ed24
pr: https://github.com/jstoup111/ai-conductor/pull/2968
shipped: 2026-10-04
engine_version: 20261004T174827Z-4925f7bb7cbf
---

## Cost
input: 3180809
output: 370648
cache_read: 59546949
cache_creation: 1257712
cost_usd: 43.764
dispatches: 61
retries: 4
halts: 5
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 3180395, output: 198047, cache_read: 48441088, cache_creation: 0, cost_usd: 25.4428, dispatches: 37, cost_unmetered: 0
  claude: input: 414, output: 172601, cache_read: 11105861, cache_creation: 1257712, cost_usd: 18.3212, dispatches: 24, cost_unmetered: 0

## Time
state: measured
active_ms: 15158015
provider_active_ms: 10215042
no_provider_active_ms: 4942973

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 4
  security: failures: 0, judged: 4
  testQuality: failures: 0, judged: 4
skip_reasons:
