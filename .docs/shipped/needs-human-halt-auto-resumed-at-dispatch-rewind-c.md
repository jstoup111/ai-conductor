---
slug: needs-human-halt-auto-resumed-at-dispatch-rewind-c
spec_hash: 52b25137cebdbbf9f1a7fd48c828166ae15f3c7a970d135751ce11c5a9d46e8f
pr: https://github.com/jstoup111/ai-conductor/pull/2951
shipped: 2026-10-03
engine_version: 20261003T201457Z-42a8ad9bcd91
---

## Cost
input: 1307205
output: 107029
cache_read: 19375694
cache_creation: 441840
cost_usd: 14.0145
dispatches: 23
retries: 0
halts: 3
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 1307061, output: 60672, cache_read: 15744512, cache_creation: 0, cost_usd: 8.9286, dispatches: 13, cost_unmetered: 0
  claude: input: 144, output: 46357, cache_read: 3631182, cache_creation: 441840, cost_usd: 5.0858, dispatches: 10, cost_unmetered: 0

## Time
state: measured
active_ms: 5904227
provider_active_ms: 3686614
no_provider_active_ms: 2217613

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 2
  security: failures: 0, judged: 2
  testQuality: failures: 0, judged: 2
skip_reasons:
