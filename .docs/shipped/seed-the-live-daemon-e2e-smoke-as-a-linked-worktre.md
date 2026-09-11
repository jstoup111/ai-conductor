---
slug: seed-the-live-daemon-e2e-smoke-as-a-linked-worktre
spec_hash: 53ebc7e60100c221a4038c9c212f95e8a08f16f50de9978c5a432f66cad5bb8d
pr: https://github.com/jstoup111/ai-conductor/pull/2475
shipped: 2026-09-11
engine_version: 20260910T220211Z-39b4ec92e0a6
---

## Cost
input: 917157
output: 132078
cache_read: 21551383
cache_creation: 594403
cost_usd: 19.389
dispatches: 18
retries: 0
halts: 3
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 917045, output: 81094, cache_read: 17731968, cache_creation: 0, cost_usd: 9.2962, dispatches: 10, cost_unmetered: 0
  claude: input: 112, output: 50984, cache_read: 3819415, cache_creation: 594403, cost_usd: 10.0928, dispatches: 8, cost_unmetered: 0

## Time
state: partial
reason: open-executions:parallel:prd_audit,step:build_review

## Build Review
laps_to_pass: 3
skipped: 0
cache_hits: 0
infrastructure_failures: 4
rubrics:
  testQuality: failures: 0, judged: 2
skip_reasons:
