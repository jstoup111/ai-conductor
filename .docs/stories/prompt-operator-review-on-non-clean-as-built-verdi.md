**Status:** Accepted

# Stories: Prompt operator review on non-clean as-built verdicts (#2698)

Track: technical

Tier: S

Approved by the operator on 2026-09-28 (option A). Only verdicts that complete the as-built step reach the review gate: `APPROVED`, `APPROVED WITH DRIFT NOTES`, and `PLAN_GAP` with its outcome delivered. `BLOCKED` and undelivered `PLAN_GAP` verdicts route to remediation or a halt before the gate and are out of scope.

## Story 1: Non-clean as-built verdicts prompt the operator in non-auto runs

### Acceptance Criteria

#### Happy Path

- Given a non-auto run with the as-built step's review mode conditional, when the as-built step completes with an APPROVED WITH DRIFT NOTES verdict, then the operator review callback is invoked once for the as-built step and no review-required marker file is written.
- Given a non-auto run with the as-built step's review mode conditional, when the as-built step completes with a PLAN_GAP verdict whose outcome is delivered, then the operator review callback is invoked once for the as-built step.

#### Negative Paths

- Given a non-auto run with the as-built step's review mode conditional, when the as-built step completes with a clean APPROVED verdict, then the operator review callback is not invoked for the as-built step and the step is recorded done.
- Given the typed as-built verdict is absent or unreadable, when the as-built review decision is evaluated, then it reports that review is required.

### Done When

- [ ] Acceptance tests drive the real non-auto serial walk and observe the review callback for drift-notes and delivered plan-gap verdicts, and its absence for a clean verdict.
- [ ] A unit test covers the review decision for each verdict kind and for absent and unreadable verdicts.

## Story 2: Auto mode and other conditional steps are unchanged

### Acceptance Criteria

#### Happy Path

- Given an auto-mode run, when the as-built step completes with an APPROVED WITH DRIFT NOTES verdict, then the operator review callback is not invoked and the step is recorded done.

#### Negative Paths

- Given a non-auto run and a conditional step other than the as-built step, when that step completes, then the review prompt still follows the presence of its review-required marker file.

### Done When

- [ ] An auto-mode acceptance test observes no review callback for a drift-notes verdict.
- [ ] The existing conflict_check marker tests pass unchanged.

## Negative-category review

Input integrity: absent or unreadable typed verdicts resolve to review-required so a gate that cannot read its evidence asks the operator rather than silently approving. Mode isolation: auto mode never reaches the review gate, so the daemon path is unchanged. Blast radius: other conditional steps keep the marker-file contract. Operator rejection reuses the existing re-run path and needs no new behavior. No persistence, deletion, network, permission, queue, concurrency, or idempotency surface is introduced; those categories are inapplicable.
