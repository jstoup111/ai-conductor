---
slug: skills-may-bundle-executable-helpers
spec_hash: 96b9db000520e36804f0e7aa0abeea1c3c4e8f0abfcf78f0c52f6568dd4c5196
pr: https://github.com/jstoup111/ai-conductor/pull/2823
shipped: 2026-09-29
engine_version: 20260929T224340Z-3ed99833a1db
---

## Cost
input: 2036656
output: 168257
cache_read: 30911606
cache_creation: 592491
cost_usd: 23.2544
dispatches: 33
retries: 4
halts: 4
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 2036540, output: 122977, cache_read: 27765504, cache_creation: 0, cost_usd: 16.2253, dispatches: 23, cost_unmetered: 0
  claude: input: 116, output: 45280, cache_read: 3146102, cache_creation: 592491, cost_usd: 7.0291, dispatches: 10, cost_unmetered: 0

## Time
state: measured
active_ms: 8806941
provider_active_ms: 7636258
no_provider_active_ms: 1170683

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 1
  security: failures: 0, judged: 2
  testQuality: failures: 0, judged: 2
skip_reasons:
