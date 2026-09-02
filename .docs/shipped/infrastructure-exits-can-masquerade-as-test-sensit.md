---
slug: infrastructure-exits-can-masquerade-as-test-sensit
spec_hash: 213fef499ec57d7660c2ff54136736808392f705389f7a2a277994f0a2cd92b7
pr: https://github.com/jstoup111/ai-conductor/pull/2109
shipped: 2026-09-02
engine_version: 20260902T120429Z-3e9cd3b0b48f
---

## Cost
input: 1145365
output: 180969
cache_read: 32799310
cache_creation: 443615
cost_usd: 25.0238
dispatches: 19
retries: 0
halts: 2
unmetered: count: 5, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 1144993, output: 92385, cache_read: 19301632, cache_creation: 0, cost_usd: 11.6224, dispatches: 9, cost_unmetered: 0
  claude: input: 372, output: 88584, cache_read: 13497678, cache_creation: 443615, cost_usd: 13.4014, dispatches: 5, cost_unmetered: 0

## Time
state: partial
reason: provider-outside-active-union

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
skip_reasons:
