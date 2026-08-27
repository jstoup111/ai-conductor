---
slug: daemon-dispatched-builds-emit-no-otel-telemetry-th
spec_hash: fc7c72885854a4bc30047a85e8dddb5fc32e6160518c07020e1d84037bc916e0
pr: https://github.com/jstoup111/ai-conductor/pull/1973
shipped: 2026-08-27
engine_version: 20260827T172153Z-9278310339a6
---

## Cost
input: 1604737
output: 199814
cache_read: 51693990
cache_creation: 991594
cost_usd: 35.3542
dispatches: 24
retries: 1
halts: 1
unmetered: count: 7, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 1604471, output: 102036, cache_read: 32699648, cache_creation: 0, cost_usd: 13.4953, dispatches: 11, cost_unmetered: 0
  claude: input: 266, output: 97778, cache_read: 18994342, cache_creation: 991594, cost_usd: 21.8589, dispatches: 6, cost_unmetered: 0

## Time
state: measured
active_ms: 10142472
provider_active_ms: 8821615
no_provider_active_ms: 1320857

## Build Review
laps_to_pass: 5
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  testQuality: failures: 4, judged: 5
skip_reasons:
