# Complexity: one corrected re-judgement for an inadmissible build_review case binding (#3461)

Tier: M

## Rationale

- The change spans engine modules that share one contract:
  - `remediation-case-reconciler.ts`: the disposition-change admission becomes one exported predicate, used by its own backstop check.
  - `build-review-adjudication-context.ts`: every prior case carries `bindableDispositions`, and a correction round carries `bindingCorrections`.
  - `remediation-case-validator.ts`: a new `inadmissible-case-binding` rejection, checked last.
  - `build-review-adjudication-coordinator.ts`: one bounded correction round beside the existing expansion round.
  - `types/events.ts`: an additive optional field on `remediation_adjudication_started`.
  - `skills/remediate/SKILL.md`: the case contract's binding rule.
- No new module, persisted schema, CLI flag, hook or dependency. The durable case store and its transitions are unchanged.
- It adds a second bounded judge round inside one lap and amends two APPROVED ADRs (`adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication` D2, `adr-2026-09-10-portable-build-review-policy` D9), so an architecture diagram and a lightweight architecture review are needed. It interacts with in-flight build_review work (#3491, #3362), so a conflict check is needed.
- Not Large: one existing state machine is read, not changed; no external integration; about 3 stories and 7–8 plan tasks.
- The precedent with the same shape, #3291 (the expansion round), was Tier M.
