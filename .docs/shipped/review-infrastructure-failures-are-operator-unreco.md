---
slug: review-infrastructure-failures-are-operator-unreco
spec_hash: fb038ebbf7789b233dd9a74336bddb8193a59161e8927fda16a6337fd336b4f0
pr: https://github.com/jstoup111/ai-conductor/pull/1734
shipped: 2026-08-22
engine_version: 20260821T224006Z-0d53215b2c14
---

## Cost
input: 5017461
output: 570078
cache_read: 178223338
cache_creation: 2978498
cost_usd: 80.1361
dispatches: 116
retries: 14
halts: 12
unmetered: count: 43, duration_ms: 0
cost_unmetered: count: 52
providers:
  codex: input: 5016381, output: 323407, cache_read: 89865472, cache_creation: 0, cost_usd: 0, dispatches: 65, cost_unmetered: 52
  claude: input: 1080, output: 246671, cache_read: 88357866, cache_creation: 2978498, cost_usd: 80.1361, dispatches: 39, cost_unmetered: 0

## Time
state: partial
reason: open-executions:parallel:prd_audit,parallel:wiring_check,step:acceptance_specs,step:build,step:finish

## Build Review
laps_to_pass: 3
skipped: 8
cache_hits: 8
infrastructure_failures: 7
rubrics:
  completeness: failures: 0, judged: 5
  rootCause: failures: 2, judged: 11
  scope: failures: 4, judged: 10
  tautology: failures: 1, judged: 3
skip_reasons:
  disabled: 8


<!-- build-review-accepted-risk:start -->
## Accepted build-review risk

Accepted findings: 1

- Finding: `sha256:5cd6d70a1aff1d14c29781cba8e3bc2d7c0e49caa72d54a81af5d5cc5bc37e1d` — rubric: scope

Details are retained in the feature's local build-review disposition store.
<!-- build-review-accepted-risk:end -->