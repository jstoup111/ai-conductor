**Status:** Accepted

# Stories: The no-op guard tells new review work from a repeated cycle (#3661)

Technical track; no PRD. Acceptance criteria derive from issue #3661's desired outcomes and
`adr-2026-08-05-build-settle-outcome-stamp` D3 (as amended by #3661). "The guard" is the pre-dispatch
refusal that runs when BUILD re-enters under a pending kickback. "Delivered cases" are the case ids of
the build-review remediation work order a BUILD received in its prompt; a BUILD that received no work
order has an empty delivered set. "Same cycle" means the same gate, tree hash, verdict, and model/effort
rung as the prior `no-movement` record.

## Story 1: A kickback with review cases the no-op build never received reaches BUILD

As the daemon, I want a build_review kickback that carries newly admitted cases to dispatch BUILD even
when the previous build changed nothing, so that new review work is built instead of halting needs-human.

### Acceptance Criteria

#### Happy Path
- Given a prior `no-movement` record for gate `build_review` whose delivered cases are `c1`, when `build_review` kicks back to BUILD in the same cycle with a work order whose cases are `c2` and `c3`, then BUILD is dispatched once and no `.pipeline/HALT` is written before that dispatch.
- Given that dispatched BUILD settles, when `.pipeline/build-outcome.json` is read, then its latest record lists exactly `c2` and `c3` as its delivered cases.
- Given a prior `no-movement` record for gate `build_review` whose delivered cases are `c1` and `c2`, when `build_review` kicks back in the same cycle with a work order whose cases are `c1` and `c2`, then no BUILD provider call is made and `.pipeline/HALT` is written with class `needs-human` and a reason containing `build_review kickback-to-build refused`.

#### Negative Paths
- Given a prior `no-movement` record for gate `build_review` whose delivered cases are `c1` and `c2`, when `build_review` kicks back in the same cycle with a work order whose only case is `c1`, then no BUILD provider call is made and the run halts `needs-human`.
- Given a prior `no-movement` record for gate `build_review` that carries no delivered-case field (written before this change), when `build_review` kicks back in the same cycle with a work order whose case is `c1`, then BUILD is dispatched once and no `.pipeline/HALT` is written before that dispatch.
- Given a prior `no-movement` record for gate `wiring_check` that carries no delivered-case field, when `wiring_check` kicks back in the same cycle and no build-review work order exists, then no BUILD provider call is made and the run halts `needs-human`.
- Given a zero-work BUILD recorded as `no-movement` while a `build_review` kickback was pending, when the following `build_review` passes, then the run dispatches the step after `build_review` and writes no `.pipeline/HALT`.

### Done When
- [ ] A conductor test with a prior record delivered `c1` and a work order of `c2` and `c3` observes one BUILD provider call, no HALT, and a latest build-outcome record whose delivered cases are `c2` and `c3`.
- [ ] A conductor test with a prior record delivered `c1` and `c2` and a work order of `c1` and `c2` observes zero BUILD provider calls and a `needs-human` HALT containing `build_review kickback-to-build refused`.
- [ ] `sameNoOpCycle` unit tests return `false` for a new case, including against a prior record without a delivered-case field, and `true` for an equal case set, a subset case set, and two empty sets.
- [ ] A conductor test observes a zero-work BUILD followed by a passing `build_review` advance to the next step with no HALT file.

## Story 2: Clearing a refusal's HALT retries BUILD once

As the operator, I want clearing the HALT the guard wrote to be enough to retry BUILD, so that I never
have to hand-edit `.pipeline/build-outcome.json` to get past a refusal.

### Acceptance Criteria

#### Happy Path
- Given the guard refused a BUILD and wrote a `needs-human` HALT, when the operator removes `.pipeline/HALT` and `.pipeline/HALT.class` and the conductor re-enters BUILD in the same cycle with the same work order, then BUILD is dispatched exactly once and no HALT is written before that dispatch.
- Given the guard refuses a BUILD, when the HALT reason is read, then it contains `Clearing this HALT retries BUILD once.`

#### Negative Paths
- Given a cleared refusal whose retried BUILD again settles as `no-movement`, when `build_review` kicks back again in the same cycle with the same work order, then no BUILD provider call is made and a new `needs-human` HALT is written.
- Given `.pipeline/build-outcome.json` cannot be written when the guard refuses, when the refusal completes, then `.pipeline/HALT` is still written with class `needs-human` and no BUILD provider call is made.

### Done When
- [ ] A conductor test drives refusal, removal of both HALT files, and re-entry, and observes exactly one BUILD provider call after the clear and none before it.
- [ ] A conductor test drives refusal, clear, a no-movement retry, and a repeat kickback, and observes a second `needs-human` HALT with no further BUILD provider call.
- [ ] A test whose build-outcome write rejects observes the `needs-human` HALT written and zero BUILD provider calls.
- [ ] A `composeBuildOutcomeHaltReason` unit test asserts the reason contains `Clearing this HALT retries BUILD once.`
