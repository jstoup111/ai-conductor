---
slug: feature-cost-and-shipment-metrics-cannot-be-groupe
spec_hash: 49796fa1d500d73eb1d417caa3cef0fd3fb79973513b4985d37856ead10a14a0
pr: https://github.com/jstoup111/ai-conductor/pull/2567
shipped: 2026-09-17
engine_version: 20260917T120938Z-cb86a041782a
---

## Cost
input: 2189011
output: 321010
cache_read: 53592442
cache_creation: 1905473
cost_usd: 59.8004
dispatches: 36
retries: 3
halts: 3
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 2188801, output: 177379, cache_read: 42377600, cache_creation: 0, cost_usd: 21.5746, dispatches: 20, cost_unmetered: 0
  claude: input: 210, output: 143631, cache_read: 11214842, cache_creation: 1905473, cost_usd: 38.2257, dispatches: 16, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:build

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 1
rubrics:
  testQuality: failures: 0, judged: 5
skip_reasons:
