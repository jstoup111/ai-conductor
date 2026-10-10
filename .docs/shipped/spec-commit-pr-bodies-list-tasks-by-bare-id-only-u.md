---
slug: spec-commit-pr-bodies-list-tasks-by-bare-id-only-u
spec_hash: 778b1d4f845a788f61dc088bae64ae50979d20d9cbd1c6d64df27447e03f5d8a
pr: https://github.com/jstoup111/ai-conductor/pull/3091
shipped: 2026-10-10
engine_version: 20261010T011143Z-f79d1fd8d7cd
findings:
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC-1
    summary: "This unplanned edit raises the recorded largest-observed plan-intent size, likely because this feature's own plan intent (about 952 bytes) exceeded the old recorded maximum. It is outside the story's intent about the spec commit message's Tasks section. Because the Math.max floor of 256 KiB dominates, it does not change projection limits or any user-visible behavior; it only updates an engineering-bound bookkeeping constant."
    accepted: false
    authority: engine
---

## Cost
input: 477744
output: 34922
cache_read: 5367932
cache_creation: 135473
cost_usd: 5.6098
dispatches: 15
retries: 0
halts: 0
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 477700, output: 25705, cache_read: 4797184, cache_creation: 0, cost_usd: 4.2274, dispatches: 9, cost_unmetered: 0
  claude: input: 44, output: 9217, cache_read: 570748, cache_creation: 135473, cost_usd: 1.3824, dispatches: 6, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","254309d3-2597-4408-8129-81ec175cb105","lifecycle-step","finish"]

## Build Review
laps_to_pass: 1
skipped: 2
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 2
  security: failures: 0, judged: 2
skip_reasons:
  test_quality_empty_scope: 2
