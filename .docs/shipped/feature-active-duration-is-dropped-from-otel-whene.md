---
slug: feature-active-duration-is-dropped-from-otel-whene
spec_hash: cee3f4dcdeef777917bfad976ecaf1b417be89ff80753723a5f1f17d64847601
pr: https://github.com/jstoup111/ai-conductor/pull/3486
shipped: 2026-10-28
engine_version: 20261028T021231Z-b9e6f799bc28
---

## Cost
input: 895966
output: 89287
cache_read: 17309943
cache_creation: 456840
cost_usd: 13.7479
dispatches: 15
retries: 1
halts: 0
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 895910, output: 61230, cache_read: 15313024, cache_creation: 0, cost_usd: 9.1324, dispatches: 10, cost_unmetered: 0
  claude: input: 56, output: 28057, cache_read: 1996919, cache_creation: 456840, cost_usd: 4.6155, dispatches: 5, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","a8e679bc-4e18-4199-9161-9d2f3b7a431b","lifecycle-step","finish"]

## Build Review
laps_to_pass: 1
skipped: 1
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 1
  security: failures: 0, judged: 1
  testQuality: failures: 0, judged: 1
skip_reasons:
  disabled: 1
