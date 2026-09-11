**Status:** Accepted

# Stories: Accept the documented unanswerable halt category (#1076)

Track: technical

Tier: S

Approved by the operator on 2026-09-06 (delegated). Scope is the remediation plan parser's accepted halt-category vocabulary and the reporting of a category the parser does not accept. Halt-class policy, retry behavior, remediation routing targets, and the remediation skill's own text remain outside this slice.

## Story 1: Honor every halt category the published contract documents

### Acceptance Criteria

#### Happy Path

- Given a remediation plan whose only gap is a halt carrying the documented unanswerable category, when the engine reads that plan, then the gap is retained and the resulting halt names the gap id, its category, and its rationale.
- Given halt gaps carrying the two categories the parser already accepts, when the engine reads that plan, then those gaps are retained and reported exactly as they are today.

#### Negative Paths

- Given a remediation plan whose only gap is a halt carrying the documented unanswerable category, when remediation planning completes, then the operator is never told the plan was missing or invalid.

### Done When

- [ ] A parser fixture retains a halt gap whose category is the documented unanswerable value.
- [ ] A remediation fixture whose only gap is that halt reports a halt carrying the gap's own category and rationale, with no missing-or-invalid plan wording.
- [ ] Fixtures for the two previously accepted categories return their existing results, and the in-code comment naming the accepted categories agrees with the parser.

## Story 2: Name a rejected halt category instead of dropping it in silence

### Acceptance Criteria

#### Happy Path

- Given a halt gap whose category is a value the engine does not accept, when the engine reads that plan, then that gap becomes a rejection naming the gap id, the rejected category value, and the accepted category vocabulary.
- Given a plan carrying one accepted halt gap and one rejected-category halt gap, when remediation planning completes, then the accepted gap still drives the halt and the rejected category is named in the same operator detail.
- Given a rejected halt category reaches daemon output and the audit trail, when each renders that rejection, then it names the category as the rejected field rather than labelling it a disposition.

#### Negative Paths

- Given a halt gap that carries no category at all, when the engine reads that plan, then the gap is rejected rather than routed, and the operator-visible text marks its category as missing.
- Given the remediation plan file is absent, stale, or not parseable as JSON, when remediation planning runs, then the outcome is unchanged from today and no category rejection is invented.

### Done When

- [ ] A parser fixture returns a category rejection carrying the gap id, the rejected value, the accepted category vocabulary, and a marker identifying the rejected field.
- [ ] A rejection event is observed at the emitter for each rejected category and is distinguishable from a rejected disposition.
- [ ] A mixed fixture halts on the accepted gap and also names the rejected category in the same detail.
- [ ] A halt gap with no category yields a rejection whose rendered value marks the category as missing.
- [ ] Absent, stale, and unparseable plan fixtures return the outcome they return today and produce no rejection record.
- [ ] Daemon render and audit-trail fixtures name the category as the rejected field, and existing rejected-disposition fixtures are unchanged.

## Negative-category review

Input integrity is covered by the unaccepted category value, the wholly missing category, and the absent, stale, and unparseable plan file, which together also pin the boundary that keeps this fix from becoming a catch-all that hides real parse failures. Idempotency is inapplicable: the parser is a pure read of one file and holds no state across calls. Permission, network, dependency, deletion, queue, datastore, upload, and transaction categories are inapplicable — the change touches no third-party boundary, writes nothing, and adds no storage. Event-emission failure during rejection reporting is already covered by the existing rejection test file's persistence-throws case, which remains authoritative and is not duplicated here.
