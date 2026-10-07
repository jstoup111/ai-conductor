---
slug: monitor-guided-sessions-no-way-to-choose-provider-
spec_hash: 628a54d13c78e6965d92fc7f5fc64c7058b751a172787390568f20b10894eb0b
pr: https://github.com/jstoup111/ai-conductor/pull/3030
shipped: 2026-10-07
engine_version: 20261007T134220Z-a1a68521069c
findings:
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC-1
    summary: "These are test-fixture isolation repairs for intake overlap tests, which are unrelated to monitor provider/model/effort selection and owned by no task. They are test-only and change no shipped behavior."
    accepted: false
    authority: engine
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC-2
    summary: "Help text and config-template documentation for the new per-run flags and the `monitor` block. This is user-visible but directly serves FR-2/FR-3 and is consistent with the plan intent."
    accepted: false
    authority: engine
  - gate: architecture_review_as_built
    finding: interactive-model-control-characters
    class: REMEDIABLE
    governing_clause: "adr-2026-10-06-catalog-owned-interactive-model-and-effort decision 5"
    outcome: remediated
    summary: "src/conductor/src/engine/monitor/selection.ts:30 rejects C0 controls but permits DEL (U+007F) and C1 controls (U+0080–U+009F). For example, a model containing opus followed by U+007F passes validation and reaches provider argv. D5 requires models to contain no control characters. Verified by source inspection; confidence 99%. This is the sole violating validation site."
---

## Cost
input: 1149878
output: 147745
cache_read: 19452336
cache_creation: 490943
cost_usd: 15.8073
dispatches: 21
retries: 2
halts: 0
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 1149748, output: 87390, cache_read: 16002176, cache_creation: 0, cost_usd: 10.0544, dispatches: 11, cost_unmetered: 0
  claude: input: 130, output: 60355, cache_read: 3450160, cache_creation: 490943, cost_usd: 5.7529, dispatches: 10, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","20af0f38-77d8-4ff9-871c-c3a61cd1afcf","lifecycle-step","architecture_review_as_built"],step:execution\u0000["timing-rollup","persisted-ledger","2f41a340-1c8d-4446-b458-7afb9419e590","lifecycle-step","finish"],step:execution\u0000["timing-rollup","persisted-ledger","f39c67e2-f187-405e-a0dd-91c8dfbbe6f0","lifecycle-step","prd_audit"]

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 2
  security: failures: 0, judged: 2
  testQuality: failures: 0, judged: 2
skip_reasons:
