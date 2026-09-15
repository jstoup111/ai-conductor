---
slug: recover-stale-conduct-state-lease-recovery-claims
spec_hash: 16b8c032404df5b93d0c4966caefd03a01adae3f57a3ca4461afd58c3eb613a5
pr: https://github.com/jstoup111/ai-conductor/pull/2539
shipped: 2026-09-15
engine_version: 20260915T105227Z-df26a1d8ebd1
---

## Cost
input: 2754047
output: 438472
cache_read: 65105391
cache_creation: 1991100
cost_usd: 67.6149
dispatches: 52
retries: 9
halts: 5
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 2753631, output: 253305, cache_read: 47285888, cache_creation: 0, cost_usd: 24.8315, dispatches: 29, cost_unmetered: 0
  claude: input: 416, output: 185167, cache_read: 17819503, cache_creation: 1991100, cost_usd: 42.7834, dispatches: 23, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:finish

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  testQuality: failures: 0, judged: 4
skip_reasons:
