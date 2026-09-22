---
slug: projects-cannot-add-portable-non-competing-build-r
spec_hash: b3c9aa3ecd6baf2bf051973b7a0528b3230643d6c7c851d9b735b6d12e2a1609
pr: https://github.com/jstoup111/ai-conductor/pull/2523
shipped: 2026-09-22
engine_version: 20260921T190121Z-82744e8bd62d
findings:
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC.1
    summary: "src/conductor/src/engine/otel/span-manager.ts:122,341-343 — execution-context step spans now pass their event-clock start and end times to OTel as Date objects instead of numbers; no task Files entry or story criterion covers span timing"
    accepted: true
---

## Cost
input: 14143881
output: 3973365
cache_read: 854670195
cache_creation: 26912046
cost_usd: 864.3503
dispatches: 264
retries: 31
halts: 35
unmetered: count: 29, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 14139021, output: 1436361, cache_read: 377415552, cache_creation: 0, cost_usd: 159.5793, dispatches: 133, cost_unmetered: 0
  claude: input: 4860, output: 2537004, cache_read: 477254643, cache_creation: 26912046, cost_usd: 704.771, dispatches: 131, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:build,step:build_review,step:execution\u0000["timing-rollup","persisted-ledger","f0bde272-f9f7-47e0-ac35-ea69ccb8cd05","lifecycle-step","finish"]

## Build Review
laps_to_pass: 4
skipped: 3
cache_hits: 8
infrastructure_failures: 6
rubrics:
  security: failures: 6, judged: 15
  testQuality: failures: 5, judged: 34
skip_reasons:
  disabled: 3


<!-- build-review-accepted-risk:start -->
## Accepted build-review risk

Accepted findings: 2

- Finding: `sha256:7db9b49ba13c2c48fb46984385dd6be5844cf06525b8978bc33100a710432651` — rubric: security
- Finding: `sha256:8613162637f434be77fa83f8287cc9559b464ccb846295bb3e29c787ade71822` — rubric: security

Details are retained in the feature's local build-review disposition store.
<!-- build-review-accepted-risk:end -->