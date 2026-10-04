---
slug: pi-runs-report-token-usage-and-cost-into-harness-t
spec_hash: 60d923e0542363faa711a93bda7168f996186d036b0146d0c647aff22c44a2b5
pr: https://github.com/jstoup111/ai-conductor/pull/2979
shipped: 2026-10-04
engine_version: 20261004T114847Z-0e5c5e599a67
---

## Cost
input: 1464901
output: 154603
cache_read: 27058619
cache_creation: 578020
cost_usd: 20.2153
dispatches: 37
retries: 2
halts: 4
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 1464741, output: 95371, cache_read: 23828864, cache_creation: 0, cost_usd: 12.4408, dispatches: 23, cost_unmetered: 0
  claude: input: 160, output: 59232, cache_read: 3229755, cache_creation: 578020, cost_usd: 7.7745, dispatches: 14, cost_unmetered: 0

## Time
state: measured
active_ms: 7133255
provider_active_ms: 5049202
no_provider_active_ms: 2084053

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 3
  security: failures: 0, judged: 3
  testQuality: failures: 0, judged: 3
skip_reasons:
