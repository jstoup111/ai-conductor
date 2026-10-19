# Complexity: build_review remediate context scoped to the findings (#3291)

Tier: M

Rationale: The change spans several engine modules that share one contract:
- `build-review-adjudication-context.ts`: the context shape changes. Scoped `admittedTaskContracts` are added alongside an index of every plan task, and the ceiling becomes deliverable per transport.
- `build-review-adjudication-coordinator.ts`: task selection, plus a new, bounded expansion re-dispatch.
- `remediation-case-validator.ts`: admission closure, so admitted ids must be among the supplied bodies.
- The `conductor.ts` judge dispatch: the provider's exit facts are carried into the halt reason.
- The `skills/remediate/SKILL.md` case contract: the index and expansion semantics.

There is no new module, persisted schema, CLI flag or hook. The change does add a judgement round-trip, which behaves like a small state machine, and it interprets an APPROVED ADR clause ("the full admitted task contracts needed to judge repairs", adr-2026-09-10-portable-build-review-policy), so architecture review is warranted. Expect 4–6 stories.
