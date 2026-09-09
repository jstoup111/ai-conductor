---
slug: qualify-the-reported-cost-figure-when-it-covers-on
spec_hash: 05f0f12fcafe8103e218961429accf132633f5de8d07b19d188ebb0657b015e7
pr: https://github.com/jstoup111/ai-conductor/pull/2463
shipped: 2026-09-08
engine_version: 20260907T120758Z-4f8bdec36946
---

## Cost
input: 780122
output: 61806
cache_read: 12948281
cache_creation: 161287
cost_usd: 8.121
dispatches: 15
retries: 2
halts: 0
unmetered: count: 5, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 780096, output: 49532, cache_read: 12193664, cache_creation: 0, cost_usd: 5.4288, dispatches: 8, cost_unmetered: 0
  claude: input: 26, output: 12274, cache_read: 754617, cache_creation: 161287, cost_usd: 2.6922, dispatches: 2, cost_unmetered: 0

## Time
state: measured
active_ms: 4241786
provider_active_ms: 3154818
no_provider_active_ms: 1086968

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  testQuality: failures: 0, judged: 1
skip_reasons:
