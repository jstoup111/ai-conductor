**Status:** Accepted

# Stories: Accept the documented unanswerable halt category (#1076)

Track: technical

Tier: S

Approved by the operator on 2026-09-06 (delegated). Scope is the remediation plan validator's accepted halt-category vocabulary and the reporting of a category the validator does not accept. Halt-class policy, retry behavior, remediation routing targets, and the remediation skill's own text remain outside this slice.

## Story 1: Honor every halt category the published contract documents

### Acceptance Criteria

#### Happy Path

- Given a remediation plan whose only gap is a halt carrying the documented unanswerable category, when the engine validator checks that plan, then the gap is retained and the resulting halt names the gap id, its category, and its rationale.
- Given halt gaps carrying the two categories the engine already accepts, when the engine validator checks that plan, then those gaps are retained and reported exactly as they are today.

#### Negative Paths

- Given a remediation plan whose only gap is a halt carrying the documented unanswerable category, when remediation planning completes, then the operator is never told the plan was missing or invalid.

### Done When

- [ ] A validator fixture retains a halt gap whose category is the documented unanswerable value.
- [ ] A remediation fixture whose only gap is that halt reports a halt carrying the gap's own category and rationale, with no missing-or-invalid plan wording.
- [ ] Fixtures for the two previously accepted categories return their existing results, and the engine halt-category enum agrees with the validator's accepted set.

## Story 2: Name a rejected halt category instead of dropping it in silence

### Acceptance Criteria

#### Happy Path

- Given a halt disposition whose category is a value the engine does not accept, when the engine validator checks the plan, then the whole plan is rejected with a diagnostic naming the finding reference, the rejected category value, the accepted category vocabulary, and the category as the rejected field.
- Given a plan carrying one accepted halt disposition and one rejected-category halt disposition, when the engine validator checks it, then the whole plan is rejected with the category-field diagnostic for the rejected entry, the accepted halt does not drive a halt from that attempt, and the attempt is retried within `remediate`'s retry allowance; on exhaustion the caller's existing no-plan handling names the rejected category in its fault.
- Given a rejected halt category reaches daemon output and the audit trail, when each renders that rejection, then it names the category as the rejected field rather than labelling it a disposition.

#### Negative Paths

- Given a halt disposition that carries no category at all, when the engine validator checks the plan, then the whole plan is rejected rather than routed, and the operator-visible diagnostic marks its category as missing.
- Given a remediation attempt that returns no structured result, when it settles, then it is a missing-result fault handled by the existing retry and no-plan path, and no category rejection is invented.

### Done When

- [ ] A validator fixture produces a whole-plan rejection whose diagnostic carries the finding reference, the rejected value, the accepted category vocabulary, and a marker identifying the rejected field.
- [ ] A rejection event is observed at the emitter for each rejected category and is distinguishable from a rejected disposition.
- [ ] A mixed fixture (one accepted halt, one rejected category) produces a whole-plan rejection naming the category field, and no halt is driven by the accepted entry from that attempt.
- [ ] A halt disposition with no category yields a whole-plan rejection whose rendered value marks the category as missing.
- [ ] Missing-result fixtures produce the missing-result fault and no category rejection record.
- [ ] Daemon render and audit-trail fixtures name the category as the rejected field, and existing rejected-disposition fixtures are unchanged.

## Negative-category review

Input integrity is covered by the unaccepted category value, the wholly missing category, and the missing structured result, which together also pin the boundary that keeps this fix from becoming a catch-all that hides real result faults. Idempotency is inapplicable: validation is a pure check of one structured result and holds no state across calls. Permission, network, dependency, deletion, queue, datastore, upload, and transaction categories are inapplicable — the change touches no third-party boundary, writes nothing, and adds no storage. Event-emission failure during rejection reporting is already covered by the existing rejection test file's persistence-throws case, which remains authoritative and is not duplicated here.
