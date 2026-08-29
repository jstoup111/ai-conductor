---
slug: decide-the-daemon-engine-rename-before-the-v1-0-ta
spec_hash: fbc6d62562faaf4348541f805c2ff7615633d5e6094b09078ab4dda170e0ccea
pr: https://github.com/jstoup111/ai-conductor/pull/2023
shipped: 2026-08-29
engine_version: 20260829T124007Z-0fc0ed0e907e
---

## Cost
input: 5024231
output: 755877
cache_read: 183627459
cache_creation: 3761097
cost_usd: 133.3773
dispatches: 66
retries: 8
halts: 4
unmetered: count: 17, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 5023055, output: 422553, cache_read: 102025984, cache_creation: 0, cost_usd: 46.2129, dispatches: 29, cost_unmetered: 0
  claude: input: 1176, output: 333324, cache_read: 81601475, cache_creation: 3761097, cost_usd: 87.1644, dispatches: 20, cost_unmetered: 0

## Time
state: partial
reason: open-executions:parallel:prd_audit

## Build Review
laps_to_pass: 2
skipped: 0
cache_hits: 0
infrastructure_failures: 1
rubrics:
  testQuality: failures: 1, judged: 7
skip_reasons:
