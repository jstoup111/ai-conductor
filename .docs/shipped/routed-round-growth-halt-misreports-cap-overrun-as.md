---
slug: routed-round-growth-halt-misreports-cap-overrun-as
spec_hash: aeb7f93984e50985758ca3bf9472186493c6b3af25dca52707da2d4b0d98e5ad
pr: https://github.com/jstoup111/ai-conductor/pull/3524
shipped: 2026-10-29
engine_version: 20261029T113550Z-f30879854aa9
---

## Cost
input: 2497529
output: 203928
cache_read: 32097314
cache_creation: 1078350
cost_usd: 29.2771
dispatches: 57
retries: 9
halts: 2
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 9
providers:
  codex: input: 2497377, output: 121144, cache_read: 28566400, cache_creation: 0, cost_usd: 18.2879, dispatches: 38, cost_unmetered: 9
  claude: input: 152, output: 82784, cache_read: 3530914, cache_creation: 1078350, cost_usd: 10.9893, dispatches: 19, cost_unmetered: 0

## Time
state: partial
reason: provider-outside-active-union

## Build Review
laps_to_pass: 3
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 5
  implementationQuality: failures: 2, judged: 5
  security: failures: 0, judged: 5
  testQuality: failures: 0, judged: 5
skip_reasons:
