---
slug: remove-the-unattended-one-shot-inline-run-auto-the
spec_hash: 2b58ddf144b02278d534278fcc66de66bfe0447bf0ea7ee4ff3d4254ccc2e3a0
pr: https://github.com/jstoup111/ai-conductor/pull/1974
shipped: 2026-08-28
engine_version: 20260828T051725Z-80907eaa21b5
---

## Cost
input: 1812290
output: 279181
cache_read: 42204752
cache_creation: 967904
cost_usd: 38.3883
dispatches: 34
retries: 2
halts: 2
unmetered: count: 9, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 1811868, output: 151617, cache_read: 27053056, cache_creation: 0, cost_usd: 17.9422, dispatches: 14, cost_unmetered: 0
  claude: input: 422, output: 127564, cache_read: 15151696, cache_creation: 967904, cost_usd: 20.4461, dispatches: 11, cost_unmetered: 0

## Time
state: partial
reason: open-executions:parallel:prd_audit

## Build Review
laps_to_pass: not reached
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
skip_reasons:
