---
slug: prompt-operator-review-on-non-clean-as-built-verdi
spec_hash: e06347feae75e2ea595ffc76b7a338c0e2ab020965fc79ef845b5ad3d3302178
pr: https://github.com/jstoup111/ai-conductor/pull/2939
shipped: 2026-10-03
engine_version: 20261003T154506Z-bedb65cf8e47
findings:
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC.1
    summary: "src/conductor/test/self-host-verification-entries.test.ts:31 and src/conductor/test/acceptance/full-suite-verification-gate.acceptance.test.ts:264 — unplanned test-assertion alignment to the committed test_suite.verification config"
    accepted: true
---

## Cost
input: 554183
output: 44016
cache_read: 7043966
cache_creation: 153987
cost_usd: 5.1102
dispatches: 12
retries: 0
halts: 1
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 554121, output: 31908, cache_read: 5947648, cache_creation: 0, cost_usd: 3.4573, dispatches: 7, cost_unmetered: 0
  claude: input: 62, output: 12108, cache_read: 1096318, cache_creation: 153987, cost_usd: 1.6529, dispatches: 5, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","5a519eef-be54-4ef1-82a0-300ce8eafddf","lifecycle-step","finish"]

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 1
  security: failures: 0, judged: 1
  testQuality: failures: 0, judged: 1
skip_reasons:
