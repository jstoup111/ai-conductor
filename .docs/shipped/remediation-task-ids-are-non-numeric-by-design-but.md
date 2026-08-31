---
slug: remediation-task-ids-are-non-numeric-by-design-but
spec_hash: ef7d617dfce9375cf8b51df9ae10d69ff532959bdf663df297a6ead7d36493a3
pr: https://github.com/jstoup111/ai-conductor/pull/2105
shipped: 2026-08-31
engine_version: 20260831T151339Z-b3dce780e8f0
findings:
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC.1
    summary: "src/conductor/src/engine/artifacts.ts:750-771 adds `readActivePlanText`/`activePlanTextFor` and threads plan text into eight parse sites (artifacts.ts:932, :3178, :3248, :4666, :4713, :4872; conductor.ts:823-830, :894-901), and artifacts.ts:4506-4516 adds a new fail-closed rejection when no active plan resolves — surface the plan's seven tasks did not enumerate"
    accepted: true
---

## Cost
input: 1480086
output: 200763
cache_read: 34798473
cache_creation: 1033662
cost_usd: 33.1261
dispatches: 30
retries: 2
halts: 2
unmetered: count: 9, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 1479828, output: 124053, cache_read: 22379520, cache_creation: 0, cost_usd: 14.661, dispatches: 12, cost_unmetered: 0
  claude: input: 258, output: 76710, cache_read: 12418953, cache_creation: 1033662, cost_usd: 18.4651, dispatches: 9, cost_unmetered: 0

## Time
state: partial
reason: open-executions:parallel:prd_audit,step:finish

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  testQuality: failures: 0, judged: 3
skip_reasons:
