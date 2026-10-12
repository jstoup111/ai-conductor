---
slug: a-rejected-case-transition-halts-as-corrupt-case-h
spec_hash: b13a4d18dd1e3ffc353b20b08f0b25c09ebc28cab77400505da4a1047ae16ef8
pr: https://github.com/jstoup111/ai-conductor/pull/3171
shipped: 2026-10-11
engine_version: 20261011T125659Z-cc1b0a49f473
---

## Cost
input: 1494115
output: 138306
cache_read: 23616453
cache_creation: 1303214
cost_usd: 30.6461
dispatches: 45
retries: 1
halts: 5
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 1493951, output: 66837, cache_read: 19537152, cache_creation: 0, cost_usd: 17.9745, dispatches: 21, cost_unmetered: 0
  claude: input: 164, output: 71469, cache_read: 4079301, cache_creation: 1303214, cost_usd: 12.6716, dispatches: 24, cost_unmetered: 0

## Time
state: measured
active_ms: 6948254
provider_active_ms: 3619470
no_provider_active_ms: 3328784

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
