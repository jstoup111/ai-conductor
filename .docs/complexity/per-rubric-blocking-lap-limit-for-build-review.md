# Complexity: per-rubric blocking-lap limit for build_review

Tier: S

Rationale: one config key on an existing config block (`build_review.rubrics.<id>` and
`build_review.custom_rubrics.<id>`), one additive optional field on the existing lap aggregate, one
additional bucket test in the two existing effective reducers, one small state record on the existing
`.pipeline/engine-state.json` store, and one additive optional field on the existing
`build_review_outer_verdict` event with its daemon-log line and CLI projection. No new model, external
integration, auth surface, module boundary, or case-store schema change; the counter is a monotonic
per-rubric set of lap ids, not a state machine. Expected stories: 3. The decisions are recorded by
amending the APPROVED `adr-2026-10-19-build-review-finding-severity-advisory-threshold` (notes beside
D1, D3, D4, D7; new D8 and D9) and `adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication`
(note beside D5; new D7) in place, following the Tier S precedent of
`no-op-guard-refuses-a-kickback-with-new-review-cas`. Per tier rules: architecture-diagram,
architecture-review, conflict-check, coherence-check, and plan-review are skipped.
