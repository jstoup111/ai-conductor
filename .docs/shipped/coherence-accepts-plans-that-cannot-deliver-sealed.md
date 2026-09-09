---
slug: coherence-accepts-plans-that-cannot-deliver-sealed
spec_hash: 8ee7023bed6a3c4fc5c59136e2e8e24971d79f03d7a87172460161394be1e6eb
pr: https://github.com/jstoup111/ai-conductor/pull/2470
shipped: 2026-09-09
engine_version: 20260909T211045Z-92cc3c626398
---

## Cost
input: 1097377
output: 189648
cache_read: 29504388
cache_creation: 1015470
cost_usd: 33.6534
dispatches: 18
retries: 4
halts: 3
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 1097231, output: 97708, cache_read: 21305600, cache_creation: 0, cost_usd: 10.4455, dispatches: 10, cost_unmetered: 0
  claude: input: 146, output: 91940, cache_read: 8198788, cache_creation: 1015470, cost_usd: 23.2079, dispatches: 8, cost_unmetered: 0

## Time
state: partial
reason: open-executions:parallel:prd_audit

## Build Review
laps_to_pass: 2
skipped: 0
cache_hits: 4
infrastructure_failures: 0
rubrics:
  testQuality: failures: 0, judged: 8
skip_reasons:
