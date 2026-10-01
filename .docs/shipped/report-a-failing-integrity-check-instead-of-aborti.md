---
slug: report-a-failing-integrity-check-instead-of-aborti
spec_hash: e18677b36987d1ac49ca93b27953299e5731c9b811c4cb858aadea1e2a2126a3
pr: https://github.com/jstoup111/ai-conductor/pull/2860
shipped: 2026-10-01
engine_version: 20260930T225148Z-18b2a2a206ea
---

## Cost
input: 1021541
output: 104149
cache_read: 16768389
cache_creation: 406063
cost_usd: 12.2741
dispatches: 25
retries: 1
halts: 4
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 1021441, output: 70432, cache_read: 14775808, cache_creation: 0, cost_usd: 8.0492, dispatches: 12, cost_unmetered: 0
  claude: input: 100, output: 33717, cache_read: 1992581, cache_creation: 406063, cost_usd: 4.2249, dispatches: 13, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","f02b9bda-049d-4719-a47a-63a2577cf11f","lifecycle-step","finish"]

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
