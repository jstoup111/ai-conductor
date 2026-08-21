---
slug: rebase-invalidated-test-suite-proof-halts-build-re
spec_hash: 87e48517b1a91afd99711e05260e598da30e895a9249e8bc957d67ced06453d5
pr: https://github.com/jstoup111/ai-conductor/pull/1741
shipped: 2026-08-21
engine_version: 20260821T033153Z-6ffcedc91636
---

## Cost
input: 3532329
output: 379430
cache_read: 110888868
cache_creation: 3110036
cost_usd: 62.2434
dispatches: 73
retries: 18
halts: 7
unmetered: count: 14, duration_ms: 0
cost_unmetered: count: 41
providers:
  codex: input: 3531661, output: 212272, cache_read: 56967424, cache_creation: 0, cost_usd: 0, dispatches: 41, cost_unmetered: 41
  claude: input: 668, output: 167158, cache_read: 53921444, cache_creation: 3110036, cost_usd: 62.2434, dispatches: 23, cost_unmetered: 0

## Time
state: partial
reason: open-executions:parallel:wiring_check,step:build

## Build Review
laps_to_pass: 7
skipped: 1
cache_hits: 44
infrastructure_failures: 6
rubrics:
  completeness: failures: 3, judged: 16
  rootCause: failures: 6, judged: 19
  scope: failures: 0, judged: 16
  tautology: failures: 15, judged: 18
skip_reasons:
  disabled: 1
