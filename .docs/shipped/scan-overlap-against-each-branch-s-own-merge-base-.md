---
slug: scan-overlap-against-each-branch-s-own-merge-base-
spec_hash: 819d885073d4780ee460f3aaf266ac3bda570f3ce1b0e2a2156c638b914cddf0
pr: https://github.com/jstoup111/ai-conductor/pull/2455
shipped: 2026-09-09
engine_version: 20260909T211045Z-92cc3c626398
---

## Cost
input: 549626
output: 76256
cache_read: 10422244
cache_creation: 433118
cost_usd: 11.2099
dispatches: 13
retries: 1
halts: 1
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 549542, output: 43726, cache_read: 7621376, cache_creation: 0, cost_usd: 4.1145, dispatches: 8, cost_unmetered: 0
  claude: input: 84, output: 32530, cache_read: 2800868, cache_creation: 433118, cost_usd: 7.0954, dispatches: 5, cost_unmetered: 0

## Time
state: measured
active_ms: 4407339
provider_active_ms: 2165231
no_provider_active_ms: 2242108

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  testQuality: failures: 0, judged: 2
skip_reasons:
