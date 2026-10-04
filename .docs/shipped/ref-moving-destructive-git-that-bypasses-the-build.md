---
slug: ref-moving-destructive-git-that-bypasses-the-build
spec_hash: def3b850e4fa936d1fa7519065fc9d79d435ef37e8b77509ebd7b017b441fbd5
pr: https://github.com/jstoup111/ai-conductor/pull/2969
shipped: 2026-10-04
engine_version: 20261004T114847Z-0e5c5e599a67
---

## Cost
input: 2372580
output: 314040
cache_read: 40886046
cache_creation: 1638673
cost_usd: 36.4281
dispatches: 64
retries: 5
halts: 2
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 2372198, output: 158321, cache_read: 32168192, cache_creation: 0, cost_usd: 17.6977, dispatches: 27, cost_unmetered: 0
  claude: input: 382, output: 155719, cache_read: 8717854, cache_creation: 1638673, cost_usd: 18.7304, dispatches: 37, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","22f6637d-a992-475f-a99b-c724e9a45ff8","lifecycle-step","finish"],step:execution\u0000["timing-rollup","persisted-ledger","97b5e7ee-dd2f-4e15-af77-53db858eac2f","lifecycle-step","finish"]

## Build Review
laps_to_pass: 8
skipped: 0
cache_hits: 5
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 9
  security: failures: 0, judged: 9
  testQuality: failures: 8, judged: 9
skip_reasons:
