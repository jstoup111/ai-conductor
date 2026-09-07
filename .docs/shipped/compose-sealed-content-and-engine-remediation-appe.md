---
slug: compose-sealed-content-and-engine-remediation-appe
spec_hash: a0dc23f26765eca768ccf0e47e6ca8cf480236c3828f627e465e1bb3dc5ed48a
pr: https://github.com/jstoup111/ai-conductor/pull/2394
shipped: 2026-09-07
engine_version: 20260907T120758Z-4f8bdec36946
findings:
  - gate: architecture_review_as_built
    finding: AB-1
    class: REMEDIABLE
    governing_clause: "Task 2"
    outcome: remediated
    summary: "An unreadable seal baseline returns `baseline-unresolvable` before the required base-tip-only verdict can be evaluated."
---

## Cost
input: 1223471
output: 126072
cache_read: 25140230
cache_creation: 214028
cost_usd: 15.586
dispatches: 18
retries: 2
halts: 1
unmetered: count: 6, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 1223369, output: 81610, cache_read: 22158848, cache_creation: 0, cost_usd: 10.2602, dispatches: 9, cost_unmetered: 0
  claude: input: 102, output: 44462, cache_read: 2981382, cache_creation: 214028, cost_usd: 5.3258, dispatches: 3, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:finish

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
skip_reasons:
