**Status:** Accepted

# Stories: Park stops retries inside an already-dispatched step

**PRD:** `.docs/specs/daemon-park-does-not-stop-retries-inside-an-alread.md`
**Source:** jstoup111/ai-conductor#2103

## Story 1: A parked serial step launches no further attempt

**Requirement:** FR-1

As a daemon operator, I want a park to stop the next provider attempt of a step that is already running, so that a wedged step stops consuming dispatches.

### Acceptance Criteria

#### Happy Path

- Given a daemon-run build step whose first provider attempt fails and whose retry budget allows another attempt, When the feature is parked before that attempt ends, Then no second provider attempt is dispatched and the conductor returns an operator-parked termination.
- Given a daemon-run build step on the ordinary (non-self-host) dispatch path with no park active, When its first attempt fails, Then the next attempt is dispatched exactly as today.

#### Negative Paths

- Given a daemon-run build step whose attempt fails, When the park-state read throws an error before the next attempt, Then no further attempt is dispatched and the conductor returns an operator-parked termination.
- Given a feature whose park was removed before the next attempt began, When the retry loop reaches that attempt, Then the attempt is dispatched and no operator-parked termination is returned.

### Done When

- [ ] A conductor test on the ordinary dispatch path records exactly one runner dispatch when a park lands during attempt 1 of a step allowed three attempts.
- [ ] The same test observes an `operator-parked` termination from the conductor run.
- [ ] A test with a throwing park predicate records no dispatch after the failed attempt.

## Story 2: Every retry path honors park

**Requirement:** FR-6

As a daemon operator, I want every kind of in-step retry to respect a park, so that no retry path is exempt.

### Acceptance Criteria

#### Happy Path

- Given a parked feature whose running attempt ended with a rate-limit wait, a stale session, an auth refresh, a finish-publication progress retry, a test_suite infrastructure retry, or a build_review mechanical-fault retry, When the conductor would re-enter the attempt loop for that free retry, Then no provider attempt is dispatched and the run returns an operator-parked termination.
- Given a self-host daemon build whose attempt fails while the feature is parked, When the next attempt reaches self-host dispatch admission, Then it is cancelled before dispatch exactly as it is today.

#### Negative Paths

- Given a parked feature whose running attempt produced a completion-check miss that would normally count as a budgeted retry, When the loop continues, Then no provider attempt is dispatched even though retry budget remains.
- Given a parked feature whose running attempt ended in a free retry that does not consume budget, When the loop re-enters, Then the park is still consulted before dispatch and the free retry does not bypass it.

### Done When

- [ ] One conductor test per enumerated free-retry path asserts zero runner dispatches after the park.
- [ ] The existing self-host admission park test still observes a parked self-host attempt cancelled before dispatch.

## Story 3: The running attempt is never interrupted

**Requirement:** FR-2

As a daemon operator, I want the attempt that is already running when I park to finish on its own terms, so that parking never leaves half-written work.

### Acceptance Criteria

#### Happy Path

- Given a provider attempt that is running when the feature is parked, When the attempt later completes successfully, Then its result is recorded normally and the step reaches its natural terminal status before the feature stops.

#### Negative Paths

- Given a provider attempt that is running when the feature is parked, When the park lands, Then the attempt receives no abort, cancellation, or kill and its runner call returns only when the provider finishes.
- Given a running attempt that fails after the park lands, When it returns, Then its failure output is recorded as the attempt's result and the park stops only the next attempt.

### Done When

- [ ] A test with a runner that resolves after the park is written observes the runner's result persisted and no abort signal delivered to the runner.

## Story 4: A declined attempt costs nothing

**Requirement:** FR-3

As a daemon operator, I want a park-declined attempt to be recorded as an intentional park rather than a failure, so that parking never makes a feature look broken or burns its budgets.

### Acceptance Criteria

#### Happy Path

- Given a step whose next attempt is declined for a park, When the conductor returns, Then the termination is operator-parked and no step_failed, step_retry, or retry-exhaustion event is emitted for the declined attempt.

#### Negative Paths

- Given a step whose next attempt is declined for a park, When the conductor returns, Then no HALT marker file is written to the feature worktree.
- Given a build step whose declined attempt would have been its third, When the conductor returns, Then no escalation-ladder model or effort rung is recorded for that attempt and the no-evidence attempt count is unchanged from before the park.
- Given a step whose next attempt is declined for a park, When the persisted conduct state is read, Then the step's status is in_progress, not failed.

### Done When

- [ ] A conductor test asserts that the event stream ends with an operator-park boundary event and contains no step_failed or step_retry event after it.
- [ ] The same test asserts that the worktree has no HALT file and conduct state shows the step in_progress.
- [ ] A build-step test asserts that the persisted no-evidence attempt count is identical before and after the declined attempt.

## Story 5: Unpark resumes the parked step

**Requirement:** FR-4

As a daemon operator, I want an unparked feature to pick up the parked step where it stopped, so that finished work is not redone.

### Acceptance Criteria

#### Happy Path

- Given a feature stopped by a declined attempt with its step left in_progress, When the park is removed and the daemon resumes the feature, Then the conductor resumes at that same step and dispatches its first attempt with a fresh attempt budget.
- Given a feature parked mid-build after some plan tasks were committed complete, When it resumes, Then those tasks remain complete and are not dispatched again.

#### Negative Paths

- Given a feature stopped by a declined attempt, When it resumes while still parked, Then the pre-unit gate stops it before any attempt and the step remains in_progress.

### Done When

- [ ] A resume test observes the resume index landing on the parked step and the first dispatched attempt numbered 1.
- [ ] A resume test observes previously completed task statuses unchanged after resume.

## Story 6: Park races fail safely

**Requirement:** FR-5

As a daemon operator, I want a park that lands between two attempts to be honored, and an unreadable park state to count as parked, so that no attempt slips through a race.

### Acceptance Criteria

#### Happy Path

- Given an attempt that has returned and a park written before the next attempt's dispatch check, When the check runs, Then it observes the park and no attempt is dispatched.

#### Negative Paths

- Given a park-state read that rejects with an error at the attempt check, When the check completes, Then it treats the feature as parked and no attempt is dispatched.
- Given a park written after the attempt check passed and while that attempt's dispatch is starting, When the attempt runs, Then it runs to completion (per Story 3) and the following attempt is declined.

### Done When

- [ ] A test with a rejecting park predicate records zero dispatches at the attempt check.
- [ ] A test that writes the park between attempts N and N+1 records exactly N dispatches.

## Story 7: A parked parallel-group member settles as parked

**Requirement:** FR-7

As a daemon operator, I want parallel-group members to stop retrying after a park without failing the group, so that the feature stops cleanly and resumable.

### Acceptance Criteria

#### Happy Path

- Given a daemon-run parallel group whose member's first attempt fails while the feature is parked, When that member would retry, Then it dispatches no further attempt and settles with a parked outcome.
- Given a parallel group whose members are passing, parked, or still running when the park lands, When every started member settles, Then the group join returns an operator-parked termination rather than a pass or a failure.

#### Negative Paths

- Given a parallel group with one parked member and one failed member, When the group joins, Then the failed member's genuine failure and diagnostics are reported and are not overwritten by the park.
- Given a parallel group with one parked member, When the group joins, Then no parallel_failure event is emitted for the parked member.
- Given a parked member, When its outcome is classified, Then it is classified as parked and never as no-verdict or aborted.

### Done When

- [ ] A group-core test observes a member returning a parked outcome after one dispatch when the park predicate turns true between attempts.
- [ ] A join test with pass, parked, and running members observes an operator-parked result and zero parallel_failure events for the parked member.
- [ ] A join test with a parked and a failed member observes the failed member's parallel_failure event with its original error.

## Story 8: Parking one feature leaves others running

**Requirement:** FR-8

As a daemon operator, I want parking one in-flight feature to leave the rest of the daemon untouched, so that stopping one wedged feature does not stop unrelated work.

### Acceptance Criteria

#### Happy Path

- Given a daemon pool running feature A and feature B, When A is parked and its next attempt is declined, Then B's attempts continue to dispatch and B can finish.

#### Negative Paths

- Given a daemon pool with feature A parked mid-step and feature C queued, When A returns its operator-parked termination, Then C is dispatched into the freed slot and the daemon process keeps running.

### Done When

- [ ] A daemon pool test observes feature B's dispatch count increasing after feature A's operator-parked termination.
- [ ] The same pool test observes a queued feature dispatched after A stops, with no daemon shutdown event.

## Story 9: The park command reports running work

**Requirement:** FR-9

As a daemon operator, I want the park command to tell me whether a provider attempt is still running for the feature, so that I know whether the park has fully taken effect.

### Acceptance Criteria

#### Happy Path

- Given a live daemon and a feature whose latest persisted provider attempt for its current step is running, When the operator parks the feature, Then the output states that an attempt is still running and names the step and attempt.
- Given a live daemon and a feature whose latest persisted provider attempt is preparing, When the operator parks the feature, Then the output states that an attempt is still running.

#### Negative Paths

- Given a feature already parked, When the operator parks it again, Then the output still carries the running-work report alongside the existing already-parked notice.

### Done When

- [ ] A park CLI test with persisted running-phase provider events and a live daemon asserts that the output contains the running report naming the step.
- [ ] A park CLI test for an already-parked feature asserts that the output contains both the already-parked notice and the running-work report.

## Story 10: The park command reports a fully stopped feature

**Requirement:** FR-11

As a daemon operator, I want the park command to say plainly when nothing is running, so that I know I can proceed with git-state work.

### Acceptance Criteria

#### Happy Path

- Given a feature whose latest persisted provider attempt has settled, When the operator parks it, Then the output states that the feature is fully stopped.
- Given no running daemon for the repository, When the operator parks a feature, Then the output states that the feature is fully stopped.

#### Negative Paths

- Given a feature with no worktree and no persisted events, When the operator parks it, Then the output states that the feature is fully stopped and the park is still written.

### Done When

- [ ] A park CLI test with a settled provider event asserts the fully-stopped report.
- [ ] A park CLI test with no live daemon pidfile asserts the fully-stopped report.

## Story 11: Unknown state is reported as unknown

**Requirement:** FR-10

As a daemon operator, I want the park command to admit when it cannot tell whether work is running, so that I am never told a feature stopped when it may not have.

### Acceptance Criteria

#### Happy Path

- Given a live daemon and a feature whose events file exists but cannot be read, When the operator parks it, Then the output states that running work is unknown and the park is still written.

#### Negative Paths

- Given a feature whose events file contains only malformed provider-attempt lines, When the operator parks it, Then the output states that running work is unknown and does not state that the feature is stopped.
- Given a daemon pidfile whose liveness cannot be determined, When the operator parks a feature, Then the output states that running work is unknown.
- Given any unknown report, When the park command exits, Then it exits successfully because the park itself was written.

### Done When

- [ ] A park CLI test with an unreadable events file asserts the unknown report and a written park marker.
- [ ] A park CLI test with malformed provider lines asserts that the output never contains the fully-stopped text.
- [ ] Both tests assert exit status 0.

## Story 12: The declined attempt is visible in daemon reporting

**Requirement:** FR-12

As a daemon operator, I want the daemon log to show that an attempt was declined for my park, so that I can see where the feature stopped.

### Acceptance Criteria

#### Happy Path

- Given a serial step whose next attempt is declined for a park, When the operator-park boundary event is emitted, Then it identifies the feature, the step, and an attempt-level boundary, and the daemon log renders a line naming them.
- Given a parallel-group member whose retry is declined, When the boundary event is emitted, Then it names the group step and the member.

#### Negative Paths

- Given a park observed at a scheduling-unit boundary with no attempt declined, When the boundary event is emitted, Then it keeps the existing unit-level shape and rendering unchanged.
- Given a declined attempt, When the event is persisted, Then exactly one operator-park boundary event is recorded for that stop, not one per retry path.

### Done When

- [ ] An events test asserts that the attempt-boundary variant is persisted to events.jsonl with the feature slug and step.
- [ ] A daemon-log render test asserts the rendered line for an attempt boundary and for a member boundary.
- [ ] The existing unit-boundary render test passes unchanged.

## Story 13: Interactive runs are unchanged

**Requirement:** FR-14

As an interactive conduct user, I want no new park behavior in my runs, so that parking stays a daemon-only control.

### Acceptance Criteria

#### Happy Path

- Given an interactive conduct run with no daemon park predicate, When a step retries, Then every retry is dispatched exactly as before.

#### Negative Paths

- Given an interactive conduct run and a park marker present on disk for its slug, When a step retries, Then the marker is not consulted and the retry is dispatched.

### Done When

- [ ] A conductor test constructed without a park predicate records every retry dispatch even with a park marker on disk.
