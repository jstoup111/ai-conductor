# Complexity: Operator-configurable confidence floor for acting on build_review findings

Tier: M

Rationale: Six coordinated production surfaces, none individually large, but they form one
contract change that must land atomically.

> **Amended 2026-09-06 by #2383:** This assessment originally named four surfaces. A source trace
> during architecture-review found two more — the durable case store validates the same enum, and
> the adjudication context carries the type — and established that the floor must apply before
> reconciliation rather than at the effect-dispatch block. The tier is unchanged at M; the surface
> count and seam below are corrected.

- `src/conductor/src/engine/remediation-case-artifact.ts` — `RemediationCaseConfidence` becomes an
  integer 0-100 with engine-validated range; the `invalid-case-confidence` rejection reason keeps
  its name and gains the range case.
- `src/conductor/src/engine/config.ts` — `build_review.adjudication` gains `act_min_confidence`
  alongside `enabled` (key set at line 120, validator at line 266).
- `src/conductor/src/engine/build-review-adjudication-coordinator.ts` — the floor is applied at
  judgement admission, before `reconcileRemediationCases`. It cannot be applied at the effect
  dispatch block (roughly lines 540-660): that block reads effect kinds the reconciler has already
  persisted, so a late rewrite would desync `proposed.case.effect.kind` from the stored record and
  trip the existing fail-fast guards.
- `src/conductor/src/engine/remediation-case-store.ts` — the durable store validates the same
  confidence enum (line 195) and persists it (lines 52, 207). `STORE_VERSION` stays at `v1`: the
  adjudicator is enabled-gated and has produced no durable state, verified by finding zero
  `.pipeline/remediation-cases.json` files across every worktree on 2026-09-06, so there is
  nothing to migrate and a bump would only cost in-flight features a fail-closed halt.
- `src/conductor/src/engine/build-review-adjudication-context.ts` — carries the confidence type
  (line 24) into the adjudicator's context payload.
- `src/conductor/src/types/events.ts` — the demotion is stamped on the remediation event spine so
  it reaches the daemon log and lap evidence.

Not Small: the change alters a machine-consumed contract and a routing decision, and the
no-deadlock and no-tracker constraints are design decisions that need an architecture pass rather
than a plan task. Not Large: no new subsystem, no new seam, no ADR-level decision expected — the
adjudicator architecture is settled by the work #2087 landed, and this extends it in place.

Test blast radius: roughly 57 confidence enum-literal occurrences across 10 test files
(`remediation-case-artifact`, `-effects`, `-reconciler`, `-store`, `-validator`,
`build-review-adjudication`, `-coordinator`, `-context`, `conductor-build-review-adjudication`,
`remediation-case-recovery.integration`). Large but mechanical, and it is fixture churn rather
than new behavior.

Tier-required artifacts: architecture-diagram, lightweight architecture-review, conflict-check,
coherence-check.
