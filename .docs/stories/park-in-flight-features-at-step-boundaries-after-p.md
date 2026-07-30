**Status:** Accepted

# Stories: Boundary-aware operator parking

Source PRD: `.docs/specs/2026-07-29-boundary-aware-operator-parking.md` (FR-1..FR-10)

This story set supersedes only the mid-run happy-path scenario in
`.docs/stories/operator-park-a-human-placed-halt-must-survive-the.md`; the existing park and
unpark command, storage, dashboard, and re-kick stories remain in force.

## Story 1: A running serial step drains before the park takes effect

**Requirement:** FR-1

As an operator, I want a serial step already running when I park a feature to finish normally so
that parking cannot leave the feature half-settled.

### Acceptance Criteria

#### Happy Path

- Given a daemon-managed serial step is running, when the operator parks its feature, then that
  invocation is not cancelled and reaches the same natural terminal outcome it would have reached
  without the park.

#### Negative Paths

- Given a park appears while a serial step is running, when the daemon observes any in-step event,
  then it does not terminate the runner, synthesize a result, or start a replacement invocation.

### Done When

- [ ] A bounded orchestration test parks during one injected serial invocation and proves that
      invocation settles exactly once without cancellation or replacement.

## Story 2: A running parallel group joins before the park takes effect

**Requirement:** FR-2

As an operator, I want all already-started members of a parallel group to settle before parking
stops the feature so that the group's joined state remains coherent.

### Acceptance Criteria

#### Happy Path

- Given two or more group members are already running, when the feature is parked and one member
  finishes before its siblings, then every started sibling continues to its natural terminal
  outcome and the group completes its ordinary join.

#### Negative Paths

- Given one group member finishes or fails after the park appears, when other started members are
  still running, then the daemon neither cancels those members nor reports a boundary stop before
  the group join has settled them all.

### Done When

- [ ] A deterministic group fixture proves every started member settles, the join occurs once, and
      no boundary-stop observation precedes the last member's settlement.

## Story 3: Parking preserves natural terminal statuses

**Requirement:** FR-3

As an operator, I want the active unit's normal statuses persisted before progression stops so that
the lifecycle record remains authoritative.

### Acceptance Criteria

#### Happy Path

- Given an active serial step succeeds while parked, when progression stops, then its persisted
  status is the ordinary successful status and is no longer `in_progress`.
- Given a parked parallel group has successful, failed, and skipped member outcomes allowed by its
  normal join rules, when the group settles, then every member and the group carry exactly the
  statuses those rules produce before progression stops.

#### Negative Paths

- Given an active serial step produces a non-success terminal outcome, when parking takes effect,
  then the status is not rewritten to success, skipped, parked, or `in_progress`.
- Given one member's terminal-state persistence fails, when the group attempts to join, then the
  daemon follows the existing persistence/failure behavior and does not claim a clean boundary stop
  over incomplete state.

### Done When

- [ ] Persisted state assertions cover successful and non-success serial outcomes plus a mixed
      parallel join, with no settled unit or member left `in_progress`.

## Story 4: No later scheduling unit starts while parked

**Requirement:** FR-4

As an operator, I want the daemon to stop after the active scheduling unit settles so that later
autonomous work and cost do not begin.

### Acceptance Criteria

#### Happy Path

- Given a serial step settles and another serial step or parallel group is pending, when the park is
  active at that boundary, then the pending unit receives zero dispatches.
- Given a parallel group joins and another unit is pending, when the park is active at that
  boundary, then the pending unit receives zero dispatches.

#### Negative Paths

- Given completed or skipped lifecycle entries precede the next pending unit, when the daemon walks
  past those entries while parked, then it still blocks the first pending unit rather than treating
  traversal as permission to dispatch it.
- Given the parked run returns control to the daemon pool, when the same park remains active on
  later ticks, then no model, test, publication, or other lifecycle unit for the slug starts.

### Done When

- [ ] Serial-to-serial, serial-to-group, and group-to-later-unit fixtures assert zero runner calls
      for the pending unit while the marker remains active.

## Story 5: An intentional boundary stop is not a machine failure

**Requirement:** FR-5

As an operator, I want the daemon to distinguish my park from a failure while retaining real work
failures so that recovery signals remain truthful.

### Acceptance Criteria

#### Happy Path

- Given the active unit settles successfully and the feature stops for a park, when the daemon
  classifies the run, then it reports an intentional operator park and creates no new machine HALT,
  failure escalation, completion claim, or shipped/processed side effect.
- Given active work produces a genuine failure before the boundary, when the park is also active,
  then the genuine failure status and diagnostics remain authoritative.

#### Negative Paths

- Given the operator removes the park immediately after the boundary decision, when the run result
  reaches the daemon pool, then that already-decided stop is not reclassified from absent DONE/HALT
  evidence as an error.
- Given a genuine failure, kickback, or remediation outcome occurs in the active unit, when the
  daemon reports the feature, then parking does not erase, replace, or fabricate its diagnostics.

### Done When

- [ ] Outcome-classification tests distinguish parked, halted, error, and done results exhaustively
      and prove the parked result writes no HALT or completion side effects.

## Story 6: Unpark resumes from persisted lifecycle state

**Requirement:** FR-6

As an operator, I want unparked work to continue from its recorded lifecycle state so that parking
does not repeat settled work.

### Acceptance Criteria

#### Happy Path

- Given one serial step or parallel group settled before the park boundary, when the operator
  unparks and the daemon resumes the feature, then the settled unit is not dispatched solely because
  of the park and execution begins from the next state allowed by ordinary lifecycle rules.

#### Negative Paths

- Given the settled unit recorded failure, stale, skipped, kickback, or remediation state, when the
  operator unparks, then the daemon follows that state's existing recovery path rather than treating
  it as successful or blindly advancing.
- Given the daemon process restarts while the park remains active, when it later resumes after
  unpark, then the durable statuses—not prior process memory—select the resume point.

### Done When

- [ ] Resume fixtures prove successful work is not repeated and each non-success state remains
      governed by its existing selection/recovery rule across a simulated process restart.

## Story 7: Boundary races fail toward parked

**Requirement:** FR-7

As an operator, I want a late or unreadable park decision to prevent the next unit so that a race or
filesystem anomaly cannot burn another run.

### Acceptance Criteria

#### Happy Path

- Given one unit's status is already durable and the operator parks before the next pending unit
  dispatches, when the daemon evaluates that boundary, then it blocks the pending unit.
- Given the feature was selected but is parked before its first lifecycle unit begins, when the
  daemon reaches the first boundary, then it reports an intentional park and starts no unit.

#### Negative Paths

- Given the daemon cannot confirm park absence because the boundary read fails with a non-ENOENT
  error, when a unit is pending, then that unit does not start and the anomaly remains visible.
- Given the marker is absent when one unit starts but appears immediately afterward, when that unit
  is active, then it drains normally and the park is applied only at the next boundary.

### Done When

- [ ] Injected race and read-error fixtures prove zero dispatches beyond the relevant boundary and
      no false missing-marker HALT at the first boundary.

## Story 8: Every daemon parallel group obeys the same boundary contract

**Requirement:** FR-8

As an operator, I want parking to apply to parallel scheduling as a general rule so that adding a
new group cannot reopen the safety gap.

### Acceptance Criteria

#### Happy Path

- Given a configured parallel group, the SHIP validation group, or the deterministic BUILD
  verification group is active when parked, when it settles, then each follows the same drain,
  persist, join, and stop-before-next-unit contract.
- Given a future daemon group enters through the supported parallel scheduling path, when it settles
  under a park, then it receives the same boundary behavior without a park-specific exception for
  its members.

#### Negative Paths

- Given a group has zero or one applicable member after ordinary skip rules, when a park is active,
  then its existing membership semantics remain intact and the next pending unit is still blocked.
- Given a future group bypasses the shared daemon scheduling contract, when the regression inventory
  evaluates dispatch paths, then verification fails instead of silently accepting an unguarded path.

### Done When

- [ ] Bounded tests cover configured, SHIP, and deterministic BUILD groups, plus a mechanical
      inventory that rejects a newly introduced unguarded scheduling path.

## Story 9: Interactive conduct remains unchanged

**Requirement:** FR-9

As an interactive user, I want operator-park boundary behavior limited to daemon runs so that my
existing checkpoints and recovery controls do not change.

### Acceptance Criteria

#### Happy Path

- Given an interactive conduct run, when a repo-root park marker for the same slug exists, then the
  interactive run follows its existing step, checkpoint, and navigation behavior without a
  boundary-park stop.

#### Negative Paths

- Given daemon-only park behavior is not configured for a conductor caller, when it reaches a serial
  or parallel boundary, then absence of that behavior does not throw, change a result contract, or
  suppress the next ordinary interactive action.

### Done When

- [ ] An interactive baseline test produces the same dispatch and checkpoint sequence with and
      without a park marker.

## Story 10: Reporting identifies the settled boundary

**Requirement:** FR-10

As an operator, I want the daemon log to name the last settled scheduling unit when parking takes
effect so that I can verify where execution paused.

### Acceptance Criteria

#### Happy Path

- Given a serial step settles before the park takes effect, when the daemon reports the stop, then
  the feature-scoped record identifies an operator park and names that serial step.
- Given a parallel group joins before the park takes effect, when the daemon reports the stop, then
  the feature-scoped record identifies an operator park and names the group rather than presenting a
  single member as the boundary.

#### Negative Paths

- Given the feature is parked before its first scheduling unit, when the stop is reported, then the
  record explicitly identifies a pre-first-unit boundary instead of inventing a settled unit.
- Given a boundary park is reported, when event and report consumers process it, then it is not
  rendered as lifecycle completion, machine HALT, or generic error.

### Done When

- [ ] Provider-neutral event and rendering tests cover serial, group, and pre-first-unit reports
      with the feature slug and correct boundary identity.

**Status:** Accepted
