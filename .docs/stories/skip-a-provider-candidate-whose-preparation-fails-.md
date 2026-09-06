**Status:** Accepted

# Stories: Skip a provider candidate whose preparation fails (#1285)

Track: technical

Tier: S

Approved by the operator on 2026-09-06 (delegated). Scope is the shared candidate executor's
handling of a failed pre-dispatch preparation hook and the visibility of the resulting skip. The
step-level retry budget after every candidate is exhausted, the self-host preparation hook's own
capability checks, and run-wide provider disabling remain outside this slice.

## Story 1: Advance to the next declared candidate when one cannot be prepared

As an operator who declares an ordered host list, I want a candidate that cannot be prepared for
dispatch to be skipped so that the list behaves as the failover it reads as.

### Acceptance Criteria

#### Happy Path

- Given a step declares two provider candidates and preparation for the first one throws, when the candidate executor runs the step, then the second candidate is invoked and its result is returned as the step result.
- Given preparation for the selected candidate succeeds, when the candidate executor runs the step, then that candidate is invoked exactly once and its result is returned unchanged.

#### Negative Paths

- Given a step declares one provider candidate and preparation for it throws, when the candidate executor runs the step, then the executor returns a failed result whose output names that candidate and the preparation failure instead of propagating the preparation error to its caller.
- Given preparation for a candidate succeeds and that candidate's provider invocation then throws, when the candidate executor runs the step, then the invocation error still propagates to the caller and no further candidate is invoked.

### Done When

- [ ] A unit fixture with two declared candidates whose first preparation throws records zero invocations against the first provider and exactly one against the second.
- [ ] A unit fixture with a single declared candidate whose preparation throws resolves to a failed result rather than rejecting, and that result's output contains the preparation failure text.
- [ ] The existing candidate fixtures whose preparation succeeds keep their current invocation counts, returned outputs, and teardown order.

## Story 2: Make the skipped candidate visible

As an operator reading a run, I want the skipped candidate and its reason recorded so that the
failover is observable rather than something I discover by reading engine source.

### Acceptance Criteria

#### Happy Path

- Given preparation for a candidate throws and another candidate is declared, when the executor records that attempt, then the attempt metadata reports an unavailable outcome, reports that no invocation occurred, and carries the preparation failure as both its failure reason and its fallback reason.
- Given preparation for a candidate throws and another candidate is declared, when the executor announces the transition, then it emits a provider-fallback warning naming the failed candidate, the preparation failure reason, and the next candidate.

#### Negative Paths

- Given preparation for a candidate throws after that candidate's stream observer was created, when the executor advances to the next candidate, then the observer is closed exactly once and the skipped candidate's provider is never invoked.
- Given the preparation failure message contains text the safety redactor removes, when the attempt metadata, the fallback warning, and the all-candidates-unavailable output are produced, then none of them contains that text.

### Done When

- [ ] A unit fixture asserts the skipped candidate's attempt metadata carries an unavailable outcome, an uninvoked marker, a failure reason, and a fallback reason naming the next candidate.
- [ ] A unit fixture asserts the emitted fallback warning is a provider-fallback transition whose failed candidate, reason, and next candidate match the skipped attempt.
- [ ] A unit fixture whose preparation throws with a canary in its message asserts the canary appears in no attempt reason, no warning, and no returned output.

## Negative-category review

Dependency unavailability is the governing category and is covered directly: an unpreparable
candidate is a dependency the run cannot obtain, and Story 1 asserts the loop advances rather than
aborting. Partial failure is covered by the single-candidate criterion, which keeps the step failing
closed when no candidate survives, and by the invocation-throws criterion, which proves the new
catch does not widen into ordinary dispatch errors. Data integrity is covered by the requirement
that a skipped candidate is never reported as invoked, so cost, model, and usage attribution cannot
be credited to a provider that never ran. Resource exhaustion is covered by the observer-close
criterion: advancing a candidate must not leak the prepared observer. Authentication and permission
failures keep their existing recovery precedence, which this change does not reach, because that
precedence is evaluated before candidate classification. Invalid input, concurrent access, cascade
deletion, and model immutability are inapplicable: this slice adds no user input surface, no shared
mutable state, no entity, and no persisted record. Idempotency needs no new criterion because the
executor holds no state across attempts and a synthetic preparation result never marks the runtime
run-wide unavailable, so a later attempt re-runs preparation exactly as the first one did.
