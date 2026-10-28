# Complexity: build_review remediate context scoped to the findings (#3291)

Tier: M

Rationale: The change spans several engine modules that share one contract:
- `build-review-adjudication-coordinator.ts`: task selection from existing plan parsers, and one bounded expansion round around the existing `judge` call.
- `build-review-adjudication-context.ts`: the plan contract gains an index of every plan task beside the scoped bodies.
- `remediation-case-validator.ts`: the existing `unknown-admission-task` rejection names the offending task ids, so the coordinator can tell an index-only admission from any other invalid judgement.
- `conductor.ts` and `step-runners.ts`: the remediate judge carries the provider's exit facts into the halt reason.
- `types/events.ts`: an additive optional field on `remediation_adjudication_started` marks the expansion round.
- `skills/remediate/SKILL.md`: the index and expansion semantics in the case contract.

There is no new module, persisted schema, CLI flag or hook. The change does add a second judge round inside one lap and amends two APPROVED ADRs (mixed-laps D2, portable-policy D8), so architecture review is warranted. Expect 4–5 stories and about 8–10 plan tasks.
