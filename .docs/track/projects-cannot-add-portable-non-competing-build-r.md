# Track: Portable, non-competing build review policy

Track: product

Source: jstoup111/ai-conductor#1986

Scope boundary: All #1986 outcomes, including #1804's effective-provider policy identity wherever needed for correct review caching. General custom-step portability and release-policy redesign in #1344 remain separate. Reuse the completed #1823 missing-skill guard and existing adjudication work, extending their guarantees where this capability requires it.

This adds a consumer-facing capability to select installed review policies and receive a portable, authoritative review outcome.

Operator confirmed the repository, full bounded scope, Large tier, and product track on 2026-09-10. The operator selected approach A on 2026-09-10: independently judged rubrics feeding the existing shared adjudicator. The alternative of one combined policy reviewer was rejected because it couples rubric evidence and cache invalidation and increases a single review's context burden.

Scope check: consumer-facing (installed consumer projects need the capability); catalog n/a (no new skill proposed); provider behavior scoped through both supported provider seams. Shared behavior and consumer documentation are the intended implementation surfaces. Any self-host-specific adaptation remains scoped to that execution boundary.
