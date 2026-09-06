---
slug: remediable-as-built-blocked-verdict-halts-needs-hu
spec_hash: 1f415f1ace64ad87f4d54b16c84b63c759dbc6a46df69e6e6fb8f6a5928a6c50
pr: https://github.com/jstoup111/ai-conductor/pull/2201
shipped: 2026-09-06
engine_version: 20260906T032235Z-0c471cd2a03d
findings:
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC.1
    summary: "src/conductor/src/engine/conductor.ts:10963-10979 — the serial as-built halt's blocking-findings listing moved from the HALT marker into `reason`, so `surfaceRemediationPr(reason)` and `emitLoopHalt(reason)` now carry it for every serial as-built halt class (DESIGN, invalid, undelivered PLAN_GAP), not only the remediable no-plan case the plan's Task 7 scopes"
    accepted: true
  - gate: architecture_review_as_built
    finding: AB-1
    class: REMEDIABLE
    governing_clause: "Task 1"
    outcome: remediated
    summary: "The approved Task 1 amendment required removal of the caller-less readRemediationPlan compatibility export and migration of its test-only callers; current source satisfies that requirement."
---

## Cost
input: 2392399
output: 385845
cache_read: 59384547
cache_creation: 1839530
cost_usd: 56.9112
dispatches: 59
retries: 2
halts: 5
unmetered: count: 20, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 2391845, output: 183701, cache_read: 38032128, cache_creation: 0, cost_usd: 22.7833, dispatches: 19, cost_unmetered: 0
  claude: input: 554, output: 202144, cache_read: 21352419, cache_creation: 1839530, cost_usd: 34.1279, dispatches: 20, cost_unmetered: 0

## Time
state: partial
reason: open-executions:parallel:prd_audit,step:finish

## Build Review
laps_to_pass: 2
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  testQuality: failures: 1, judged: 6
skip_reasons:
