---
slug: authenticate-otlp-export-with-env-referenced-heade
spec_hash: d9450ac4e71345e0f0543ee4de3da09ab5444a6b15d33dc82654df9c90faa31d
pr: https://github.com/jstoup111/ai-conductor/pull/2369
shipped: 2026-09-07
engine_version: 20260907T025756Z-de24783f71d8
---

## Cost
input: 1024807
output: 122194
cache_read: 20173567
cache_creation: 538092
cost_usd: 18.6875
dispatches: 27
retries: 1
halts: 1
unmetered: count: 11, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 1024687, output: 72812, cache_read: 16125696, cache_creation: 0, cost_usd: 8.7383, dispatches: 10, cost_unmetered: 0
  claude: input: 120, output: 49382, cache_read: 4047871, cache_creation: 538092, cost_usd: 9.9492, dispatches: 6, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:finish

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  testQuality: failures: 1, judged: 2
skip_reasons:
