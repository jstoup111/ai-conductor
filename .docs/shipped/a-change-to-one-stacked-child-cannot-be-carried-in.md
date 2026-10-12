---
slug: a-change-to-one-stacked-child-cannot-be-carried-in
spec_hash: 9f7e131d925074a7436d011a5f6818c89ad8417b377504b414f138c7205878d9
pr: https://github.com/jstoup111/ai-conductor/pull/3169
shipped: 2026-10-12
engine_version: 20261011T230829Z-d677b3f7832c
---

## Cost
input: 8734066
output: 1311827
cache_read: 280271696
cache_creation: 10193612
cost_usd: 211.1405
dispatches: 121
retries: 15
halts: 18
unmetered: count: 1, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 8733438, output: 598409, cache_read: 208466816, cache_creation: 0, cost_usd: 100.9598, dispatches: 66, cost_unmetered: 0
  claude: input: 628, output: 713418, cache_read: 71804880, cache_creation: 10193612, cost_usd: 110.1807, dispatches: 55, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","855901af-ffc4-4634-b71e-915beed4ab62","lifecycle-step","finish"]

## Build Review
laps_to_pass: 4
skipped: 0
cache_hits: 6
infrastructure_failures: 5
rubrics:
  eventSpine: failures: 4, judged: 18
  security: failures: 0, judged: 18
  testQuality: failures: 6, judged: 14
skip_reasons:


<!-- build-review-accepted-risk:start -->
## Accepted build-review risk

Accepted findings: 1

- Finding: `sha256:7d4924ae9e57772b57c1617f2afbcd1e14d1a73c1411f7f16a5b3998ffe16a47` — rubric: eventSpine

Details are retained in the feature's local build-review disposition store.
<!-- build-review-accepted-risk:end -->

## Reduced build-review coverage

- Rubric: `testQuality`
  Cause: `projection-oversized`
  Current diagnostic: projection-oversized: measured=1096275 bytes limit=1048576 bytes
  Operator: james-stoup
  Rationale: Operator accepts reduced testQuality coverage: projection oversized (1,096,275 > 1,048,576) after a 128-test evidence sweep whose every new test was proven to fail against a deliberate production break.
  Decision time: 2026-10-12T01:19:09.560Z
