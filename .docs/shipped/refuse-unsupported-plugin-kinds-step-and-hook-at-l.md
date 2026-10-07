---
slug: refuse-unsupported-plugin-kinds-step-and-hook-at-l
spec_hash: 51be882d3dac23140e62838eeaa329a9b139988a4cd913b2562120eb4c2844cd
pr: https://github.com/jstoup111/ai-conductor/pull/3032
shipped: 2026-10-07
engine_version: 20261007T164331Z-36ba0cf6988b
findings:
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC-1
    summary: "Superseding the ADR's step/hook reservation is within intent: it is the operator-authorized resolution of the halt, and it aligns the decision record with the shipped retirement. However, the edit dropped the '## Evidence' heading, so the original decision's evidence is now misfiled as part of the amendment. This is a documentation-structure defect in an internal ADR. Plugin authors and runtime behavior are unaffected."
    accepted: false
    authority: engine
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC-2
    summary: "No task's done-when list calls for narrowing the barrel. The effect is to keep the new RETIRED_PLUGIN_KINDS constant off the public types surface while every pre-existing export stays available. That fits the plan's framing of the retired list as validator data rather than a second validity source. One side effect: future plugin.ts exports will no longer flow through the barrel automatically."
    accepted: false
    authority: engine
---

## Cost
input: 469209
output: 40246
cache_read: 5394825
cache_creation: 164014
cost_usd: 5.6075
dispatches: 11
retries: 0
halts: 2
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 469183, output: 29247, cache_read: 5093504, cache_creation: 0, cost_usd: 4.0151, dispatches: 7, cost_unmetered: 0
  claude: input: 26, output: 10999, cache_read: 301321, cache_creation: 164014, cost_usd: 1.5925, dispatches: 4, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","c6e2c230-6154-4050-a0b5-52a0848187b8","lifecycle-step","finish"]

## Build Review
laps_to_pass: 1
skipped: 1
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 1
  security: failures: 0, judged: 1
skip_reasons:
  test_quality_empty_scope: 1
