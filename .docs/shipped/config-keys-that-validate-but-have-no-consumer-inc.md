---
slug: config-keys-that-validate-but-have-no-consumer-inc
spec_hash: 730db44cbfe7a99864b102f66d0188d43bc4a5b6769887ade7efec915ac709c5
pr: https://github.com/jstoup111/ai-conductor/pull/1957
shipped: 2026-08-28
engine_version: 20260828T131723Z-347b11891a69
---

## Cost
input: 2502822
output: 473822
cache_read: 80930622
cache_creation: 1792593
cost_usd: 69.2789
dispatches: 46
retries: 4
halts: 6
unmetered: count: 12, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 2501884, output: 210990, cache_read: 38131200, cache_creation: 0, cost_usd: 23.3778, dispatches: 19, cost_unmetered: 0
  claude: input: 938, output: 262832, cache_read: 42799422, cache_creation: 1792593, cost_usd: 45.9011, dispatches: 15, cost_unmetered: 0

## Time
state: partial
reason: open-executions:parallel:prd_audit,parallel:wiring_check,step:finish

## Build Review
laps_to_pass: 2
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  testQuality: failures: 1, judged: 5
skip_reasons:
