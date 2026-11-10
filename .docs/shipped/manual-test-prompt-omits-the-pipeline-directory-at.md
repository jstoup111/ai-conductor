---
slug: manual-test-prompt-omits-the-pipeline-directory-at
spec_hash: 018dac41ce15f55879751356b5a70914f94feef31b0419014b633e59169ce5d7
pr: https://github.com/jstoup111/ai-conductor/pull/3679
shipped: 2026-11-10
engine_version: 20261109T160131Z-3c6fb4eda614
---

## Cost
input: 1390236
output: 95593
cache_read: 19197238
cache_creation: 615064
cost_usd: 15.3482
dispatches: 24
retries: 0
halts: 2
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 1390166, output: 69925, cache_read: 17409536, cache_creation: 0, cost_usd: 9.5565, dispatches: 17, cost_unmetered: 0
  claude: input: 70, output: 25668, cache_read: 1787702, cache_creation: 615064, cost_usd: 5.7917, dispatches: 7, cost_unmetered: 0

## Time
state: measured
active_ms: 16686851
provider_active_ms: 3829003
no_provider_active_ms: 12857848

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
