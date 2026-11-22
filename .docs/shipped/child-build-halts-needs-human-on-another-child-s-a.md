---
slug: child-build-halts-needs-human-on-another-child-s-a
spec_hash: e5593a5a56849c34977db07715d49227908a9949e2bb061204b54d8f286eddb6
pr: https://github.com/jstoup111/ai-conductor/pull/3727
shipped: 2026-11-22
engine_version: 20261122T020604Z-3379a47ff8d4
findings:
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC-1
    summary: "These are test-stabilization seams unrelated to the remediation-region stories. The production change is an optional injection point that defaults to the existing behaviour, so it changes no operator-visible output, CLI result, or persisted state."
    accepted: false
    authority: engine
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC-2
    summary: "This is a whitespace and line-wrapping reformat with no semantic change, beyond what the stories need. It does not alter behaviour or persisted state."
    accepted: false
    authority: engine
  - gate: architecture_review_as_built
    finding: "as-built:b11a0af3-53f3-4f2f-ac30-7dfe9f58702f:1"
    class: REMEDIABLE
    governing_clause: "adr-2026-11-15-remediation-build-inputs-are-region-state-retired-on-settlement decision 4"
    outcome: remediated
    summary: "Verified, 99% confidence: legacy adoption/retirement runs only through durableBuildReviewRetryContext (conductor.ts:6397), whose sole caller is guarded by buildReviewAdjudicationEnabled() at conductor.ts:12245–12248. The supported disabled setting (types/config.ts:911–914; resolved-config.ts:964) therefore leaves flat remediation artifacts before child BUILD, contrary to D4's unconditional boundary. Run compatibility cleanup independently of adjudication."
  - gate: architecture_review_as_built
    finding: "as-built:b11a0af3-53f3-4f2f-ac30-7dfe9f58702f:2"
    class: REMEDIABLE
    governing_clause: "adr-2026-11-15-remediation-build-inputs-are-region-state-retired-on-settlement decision 3"
    outcome: remediated
    summary: "Verified, 99% confidence: zero-work stalls capture a question at conductor.ts:14861, but dispatch exceptions, misroutes, planner halts, and planner faults exclude zero-work from retirement at :15010, :15063, :15094, and :15124; exhausted remediation budget also falls through at :14975. The eventual terminal HALT at :16987 returns at :17001 without retiring the captured question or remaining stall gap plan. Add retirement after the terminal stall HALT while preserving existing retry/auto-park routing."
  - gate: architecture_review_as_built
    finding: "as-built:189645ac-2164-4900-a225-e266de23e63f:1"
    class: REMEDIABLE
    governing_clause: "adr-2026-11-15-remediation-build-inputs-are-region-state-retired-on-settlement decision 4"
    outcome: remediated
    summary: "Verified, 99% confidence: the repair moves adoption too late. conductor.ts:12247 calls durableBuildReviewRetryContext before adoption at :12933. With an open action case and only a legacy flat work order, the regional read at :6433 returns missing; :6440 returns invalid and :12248–12254 halts before adoption. This regression is newly introduced by removing adoption from durable recovery since the prior review. Ensure unconditional adoption precedes durable recovery while retaining per-dispatch cleanup for retries."
---

## Cost
input: 9642562
output: 703522
cache_read: 167540676
cache_creation: 5952471
cost_usd: 118.8634
dispatches: 133
retries: 36
halts: 9
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 1
providers:
  codex: input: 9642264, output: 533938, cache_read: 141634816, cache_creation: 0, cost_usd: 62.6696, dispatches: 101, cost_unmetered: 1
  claude: input: 298, output: 169584, cache_read: 25905860, cache_creation: 5952471, cost_usd: 56.1938, dispatches: 32, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","ba516c61-f36e-4dc4-80e4-ec2f74b16b38","lifecycle-step","test_suite"],step:execution\u0000["timing-rollup","persisted-ledger","e1d24830-830d-40e6-bde6-010a08b9be17","lifecycle-step","finish"]

## Build Review
laps_to_pass: 4
skipped: 12
cache_hits: 6
infrastructure_failures: 3
rubrics:
  eventSpine: failures: 0, judged: 11
  implementationQuality: failures: 8, judged: 8
  security: failures: 0, judged: 11
  testQuality: failures: 0, judged: 11
skip_reasons:
  paths-unmatched: 12
