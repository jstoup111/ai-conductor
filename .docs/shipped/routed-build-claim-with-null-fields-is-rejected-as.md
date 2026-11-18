---
slug: routed-build-claim-with-null-fields-is-rejected-as
spec_hash: fdc44b671307cb7afff967ac02037c9aae57ab6982358c8365630922495ed978
pr: https://github.com/jstoup111/ai-conductor/pull/3717
shipped: 2026-11-15
engine_version: 20261115T195756Z-7a81fed9e811
---

## Cost
input: 940477
output: 56749
cache_read: 12978184
cache_creation: 417619
cost_usd: 9.9041
dispatches: 24
retries: 0
halts: 1
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 940399, output: 38700, cache_read: 11406976, cache_creation: 0, cost_usd: 5.8876, dispatches: 17, cost_unmetered: 0
  claude: input: 78, output: 18049, cache_read: 1571208, cache_creation: 417619, cost_usd: 4.0165, dispatches: 7, cost_unmetered: 0

## Time
state: measured
active_ms: 10118072
provider_active_ms: 3727497
no_provider_active_ms: 6390575

## Build Review
laps_to_pass: 1
skipped: 2
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 2
  implementationQuality: failures: 0, judged: 2
  security: failures: 0, judged: 2
  testQuality: failures: 0, judged: 2
skip_reasons:
  paths-unmatched: 2
