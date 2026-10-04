---
slug: report-absent-overlap-scan-candidate-paths-instead
spec_hash: 056610a8caa0614b0b122c2c90d6dd2d96d1240145aa6cded6ad1fa36223f96c
pr: https://github.com/jstoup111/ai-conductor/pull/2978
shipped: 2026-10-04
engine_version: 20261003T201457Z-42a8ad9bcd91
---

## Cost
input: 953751
output: 91353
cache_read: 14403097
cache_creation: 318469
cost_usd: 10.5162
dispatches: 25
retries: 3
halts: 2
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 953639, output: 61957, cache_read: 12338432, cache_creation: 0, cost_usd: 7.0478, dispatches: 15, cost_unmetered: 0
  claude: input: 112, output: 29396, cache_read: 2064665, cache_creation: 318469, cost_usd: 3.4684, dispatches: 10, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","75eec7c3-ce31-40a0-a347-dd26b6068258","lifecycle-step","finish"],step:execution\u0000["timing-rollup","persisted-ledger","ddbf56d8-0dd9-464b-b5ad-7a1c9d7cbdee","lifecycle-step","prd_audit"],step:execution\u0000["timing-rollup","persisted-ledger","ee206e16-8c7b-4304-824d-49db45883c91","lifecycle-step","architecture_review_as_built"]

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 2
  security: failures: 0, judged: 2
  testQuality: failures: 0, judged: 2
skip_reasons:
