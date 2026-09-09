---
slug: coverage-binding-retries-past-its-3-3-budget-when-
spec_hash: 9fba769824e99fd82873b5a3dd0ae1a8931f282358d147afb9a7cebd9e9b7638
pr: https://github.com/jstoup111/ai-conductor/pull/2461
shipped: 2026-09-09
engine_version: 20260909T010219Z-decd14cb6c54
---

## Cost
input: 1536818
output: 235784
cache_read: 46422659
cache_creation: 1502872
cost_usd: 41.8569
dispatches: 32
retries: 5
halts: 1
unmetered: count: 8, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 1536590, output: 122068, cache_read: 31154944, cache_creation: 0, cost_usd: 14.1858, dispatches: 15, cost_unmetered: 0
  claude: input: 228, output: 113716, cache_read: 15267715, cache_creation: 1502872, cost_usd: 27.671, dispatches: 9, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:finish

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  testQuality: failures: 0, judged: 3
skip_reasons:
