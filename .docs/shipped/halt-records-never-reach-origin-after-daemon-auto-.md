---
slug: halt-records-never-reach-origin-after-daemon-auto-
spec_hash: 31f0019bf1e2feb6cc4ea1128c916844f852065e51d4dfcf51810bad0d5b4849
pr: https://github.com/jstoup111/ai-conductor/pull/3079
shipped: 2026-10-10
engine_version: 20261010T011143Z-f79d1fd8d7cd
---

## Cost
input: 397757
output: 36000
cache_read: 6402870
cache_creation: 150069
cost_usd: 4.8786
dispatches: 10
retries: 0
halts: 0
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 397711, output: 26779, cache_read: 5709952, cache_creation: 0, cost_usd: 3.3548, dispatches: 6, cost_unmetered: 0
  claude: input: 46, output: 9221, cache_read: 692918, cache_creation: 150069, cost_usd: 1.5237, dispatches: 4, cost_unmetered: 0

## Time
state: measured
active_ms: 3183796
provider_active_ms: 1448097
no_provider_active_ms: 1735699

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
