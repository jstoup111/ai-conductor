---
slug: whole-feature-audit-fixes-cannot-land-in-the-stack
spec_hash: 230def3879f3d531531af794282eb00f57e46e53331a9237c50b2b277f29415d
pr: https://github.com/jstoup111/ai-conductor/pull/3219
shipped: 2026-10-14
engine_version: 20261013T232617Z-b88e1a809619
---

## Cost
input: 4412663
output: 420748
cache_read: 121142533
cache_creation: 1556303
cost_usd: 61.841
dispatches: 44
retries: 12
halts: 4
unmetered: count: 1, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 4412523, output: 328236, cache_read: 113115776, cache_creation: 0, cost_usd: 45.9344, dispatches: 31, cost_unmetered: 0
  claude: input: 140, output: 92512, cache_read: 8026757, cache_creation: 1556303, cost_usd: 15.9066, dispatches: 13, cost_unmetered: 0

## Time
state: partial
active_ms: 28374965
reason: provider-evidence-incomplete

## Build Review
laps_to_pass: 1
skipped: 2
cache_hits: 0
infrastructure_failures: 1
rubrics:
  eventSpine: failures: 0, judged: 2
  security: failures: 0, judged: 2
  testQuality: failures: 0, judged: 2
skip_reasons:
  disabled: 2
