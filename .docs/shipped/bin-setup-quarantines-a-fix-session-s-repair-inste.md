---
slug: bin-setup-quarantines-a-fix-session-s-repair-inste
spec_hash: b18f01fedffc57eb2c39262eeb2a79da3058f609b268225341828b34d015907e
pr: https://github.com/jstoup111/ai-conductor/pull/2108
shipped: 2026-09-05
engine_version: 20260905T014027Z-b9d908fa9678
---

## Cost
input: 5406288
output: 986716
cache_read: 159716664
cache_creation: 3971093
cost_usd: 143.5612
dispatches: 97
retries: 6
halts: 16
unmetered: count: 23, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 5404662, output: 390013, cache_read: 91801984, cache_creation: 0, cost_usd: 54.9672, dispatches: 35, cost_unmetered: 0
  claude: input: 1626, output: 596703, cache_read: 67914680, cache_creation: 3971093, cost_usd: 88.594, dispatches: 39, cost_unmetered: 0

## Time
state: partial
reason: open-executions:parallel:prd_audit

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  testQuality: failures: 2, judged: 9
skip_reasons:
