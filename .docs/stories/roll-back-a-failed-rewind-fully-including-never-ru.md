**Status:** Accepted

# Stories: Roll back a failed rewind fully, including never-run steps (#2181)

Track: technical

Tier: S

Approved by the operator on 2026-09-06 (delegated). Scope is the operator rewind command's failure path: restoring step statuses that were absent before the rewind, restoring the gate verdicts the rewind removed, and reporting the failure that stopped the rewind ahead of any rollback failure. A successful rewind's demotion set, target status, and clearing order are unchanged.

## Story 1: A failed rewind leaves the feature exactly as it found it

As an operator recovering a feature halted part-way through its build, I want a rewind that cannot finish to leave nothing behind, so that I can retry it instead of repairing pipeline state by hand.

### Acceptance Criteria

#### Happy Path

- Given a feature whose recorded position is part-way through its pipeline and whose later steps have no recorded status, when a rewind to an earlier step succeeds, then the target and every later non-skipped step is recorded stale, the gates directory holds no entry for any demoted step, and both halt markers are gone.

#### Negative Paths

- Given that same feature, when clearing the derived records fails after the demotion is applied, then every step that had no recorded status before the rewind has no recorded status after it, and every step that had one is back to its earlier value.
- Given that same feature, when clearing the derived records fails after the demotion is applied, then each gate verdict the rewind removed for a demoted step is readable again with its original contents.
- Given a state store that offers no explicit field-deletion authority and a rewind that demoted steps with no recorded status, when clearing the derived records fails, then the command names the fields it could not restore and exits non-zero.

### Done When

- [ ] A command-boundary test drives an injected derived-record failure over a part-way state and finds the previously unrecorded step keys absent from the persisted state document afterwards.
- [ ] A command-boundary test compares each demoted step's gate verdict bytes before the rewind and after the injected failure and finds them identical.
- [ ] A command-boundary test over a store without deletion authority asserts the reported message contains the unrestorable field names and the exit code is 1.
- [ ] A command-boundary test over a successful rewind finds no residual entry for any demoted step in the gates directory.

## Story 2: The operator sees the failure that stopped the rewind

As an operator reading a failed rewind, I want the reported cause to be the failure that stopped it, so that I fix the real problem instead of chasing the recovery path's own error.

### Acceptance Criteria

#### Happy Path

- Given a rewind that succeeds, when the command exits, then it reports the rewound target and emits no rollback diagnostic at all.

#### Negative Paths

- Given a rewind whose derived-record clearing fails and whose rollback then succeeds, when the command exits, then the only reported failure is the original clearing failure and the exit code is 1.
- Given a rewind whose derived-record clearing fails and whose rollback also fails, when the command exits, then the original clearing failure is reported before the rollback failure and the rollback failure is labelled as one.

### Done When

- [ ] A command-boundary test records the ordered reported messages and asserts the clearing failure text appears before any rollback text.
- [ ] A command-boundary test asserts a rewind whose rollback succeeds reports exactly one failure message.
- [ ] A command-boundary test asserts the rollback failure message is distinguishable from the original failure by its own prefix.

## Negative-category review

Partial failure and rollback is the subject of both stories and is covered directly. Data integrity is covered by asserting both halves of the restored state — absent keys stay absent and recorded statuses return to their earlier values — and by asserting the removed gate verdicts come back byte-identical. Dependency unavailability is covered by the store that offers no deletion authority, which must report rather than silently skip. Invariant side-effect on an alternate branch is covered by the rollback branch itself: it must restore the derived records that only the success branch was ever expected to delete. Concurrent access is already covered by the store's compare-and-set expectations, which the rollback keeps using and which this change does not weaken. Invalid input, authentication, timeouts, resource exhaustion, cascade deletion, model-level immutability, exception class hierarchy, and deduplication keys are inapplicable: the command takes one already-validated target, runs locally with no network or credentials, deletes no records with dependents, and has no idempotency key.
