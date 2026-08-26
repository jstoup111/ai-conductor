# Complexity: build_review re-judges what the plan, architecture review, and prd_audit already own

Tier: L

Rationale: touches four gates (build_review, prd_audit, architecture_review_as_built, BUILD task close), the rubric registry/config schema, the kickback ledger and remediation-append engine paths (new engine-enforced caps and criterion binding), three skill contracts (cut/reshape), new verdict vocabularies (PLAN_GAP, FIXABLE, OVER_SCOPE), run-rule changes across tiers/tracks, and docs/runbooks. Expected story count >10 with ADRs superseding adr-2026-07-21 (completeness rubric) and related build_review ADRs.
