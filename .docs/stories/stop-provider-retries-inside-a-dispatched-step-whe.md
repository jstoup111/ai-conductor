**Status:** Accepted

# Stories: Stop provider retries inside a dispatched step when a park lands (#2103)

Track: technical

Tier: S

Approved by the operator on 2026-09-06 (delegated). Scope is the retry-boundary park check inside an
already-dispatched step and the park command's in-flight report. Cancelling a provider call that has
already started, and the daemon's markerless-exit backstop, remain outside this slice.

## Story 1: A park landing mid-step stops the next provider attempt

As an operator stopping a wedged feature, I want a park that lands while a step is already
dispatched to prevent the next provider attempt, so that the feature stops consuming dispatches
without me having to stop the whole daemon.

### Acceptance Criteria

#### Happy Path

- Given a daemon-mode run whose current step has dispatched an attempt that fails, when the operator park boundary reports a park before the next attempt, then the run returns the operator-parked termination and the step runner is not dispatched again.
- Given that same run returns the operator-parked termination from inside the retry loop, when its persisted state is read afterwards, then the step it stopped inside is still recorded as in progress so a later dispatch resumes at that step.

#### Negative Paths

- Given a daemon-mode run whose operator park boundary read rejects at a retry boundary, when the retry loop reaches the next attempt, then it fails closed to the operator-parked termination and the step runner is not dispatched again.
- Given a daemon-mode run whose operator park boundary reports no park, when its first attempt fails, then the retry loop keeps dispatching the configured attempt budget and the run returns no operator-parked termination.

### Done When

- [ ] A failing step whose park boundary turns true after its first attempt dispatches the step runner exactly once and returns the operator-parked termination.
- [ ] The persisted step status after that termination is the in-progress status for the step the run stopped inside.
- [ ] A rejecting park boundary read at the retry boundary produces the same termination and the same single dispatch.
- [ ] With no park requested, the same failing step dispatches the step runner once per attempt in the configured retry budget.

## Story 2: The park command reports what is still running

As an operator who has just parked a feature, I want the command's own output to tell me whether a
provider attempt is still in flight, so that I know whether to wait or to stop the daemon instead of
discovering the running process by hand.

### Acceptance Criteria

#### Happy Path

- Given the parked feature's worktree shows provider activity inside the freshness window, when the park command runs, then its output names the step that is still running and states that the attempt already in flight is not cancelled.
- Given the parked feature has no worktree on disk, when the park command runs, then its output states that nothing is running for that slug.

#### Negative Paths

- Given the parked feature's worktree carries no activity record, or one older than the freshness window, when the park command runs, then its output states that no in-flight attempt was observed rather than that the feature stopped.
- Given the activity record exists but cannot be read or parsed, when the park command runs, then the park still succeeds with exit code 0 and the output states that in-flight status could not be determined.

### Done When

- [ ] Park output for a worktree with an activity record inside the freshness window names that record's step and says the running attempt is not cancelled.
- [ ] Park output for a slug with no worktree directory states that nothing is running for it.
- [ ] Park output for an absent or out-of-window activity record states that no in-flight attempt was observed.
- [ ] An unreadable or malformed activity record leaves the park exit code at 0 and produces the undetermined-status line.
- [ ] Re-parking an already-parked slug produces the same in-flight report as a first park.

## Negative-category review

Dependency unavailability and data integrity are covered by the unreadable and malformed activity
record criteria and by the rejecting park boundary read, which is the one external read either
surface depends on; both fail closed — the conductor toward parked, the CLI toward an explicit
undetermined statement rather than a false all-clear. Concurrent access is the subject of Story 1
itself: the marker is written by one process while another is mid-dispatch, and the criteria pin the
observable result of that race in both directions. Partial failure is covered by the persisted
in-progress status criterion, which keeps a mid-step park resumable rather than losing the step.
Invalid input, auth failures, resource exhaustion, cascade deletion, immutability, and idempotency
have no surface here: no new input is accepted, no record is deleted or mutated beyond the existing
marker write, and the re-park criterion pins the repeated-invocation case.
