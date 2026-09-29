---
slug: pi-as-a-build-provider
spec_hash: 1bff4a4f54a945deb1a768dc4bc6e7946808f9b27e638dbb08cc744edd41ec9a
pr: https://github.com/jstoup111/ai-conductor/pull/2765
shipped: 2026-09-29
engine_version: 20260929T040448Z-0380da0011dc
---

## Cost
input: 9523039
output: 952917
cache_read: 235746231
cache_creation: 3653181
cost_usd: 155.4419
dispatches: 109
retries: 12
halts: 17
unmetered: count: 3, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 9522233, output: 606455, cache_read: 207106560, cache_creation: 0, cost_usd: 98.7514, dispatches: 64, cost_unmetered: 0
  claude: input: 806, output: 346462, cache_read: 28639671, cache_creation: 3653181, cost_usd: 56.6904, dispatches: 45, cost_unmetered: 0

## Time
state: partial
reason: provider-outside-active-union

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  security: failures: 0, judged: 9
  testQuality: failures: 1, judged: 9
skip_reasons:
