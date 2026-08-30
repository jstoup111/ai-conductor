---
slug: v1-0-cutover-remove-bin-conduct-make-the-ts-cli-ai
spec_hash: cf57539c98b0295da9da58b8f300c35d15fe1a8ba6e23d9d8770341e47c4ce82
pr: https://github.com/jstoup111/ai-conductor/pull/2052
shipped: 2026-08-30
engine_version: 20260830T004837Z-9b0dcf6b399a
---

## Cost
input: 2193660
output: 304336
cache_read: 61546786
cache_creation: 1007772
cost_usd: 43.7888
dispatches: 32
retries: 2
halts: 5
unmetered: count: 9, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 2193268, output: 168026, cache_read: 43159296, cache_creation: 0, cost_usd: 20.6585, dispatches: 15, cost_unmetered: 0
  claude: input: 392, output: 136310, cache_read: 18387490, cache_creation: 1007772, cost_usd: 23.1303, dispatches: 8, cost_unmetered: 0

## Time
state: partial
reason: open-executions:parallel:prd_audit

## Build Review
laps_to_pass: 2
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  testQuality: failures: 1, judged: 4
skip_reasons:
