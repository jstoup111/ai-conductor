---
slug: post-plan-decide-amendments-never-reconcile-with-t
spec_hash: 3298a6e62066922f76397c47188ee150fc802a4d8bca732faf3cec3ea51c1b7f
pr: https://github.com/jstoup111/ai-conductor/pull/2745
shipped: 2026-09-26
engine_version: 20260925T125013Z-084a4eab8370
---

## Cost
input: 2322145
output: 349881
cache_read: 54556086
cache_creation: 1864391
cost_usd: 52.2979
dispatches: 220
retries: 7
halts: 10
unmetered: count: 159, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 2321895, output: 213345, cache_read: 48124160, cache_creation: 0, cost_usd: 22.4422, dispatches: 189, cost_unmetered: 0
  claude: input: 250, output: 136536, cache_read: 6431926, cache_creation: 1864391, cost_usd: 29.8558, dispatches: 31, cost_unmetered: 0

## Time
state: partial
reason: provider-outside-active-union

## Build Review
laps_to_pass: 10
skipped: 0
cache_hits: 3
infrastructure_failures: 4
rubrics:
  security: failures: 0, judged: 13
  testQuality: failures: 8, judged: 9
skip_reasons:
