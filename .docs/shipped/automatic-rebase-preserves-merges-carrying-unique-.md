---
slug: automatic-rebase-preserves-merges-carrying-unique-
spec_hash: 04d5a43079d86c0f372924afb4565fbaca0c139a382b2f1c531d17385c0836a6
pr: https://github.com/jstoup111/ai-conductor/pull/2861
shipped: 2026-10-01
engine_version: 20260930T225148Z-18b2a2a206ea
---

## Cost
input: 5449630
output: 818602
cache_read: 118991175
cache_creation: 3560266
cost_usd: 107.706
dispatches: 106
retries: 9
halts: 8
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 5448742, output: 372011, cache_read: 91715456, cache_creation: 0, cost_usd: 52.0253, dispatches: 44, cost_unmetered: 0
  claude: input: 888, output: 446591, cache_read: 27275719, cache_creation: 3560266, cost_usd: 55.6807, dispatches: 62, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","175e65d6-b98a-41ed-bc73-9960743965a7","lifecycle-step","finish"]

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 2
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 12
  security: failures: 0, judged: 12
  testQuality: failures: 8, judged: 12
skip_reasons:
