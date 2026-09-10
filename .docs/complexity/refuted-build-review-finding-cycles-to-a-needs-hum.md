# Complexity: Refuted build_review finding cycles to a needs-human halt instead of settling

Tier: M

Rationale: One new judge-authored terminal outcome threads through a versioned contract —
`remediation-case-artifact.ts` parse, `remediation-case-validator.ts` graph rules,
`remediation-case-reconciler.ts` disposition-transition and reuse classification,
`remediation-case-store.ts` durable shape, the coordinator's repeat-halt branch, one new
`ConductorEvent` member, `build-review-cli.ts` findings rendering, and the pinned
`skills/remediate/SKILL.md` case-v1 section. It amends an APPROVED ADR's semantic-case-repeat
decision rather than adding a step, provider, or store, and the unrefuted-repeat halt path is
unchanged. Bounded surface, several seams, no new infrastructure: Medium.
