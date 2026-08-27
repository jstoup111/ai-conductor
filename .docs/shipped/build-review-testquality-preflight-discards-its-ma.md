---
slug: build-review-testquality-preflight-discards-its-ma
spec_hash: 8a01df6cdea3e28f6d36269ce754989a28dd3a9f95eb51ec35a91e0849659a62
pr: https://github.com/jstoup111/ai-conductor/pull/1970
shipped: 2026-08-27
engine_version: 20260827T134019Z-eaa70631ea5e
---

## Cost
input: 581460
output: 51205
cache_read: 9946998
cache_creation: 61211
cost_usd: 6.3293
dispatches: 9
retries: 0
halts: 0
unmetered: count: 3, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 581400, output: 38046, cache_read: 8174848, cache_creation: 0, cost_usd: 4.5018, dispatches: 5, cost_unmetered: 0
  claude: input: 60, output: 13159, cache_read: 1772150, cache_creation: 61211, cost_usd: 1.8275, dispatches: 1, cost_unmetered: 0

## Time
state: measured
active_ms: 1314383
provider_active_ms: 1013573
no_provider_active_ms: 300810

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
skip_reasons:
