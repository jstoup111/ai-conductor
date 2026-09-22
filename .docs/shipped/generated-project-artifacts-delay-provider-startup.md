---
slug: generated-project-artifacts-delay-provider-startup
spec_hash: 8f50013c68c50ca21d01b3d1439b97377013be8dbd1fb808492fe59146199666
pr: https://github.com/jstoup111/ai-conductor/pull/2651
shipped: 2026-09-22
engine_version: 20260922T121502Z-831f81942f9f
---

## Cost
input: 582063
output: 53133
cache_read: 12127387
cache_creation: 164911
cost_usd: 7.6376
dispatches: 12
retries: 0
halts: 0
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 582031, output: 44179, cache_read: 11275264, cache_creation: 0, cost_usd: 5.3384, dispatches: 9, cost_unmetered: 0
  claude: input: 32, output: 8954, cache_read: 852123, cache_creation: 164911, cost_usd: 2.2992, dispatches: 3, cost_unmetered: 0

## Time
state: measured
active_ms: 3093455
provider_active_ms: 2619800
no_provider_active_ms: 473655

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  security: failures: 0, judged: 1
  testQuality: failures: 0, judged: 1
skip_reasons:
