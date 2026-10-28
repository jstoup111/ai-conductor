# Complexity: A recurring concern at a resolved anchor escapes its prior case's retry limits (#3124)

Tier: M

## Rationale

- **It amends an APPROVED ADR decision.** adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication
  D5.6 reads an unbound proposal as "the judge's statement that the case is not that one". Under
  that rule a new `act` case over a source owned only by a resolved case reserves a fresh action
  effect. Only the feature-wide cumulative kickback cap bounds it (verified:
  `reconcileState` in `src/conductor/src/engine/remediation-case-reconciler.ts` stamps a new case
  for every unbound proposal that `convergedCaseFor` does not match). This spec replaces that
  reading with a recorded recurrence lineage and an explicit, reasoned `distinctFrom` declaration.
  That needs a lightweight architecture review and ADR amendments.
- **It crosses the provider contract and the durable store.** The remediate artifact case row
  gains an optional declaration (`remediation-case-artifact.ts` parses case rows with exact key
  sets, and `remediation-case-validator.ts` validates them). The build_review case record gains two
  optional engine-stamped fields (`remediation-case-store.ts` parses records with exact keys). The
  frozen prior-case projection the judge reads (`build-review-adjudication-context.ts`) also
  changes, as does `skills/remediate/SKILL.md`, the one contract both Claude and Codex render
  (verified: `skill-invocation.ts` maps `remediate` to one skill name per provider prefix).
- **A new bound decision sits in the coordinator.** The lineage attempt count (cap 3) has to be
  checked before reconciliation reserves sibling effects. The existing regression and repeat halt
  loop in `build-review-adjudication-coordinator.ts` already does this for the same reason. The
  exhausted-lineage halt extends the existing `remediation_semantic_repeat_halt` event
  (`types/events.ts`, reason `'already-attempted' | 'regressed'`) instead of adding a channel.
- **About 8 production files**: the artifact parser, the validator, the store, the reconciler,
  the coordinator, the context projection, the events union, the findings CLI, plus the remediate skill.
  There is no new module, dependency or step.
- **Not Large.** The operator-confirmed scope excludes non-`act` dispositions, decision stops
  (#3005), explicit rebinds, reopening resolved rows and configuration. The first #2464 spec failed
  to converge because it bundled exactly those surfaces (13/13 as-built laps, 30 tasks, #2924).
