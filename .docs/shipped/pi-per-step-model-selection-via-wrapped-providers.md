---
slug: pi-per-step-model-selection-via-wrapped-providers
spec_hash: 6b6787e49fee1bb3cc1df3e4dffa5b3d1b75183690f61b5d9467e64fb41d0758
pr: https://github.com/jstoup111/ai-conductor/pull/2880
shipped: 2026-10-02
engine_version: 20261001T231952Z-4b73f5cb657b
---

## Cost
input: 4326215
output: 492052
cache_read: 97625635
cache_creation: 2201641
cost_usd: 72.5875
dispatches: 72
retries: 3
halts: 8
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 4325673, output: 264652, cache_read: 79843968, cache_creation: 0, cost_usd: 41.5643, dispatches: 37, cost_unmetered: 0
  claude: input: 542, output: 227400, cache_read: 17781667, cache_creation: 2201641, cost_usd: 31.0232, dispatches: 35, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","cc0fb7a3-3994-4871-bacb-2557612420e1","lifecycle-step","architecture_review_as_built"],step:execution\u0000["timing-rollup","persisted-ledger","ef535ad0-5270-497b-914d-8711f0a17efc","lifecycle-step","prd_audit"]

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 6
  security: failures: 0, judged: 6
  testQuality: failures: 2, judged: 6
skip_reasons:
