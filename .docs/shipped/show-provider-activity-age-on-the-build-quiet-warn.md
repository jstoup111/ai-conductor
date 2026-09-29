---
slug: show-provider-activity-age-on-the-build-quiet-warn
spec_hash: e91ba8a7389e152fba57adf27c90f9f2829a934a4a5142f04f90d7a12bf49cbc
pr: https://github.com/jstoup111/ai-conductor/pull/2824
shipped: 2026-09-29
engine_version: 20260928T232244Z-91f41cedca69
---

## Cost
input: 452068
output: 35079
cache_read: 7306302
cache_creation: 136500
cost_usd: 4.4402
dispatches: 10
retries: 0
halts: 0
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 452046, output: 28689, cache_read: 6854784, cache_creation: 0, cost_usd: 3.13, dispatches: 7, cost_unmetered: 0
  claude: input: 22, output: 6390, cache_read: 451518, cache_creation: 136500, cost_usd: 1.3102, dispatches: 3, cost_unmetered: 0

## Time
state: measured
active_ms: 2487629
provider_active_ms: 1928092
no_provider_active_ms: 559537

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  security: failures: 0, judged: 1
  testQuality: failures: 0, judged: 1
skip_reasons:
