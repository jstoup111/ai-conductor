# Complexity: a bound build_review re-raise of a resolved action case routes a judged residual gap to BUILD under the lineage limit (#3362)

Tier: M

## Rationale

- The change spans engine modules that share one contract:
  - `remediation-case-artifact.ts` and `remediation-case-validator.ts`: a bound `act` row may carry a schema-constrained `reRaise: { kind, reason }` declaration, which counts only when the row binds a resolved `act` case with an applied action effect.
  - `build-review-adjudication-coordinator.ts`: the explicit-rebind regression halt splits by the declared kind. A residual or undeclared rebind joins the existing lineage-limit check. A declared repeat halts as today and names the lineage's applied attempts.
  - `remediation-case-reconciler.ts`: a routed residual rebind mints a new `act` case stamped `recurrenceOf` the bound case, leaving the resolved row byte-identical.
  - `types/events.ts`: additive optional fields on `remediation_case_reconciled` and `remediation_semantic_repeat_halt`.
  - `skills/remediate/SKILL.md`: the build_review case contract states when and how to declare `reRaise`.
- No new module, persisted store field, CLI flag, hook or dependency. The lineage limit (mixed-laps D5.10), the halting-binding writer and the recurrence stamp already exist and are reused.
- It narrows an APPROVED ADR rule (`adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication` D5.6: an explicit `act` rebind of a resolved action case halts as a regression), so an architecture diagram and a lightweight architecture review are needed. It edits the same coordinator, reconciler and validator as the landed-but-unbuilt #3461 spec, so a conflict check is needed.
- Not Large: one existing routing decision is split, not a new state machine; no external integration; about 3 stories and 6–8 plan tasks.
- The precedents with the same shape, #3124 (the recurrence lineage) and #3461 (the correction round), were Tier M.
