**Status:** Accepted

# Verified rebase recovery

## Story 1: Resume a verified build

**Requirement:** FR-1, FR-3

#### Happy Path

- Given a completed rebase for the halted attempt whose checks pass, when the daemon evaluates the feature with upstream unchanged, then the next required step starts without operator cleanup or a waiver.

#### Negative Paths

- Given an active rebase, a dirty checkout, missing or contradictory attempt evidence, or a revision whose feature content cannot be verified, when the daemon evaluates the feature, then the build stays halted and reports the specific condition.

### Done When

- [ ] Repeated evaluations of each blocked case consume zero build attempts, including an older halt with no attempt evidence.

## Story 2: Preserve operator and feature ownership

**Requirement:** FR-2, FR-4

#### Happy Path

- Given a verified feature parked by its operator, when the operator releases it, then ordinary scheduling can resume it without a separate halt clear.

#### Negative Paths

- Given a park already in effect or applied during verification, when recovery reaches admission, then the park survives and the feature receives zero dispatches.
- Given another blocker, a replacement halt with identical wording, a changed revision, or a different execution child, when the daemon attempts to use the earlier verification, then it declines that continuation and preserves current state.

### Done When

- [ ] With two halted features, recovering one leaves the other feature’s halt and dispatch count unchanged.

## Story 3: Continue once with valid gate evidence

**Requirement:** FR-5, FR-6

#### Happy Path

- Given a verified revision with one invalidated check and one still-valid check, when recovery completes, then the invalidated check runs against that revision and the completed check retains its result.

#### Negative Paths

- Given the daemon stops while recording the transition or after clearing the halt but before dispatch, when it restarts and evaluates the same attempt twice, then only one continuation takes effect.
- Given a required rerun fails, when the feature reaches its delivery gate, then delivery stays blocked by the failed check.

### Done When

- [ ] In both restart cases, the next required step executes once and previously completed work with valid evidence keeps its completion status.
