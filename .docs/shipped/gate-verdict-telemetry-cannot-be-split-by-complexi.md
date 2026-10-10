---
slug: gate-verdict-telemetry-cannot-be-split-by-complexi
spec_hash: e56239264d322054759a75a1a8aebe37f585a57387d689cc4ceea73e1fdef060
pr: https://github.com/jstoup111/ai-conductor/pull/3089
shipped: 2026-10-10
engine_version: 20261010T142412Z-f61646aaea57
---

## Cost
input: 463383
output: 43557
cache_read: 7334486
cache_creation: 234086
cost_usd: 7.6218
dispatches: 14
retries: 0
halts: 1
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 463303, output: 21886, cache_read: 5493632, cache_creation: 0, cost_usd: 4.9472, dispatches: 9, cost_unmetered: 0
  claude: input: 80, output: 21671, cache_read: 1840854, cache_creation: 234086, cost_usd: 2.6746, dispatches: 5, cost_unmetered: 0

## Time
state: measured
active_ms: 2768172
provider_active_ms: 1136908
no_provider_active_ms: 1631264

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 1
  security: failures: 0, judged: 1
  testQuality: failures: 0, judged: 1
skip_reasons:
