---
slug: operator-configurable-confidence-floor-for-acting-
spec_hash: fc5f6d2e0407d855e761a14ce32aff546356e250f3f148a6bd46ca880e3cf865
pr: https://github.com/jstoup111/ai-conductor/pull/2393
shipped: 2026-09-08
engine_version: 20260907T120758Z-4f8bdec36946
findings:
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC.1
    summary: "src/conductor/src/engine/event-sinks.ts:42 with src/conductor/src/daemon-cli.ts:2527-2529 — the render flip prints `build_review adjudication completed (N settled cases)` for *every* `remediation_adjudication_completed` emission, a pre-existing event fired on all adjudication finalizes (build-review-adjudication-coordinator.ts:352-360), so ordinary judge-dispatched laps that were previously silent now emit a daemon-log line"
    accepted: false
    decision: accept
    rationale: "Operator: rendering remediation_adjudication_completed in the daemon log on every adjudication is wanted; the line makes adjudication finalizes and settled-case counts visible when reading logs for cycling."
---

## Cost
input: 4439028
output: 768307
cache_read: 157642177
cache_creation: 3783982
cost_usd: 153.1901
dispatches: 75
retries: 7
halts: 8
unmetered: count: 17, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 4438190, output: 349481, cache_read: 95023616, cache_creation: 0, cost_usd: 45.4, dispatches: 33, cost_unmetered: 0
  claude: input: 838, output: 418826, cache_read: 62618561, cache_creation: 3783982, cost_usd: 107.7901, dispatches: 25, cost_unmetered: 0

## Time
state: partial
reason: open-executions:parallel:prd_audit,step:finish

## Build Review
laps_to_pass: 2
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  testQuality: failures: 4, judged: 8
skip_reasons:
