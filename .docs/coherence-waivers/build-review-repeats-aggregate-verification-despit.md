# Coherence waiver: descoped intake outcomes (jstoup111/ai-conductor#1173)

Waives: outcome-2, outcome-4, outcome-5, outcome-6

Rationale: The operator explicitly narrowed this feature during DECIDE to a single concern — a
scoped BUILD or review command must not be able to silently expand into the aggregate suite. The
four waived outcomes are real work, but they are owned elsewhere and are deliberately not delivered
by this spec.

outcome-2 (one authoritative aggregate result reused for an unchanged code state) is already
substantially built: FullSuiteVerifier persists a content-addressed proof at
`.pipeline/test-suite-evidence.json` and its `ensure()` returns REUSED without executing whenever
the fingerprint is CURRENT. What remains — sharing that one result across every downstream step — is
owned by issue #1176, which names it directly as "equivalent verification or judgment evidence is
produced once and reused by downstream gates while it remains current." Building a second reuse path
here is precisely the partial-sibling failure already tracked as issue #1205, where a capability
half-landed across two features changed BUILD behavior while its verification was incomplete.

outcome-4 (semantic review receives a bounded structured summary with raw logs outside the prompt)
rests on a premise that architecture review found to be false. The build_review grader is already
structurally input-isolated: `assembleBuildReviewInputs` takes only a git runner and a plan path, and
the prompt is built from the diff and the plan body alone. No command output or maker narrative is
streamed into it today, so there is nothing to bound. Adding scoped-test summaries to that prompt
would actively violate the isolation contract of adr-2026-07-07-build-review-judgement-gate. The
genuinely unbounded input is the raw diff, which is a size concern owned by issue #1176.

outcome-5 (review output size and duration fall materially from the measured baseline) and
outcome-6 (any model-tier or reasoning-effort reduction evaluated in shadow before it changes a
blocking verdict) are both calibration work against a measured baseline. They require telemetry
comparison and a shadow-evaluation harness, neither of which this feature introduces, and both are
named explicitly in issue #1176, which is priority critical, size L, on the v1.0 milestone, and
already assigned. Delivering them here would duplicate assigned critical work.

The in-scope outcomes are fully mapped: outcome-1 to stories 1, 3, 4, 5, 7, and 8, and outcome-3 to
story 6 as a preserved regression invariant.
