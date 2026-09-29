---
slug: per-project-work-tracker-backend-selection-in-regi
spec_hash: 321e62fe074fa60c5bb806f5e1700815599fd9675539444d01bd1051d52d144a
pr: https://github.com/jstoup111/ai-conductor/pull/2825
shipped: 2026-09-29
engine_version: 20260929T143128Z-78113f1e7e2f
findings:
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC.1
    summary: "src/conductor/src/engine/build-review-policy-bundle.ts:301-306,332 — private validateBundleLimits renamed and exported as validateReviewPolicyBundleLimits, and its test rewritten (commit 49761fc81); unrelated to tracker selection, no behavior change"
    accepted: true
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC.2
    summary: "src/conductor/src/engine/intake-backend-composite.ts:144-155 — a GitHub write-back whose owning project has an unreadable or malformed tracker block is skipped with an invalid-config event and {ok:true}; no task or criterion specifies this case, and no test covers it"
    accepted: true
---

## Cost
input: 2568857
output: 286418
cache_read: 53037940
cache_creation: 1179963
cost_usd: 37.0616
dispatches: 53
retries: 5
halts: 3
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 2568565, output: 169877, cache_read: 45260160, cache_creation: 0, cost_usd: 20.9329, dispatches: 30, cost_unmetered: 0
  claude: input: 292, output: 116541, cache_read: 7777780, cache_creation: 1179963, cost_usd: 16.1287, dispatches: 23, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","67a0da4b-3062-46b6-aa80-ff8c6489ed6e","lifecycle-step","finish"]

## Build Review
laps_to_pass: 2
skipped: 0
cache_hits: 2
infrastructure_failures: 1
rubrics:
  eventSpine: failures: 0, judged: 4
  security: failures: 0, judged: 6
  testQuality: failures: 1, judged: 5
skip_reasons:
