**Status:** Accepted

# Stories: Successful stacked restack halts on a stale reopen of the gate it re-pended (#3469)

Technical track, Tier S. Scope boundary: `.docs/track/successful-stacked-restack-halts-on-a-stale-reopen.md`.
Engine code that runs inside a conductor process (a stacked restack, a routed leaf return) writes
conduct state outside the conductor's own state calls. The conductor then computes later writes
from the value it loaded earlier, and the store refuses them as conflicts. #3469 records three call
sites: the tail reopen after a base-refresh restack, the validation-group join after a resume-time
restack, and the rebase status save after a resume-time leaf return. #3394 is the same tail-reopen
shape on another feature. These stories cover all of them.

## Story 1: A state batch accepts a field that already holds its target value

**Requirement:** #3469 desired outcomes 2 and 3; `adr-2026-08-01-conduct-state-mutation-port` conflict rule 2

As the conductor, I want a batched state write whose field already holds the requested value to succeed, so that re-asserting a state another engine writer already reached is not reported as a concurrent conflict.

### Acceptance Criteria

#### Happy Path
- Given a conduct-state document holding `test_suite: pending` and `last_step: build_review`, when one batch submits `test_suite` with expected `done` and next `pending` together with `last_step` with expected `build_review` and next `rebase`, then the batch reports success and the document holds `test_suite: pending` and `last_step: rebase` after exactly one persisted write.
- Given the #3394 layout of a three-child stack (the feature document has no `test_suite`, children 1 and 2 hold `test_suite: done`, child 3 holds `test_suite: pending`), when a reopen of `test_suite` with expected `done` and next `pending` is applied through the store routed to child 3, then it succeeds and the feature document and the documents of children 1 and 2 are byte-identical to before.

#### Negative Paths
- Given a conduct-state document holding `test_suite: stale`, when a batch submits `test_suite` with expected `done` and next `pending`, then the batch is refused as a conflict whose message is `Expected test_suite to match before reopen test_suite selected gate` and the document is byte-identical to before.
- Given a batch whose first mutation's field already holds its next value and whose second mutation's field holds neither its expected nor its next value, when the batch is applied, then nothing is written, the document is byte-identical to before, and the conflict message names the second field.

### Done When
- [ ] The filesystem store's batch path returns success for a batch whose every mutation is either expected-matching or already at its next value, and persists the batch in one write.
- [ ] A batch containing any mutation whose field holds neither its expected nor its next value persists nothing and returns a conflict naming that field.

## Story 2: A base-refresh restack in the rebase step continues to the re-pended gate

**Requirement:** #3469 desired outcome 1 (first recorded call site); #3394 desired outcomes 1 and 3

As an operator, I want a stacked feature whose pre-finish rebase restacks onto a moved default branch to go straight on to the gate the restack re-pended, so that the most expensive automated step succeeding does not cost me a halt clear.

### Acceptance Criteria

#### Happy Path
- Given a daemon-mode two-child stacked feature resumed at its leaf with every BUILD region step done, whose rebase step base-refreshes onto a moved default branch and re-pends `test_suite` in the leaf child's state, when the rebase step completes, then the run's next dispatched step is `test_suite`, the events contain `step_completed` for `rebase` followed by `step_started` for `test_suite`, no `loop_halt` event is emitted and no `.pipeline/HALT` exists.

#### Negative Paths
- Given the same stacked feature whose default branch has not moved, when the rebase step completes as a stacked no-op, then the leaf child's state still holds `test_suite: done` and `build_review: done`, `test_suite` is not dispatched, and no `loop_halt` event is emitted.
- Given the same restack, when the conductor adopts the re-pended state after the rebase step, then the adoption itself writes nothing: every conduct-state document is byte-identical immediately before and after it.

### Done When
- [ ] A real-Git stacked rebase test that no longer stops at the park boundary after `rebase` observes `test_suite` dispatched next with no `loop_halt` and no HALT file.
- [ ] The stacked no-op variant leaves the leaf child's region statuses unchanged and dispatches no region step.

## Story 3: A resume-time restack or routed leaf return does not break later gate writes

**Requirement:** #3469 desired outcome 1 (second and third recorded call sites)

As an operator, I want a resumed stacked feature whose preflight restacks or returns to the leaf to record its later gate results normally, so that a halt clear does not discard gates that already passed.

### Acceptance Criteria

#### Happy Path
- Given a routed stacked feature whose loaded state holds `rebase: stale` and whose resume stack preflight returns to the leaf and re-pends `prd_audit`, `architecture_review_as_built`, `manual_test` and `rebase` in the feature state, when the resumed run's rebase step succeeds and the conductor records it, then the feature state holds `rebase: done` and no error containing `Expected rebase to match before save rebase step status` is raised.
- Given a stacked feature whose loaded state holds a value other than `pending` for `prd_audit` and `architecture_review_as_built`, and whose resume stack preflight applies a journaled restack that re-pends both in the feature state, when the validation group later joins with both members satisfied, then the feature state holds `prd_audit: done` and `architecture_review_as_built: done` and no error containing `Expected prd_audit to match before join` is raised.
- Given a routed host whose region exit runs a feature-repair restack that re-pends `prd_audit` in the feature state while the conductor's loaded value differs, when the conductor rebinds to the next child's BUILD region and later records `prd_audit`, then that write is persisted with no conflict.

#### Negative Paths
- Given a resume stack preflight that writes nothing to conduct state, when the conductor adopts durable state after it, then every conduct-state document is byte-identical before and after the adoption and the run selects the same first step as it does today.
- Given the feature's `.pipeline/conduct-state.json` is absent when the conductor adopts durable state, when the run continues, then no loaded field is dropped and the next conductor write recreates the file holding every field the conductor had loaded.

### Done When
- [ ] A resume test with a stubbed preflight that writes the leaf-return re-pends asserts `rebase: done` is persisted after the rebase step with no conflict error.
- [ ] A resume test with a stubbed preflight that writes the restack re-pends asserts the validation-group join persists both members `done`.
- [ ] A child-region rebind test asserts a feature-wide value written on disk before the rebind is the expectation the conductor's next write to that field uses.

## Story 4: A genuine concurrent change still fails closed

**Requirement:** #3469 desired outcome 3; #3394 desired outcome 2

As an operator, I want a state change made by another writer after the conductor last read state to still halt the run, so that adopting engine-written state never turns a real lost update into silent success.

### Acceptance Criteria

#### Happy Path
- Given a resumed stacked feature whose preflight adoption has completed, when another writer sets `prd_audit: stale` in the feature state while the validation group's members are running, then the join is refused, the run halts with an error containing `Expected prd_audit to match before join`, and the feature state still holds `prd_audit: stale`.

#### Negative Paths
- Given a field the conductor has changed in memory but not yet saved, and a different value written to disk for that field by a restack during the same step, when the conductor adopts durable state and then persists its pending changes, then the in-memory value is not replaced by the disk value, the write is refused as a conflict naming that field, and the disk keeps the restack's value.
- Given another writer changes a field after the conductor's adoption, when the conductor's next write to that field uses the adopted value as its expectation, then the write is refused as a conflict naming the field and the other writer's value stays on disk.

### Done When
- [ ] A group test whose fake member writes `prd_audit: stale` to disk during dispatch observes the join conflict and the halt.
- [ ] A conductor-baseline test asserts adoption leaves a locally changed field's in-memory value and its baseline untouched, so the following persist is refused.
