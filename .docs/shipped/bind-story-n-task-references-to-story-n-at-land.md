---
slug: bind-story-n-task-references-to-story-n-at-land
spec_hash: c009f089651a7a81c151b773bc14fa4b8b90aa6a7bc133f0d03c3759bac1e144
pr: https://github.com/jstoup111/ai-conductor/pull/2404
shipped: 2026-09-10
engine_version: 20260909T231115Z-a985c68b5d37
---

## Cost
input: 1110492
output: 210844
cache_read: 39807476
cache_creation: 957867
cost_usd: 32.7292
dispatches: 21
retries: 1
halts: 4
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 1110282, output: 106139, cache_read: 32413568, cache_creation: 0, cost_usd: 13.5164, dispatches: 11, cost_unmetered: 0
  claude: input: 210, output: 104705, cache_read: 7393908, cache_creation: 957867, cost_usd: 19.2128, dispatches: 10, cost_unmetered: 0

## Time
state: partial
reason: open-executions:parallel:prd_audit

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  testQuality: failures: 0, judged: 4
skip_reasons:
