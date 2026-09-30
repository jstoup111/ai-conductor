---
slug: ignore-covers-markers-inside-test-string-literals
spec_hash: 48c8dc78f873266898cc5ae66d09ccacba8b51c2a71717997af53d9584f0d79f
pr: https://github.com/jstoup111/ai-conductor/pull/2881
shipped: 2026-09-30
engine_version: 20260930T103720Z-7384b902bf38
---

## Cost
input: 426210
output: 32392
cache_read: 6695398
cache_creation: 144569
cost_usd: 4.4017
dispatches: 10
retries: 0
halts: 0
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 426148, output: 21592, cache_read: 5661440, cache_creation: 0, cost_usd: 2.857, dispatches: 5, cost_unmetered: 0
  claude: input: 62, output: 10800, cache_read: 1033958, cache_creation: 144569, cost_usd: 1.5447, dispatches: 5, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","facd11ee-00ee-4737-a092-a418d4a79877","lifecycle-step","finish"]

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 1
  security: failures: 0, judged: 1
  testQuality: failures: 0, judged: 1
skip_reasons:
