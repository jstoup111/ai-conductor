---
slug: make-bin-install-uninstall-remove-installer-settin
spec_hash: a2d5eee72b571285afd8d3591300bbabcbc2be90088d4cc9a1adc208738055cd
pr: https://github.com/jstoup111/ai-conductor/pull/2808
shipped: 2026-09-29
engine_version: 20260929T105729Z-f7dec31e6e68
---

## Cost
input: 1569825
output: 100132
cache_read: 22857812
cache_creation: 284744
cost_usd: 15.989
dispatches: 23
retries: 1
halts: 2
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 1569751, output: 79969, cache_read: 21176960, cache_creation: 0, cost_usd: 13.0081, dispatches: 16, cost_unmetered: 0
  claude: input: 74, output: 20163, cache_read: 1680852, cache_creation: 284744, cost_usd: 2.9809, dispatches: 7, cost_unmetered: 0

## Time
state: measured
active_ms: 7750562
provider_active_ms: 4974622
no_provider_active_ms: 2775940

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
