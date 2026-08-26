# Track: build_review re-judges what the plan, architecture review, and prd_audit already own

Track: product

Scope boundary: Full consolidation of review-gate ownership (operator-confirmed 2026-08-22). In scope: cut the scope, completeness, and rootCause build_review rubrics; re-key prd_audit to stories/acceptance criteria (PRD as context) with scope-as-intent and a bounded, engine-enforced remediation cap; reshape tautology into an opt-in test-quality rubric; make build_review a rubric container; give architecture_review_as_built a PLAN_GAP verdict and run it always with per-check policy; Done when: evidence at BUILD task close; run prd_audit on any acceptance-criteria change regardless of tier/track. Excluded: renaming prd_audit; new rubrics beyond test-quality (security etc. later); mechanizing scope by file lists.

Product track because the change alters gate behavior operators observe (verdicts, halts, config keys, what gets built) and changes acceptance tests; "technical" is reserved for refactors that touch no acceptance criteria.
