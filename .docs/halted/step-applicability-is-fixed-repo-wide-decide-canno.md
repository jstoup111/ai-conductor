# Halt record

Status: halted
Slug: step-applicability-is-fixed-repo-wide-decide-canno
Class: needs-human
Halting step: unknown
Phase: unknown
Branch: feat/daemon-step-applicability-is-fixed-repo-wide-decide-canno
Head SHA: c7b6803f55606be9f3d0af1c908ac227eac7ced5
Halted at: 2026-10-06T10:59:26.147Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
coverage_binding refused: cited Done when checks do not assert the required claim.

Criterion: Story 8 negative: Given an enabled repository and manual_test failed for the feature, when a spec amendment declaring manual_test inapplicable is merged and the feature is re-dispatched, then manual_test is not skipped, the declaration does not change its failed status, manual_test is retried through normal dispatch and must still pass its gate, and a step_inapplicable_refused event naming manual_test with prior status failed is persisted.
Task ids: 12
Done when checks: With `manual_test` already `failed` and a seeded `manual_test` declaration, `manual_test` keeps status `failed` and one `step_inapplicable_refused` event naming `manual_test` with `priorStatus: "failed"` is persisted, as asserted in `test/engine/conductor-feature-applicability.test.ts`. | With `manual_test` `in_progress` or halted and a seeded declaration, `manual_test` is not skipped and one `step_inapplicable_refused` event carrying that prior status is persisted. | With `acceptance_specs` already `done` and a seeded declaration, `acceptance_specs` keeps status `done` and one `step_inapplicable_refused` event with `priorStatus: "done"` is persisted. | A step already recorded in `ConductState.feature_inapplicable` stays `skipped` on re-dispatch and zero `step_inapplicable_refused` events are persisted for it. | After a rebase-transition onto a new base and after an operator rewind, a `manual_test` recorded in `feature_inapplicable` remains `skipped` and zero `step_inapplicable_refused` events are persisted.
Missing assertion: "manual_test is retried through normal dispatch and must still pass its gate"
```
