# Track: build_review implementation-quality rubric

Track: technical

Scope boundary: Add a third built-in `build_review` rubric, enabled by default, that judges the
evaluator-only review dimensions no gate owns: code quality (duplication, complexity, readability)
and domain integrity (domain-type modelling and naming) over the feature diff. Acceptance-criteria
compliance is excluded — `prd_audit` owns it under adr-2026-08-22-one-owner-per-review-question D1.
Conformance to approved ADRs is excluded — the as-built review owns it. Out of scope: retiring
the `/pipeline` batch evaluators, tier table, `review.json`/evaluator closeout gates, and
code-review-satisfied marker (follow-on intake, blocked on jstoup111/ai-conductor#475); changing the
existing `testQuality`/`security` defaults; per-boundary `/simplify`, lint, and affected-test runs.

Internal harness gating change with no product requirements; acceptance criteria live in stories.
