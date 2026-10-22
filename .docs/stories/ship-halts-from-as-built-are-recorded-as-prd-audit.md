**Status:** Accepted

# Stories: Validation-group halts are attributed to the member that raised them

Track: technical (no PRD). Tier: S.
Source: jstoup111/ai-conductor#3287

In daemon runs the SHIP validators (`manual_test`, `prd_audit`, `architecture_review_as_built`) run as one validation group entered from a single step. Today every terminal halt the group raises names that entry step (`prd_audit`) as its halting step, whichever member raised it. In these stories the "halting step" of a halt means the same value in three places: the `step` of its `loop_halt` event, the `Halting step:` line of its committed halt record under `.docs/halted/` (written for operator-actionable halt classes only), and the `step` of the halted `feature_dispatch_ended` event the daemon emits for that dispatch.

## Story 1: An as-built halt names the as-built review as its halting step

**Requirement:** #3287 outcome-1

As the operator, I want a halt raised by the as-built review to be counted under `architecture_review_as_built`, so that halt metrics show the as-built review as the SHIP halt source it actually is.

### Acceptance Criteria

#### Happy Path
- Given a daemon validation group whose as-built review returns a terminal verdict (a PLAN_GAP the plan cannot deliver, a DESIGN finding, or an invalid verdict) while `prd_audit` passes, when the group halts, then the `loop_halt` event's step is `architecture_review_as_built` and the committed halt record reads `Halting step: architecture_review_as_built`.
- Given a daemon validation group whose as-built review is BLOCKED with remediable findings and remediation returns a needs-human halt, hits the kickback no-op escalation, or cannot project the remediated findings into the verdict artifact, when the group halts, then the `loop_halt` event's step is `architecture_review_as_built`.
- Given the as-built halt is raised while `prd_audit` also reported blocking gaps in the same round, when the group halts on the as-built verdict, then the `loop_halt` event's step is still `architecture_review_as_built`.

#### Negative Paths
- Given an as-built halt whose class is `plan-gap`, when the halt is written, then the halt record's `Halting step:` line and the `loop_halt` step are both `architecture_review_as_built` and neither names the group's entry step.
- Given a halt raised outside a validation group (for example a BUILD step halt), when it is written, then its halting step is the step that was dispatching, exactly as before this change.

### Done When
- [ ] For each as-built halt path in the validation-group join, the emitted `loop_halt` step equals `architecture_review_as_built`.
- [ ] The committed halt record of a recordable as-built halt reads `Halting step: architecture_review_as_built`.

## Story 2: A halt that originates in prd_audit is still attributed to prd_audit

**Requirement:** #3287 outcome-4

As the operator, I want halts that the PRD audit genuinely raises to keep their `prd_audit` attribution, so that correcting the as-built count does not hide prd_audit's real share.

### Acceptance Criteria

#### Happy Path
- Given a daemon validation group whose `prd_audit` route resolves to a plan-gap halt, an over-scope halt, or a projection halt, when the group halts, then the `loop_halt` event's step is `prd_audit` and a recordable halt's record reads `Halting step: prd_audit`.
- Given a daemon validation group whose fully refused over-scope round cannot be reworked (the refusal-rework allowance is spent or the planner faults), when the group halts, then the `loop_halt` event's step is `prd_audit`.

#### Negative Paths
- Given the validation group was entered from a step other than `prd_audit` and the halt originates in `prd_audit`, when the group halts, then the halting step is `prd_audit` and not the entry step.
- Given a `prd_audit`-origin halt while the as-built review passed, when the group halts, then no event or record for that halt names `architecture_review_as_built` as its halting step.

### Done When
- [ ] Every `prd_audit` route halt in the validation-group join emits `loop_halt` with step `prd_audit`, independent of the entry step.
- [ ] The halt record of a recordable `prd_audit` route halt reads `Halting step: prd_audit`.

## Story 3: A member's own dispatch failure names that member

**Requirement:** #3287 outcome-1

As the operator, I want a halt caused by one member's own run failing to name that member, so that infrastructure failures of `manual_test` or the as-built review are not counted against `prd_audit`.

### Acceptance Criteria

#### Happy Path
- Given a validation-group member exhausts its retries without a verdict, when the group halts, then the `loop_halt` event's step is that member's step and a halt record reads `Halting step: <that member>`.
- Given a validation-group member's dispatch returns a mechanical fault, when the group halts, then the `loop_halt` event's step is that member's step.
- Given a validation-group member's provider denies a required permission, or its cached-login recovery trial fails, or the group parks on that member's authentication failure, when the group halts, then the `loop_halt` event's step is that member's step.
- Given a validation-group gap member's join-routed kickback to build made no progress and escalates to a halt, when the group halts, then the `loop_halt` event's step is that gap member's step.

#### Negative Paths
- Given a mechanical-fault halt, when it is written, then no halt record is committed (mechanical halts stay unrecorded) while the `loop_halt` step still names the faulting member.
- Given the faulting member is `manual_test`, when the group halts, then the halting step is `manual_test` and not `prd_audit`.

### Done When
- [ ] Every member-fault halt path in the validation group (no-verdict, mechanical fault, permission denial, authentication recovery, gap no-op escalation) emits `loop_halt` with the faulting member's step.
- [ ] A recordable member-fault halt's record names that member on its `Halting step:` line.

## Story 4: When several members fail together, each failing member is on the spine

**Requirement:** #3287 outcome-3

As the operator, I want a halt that ends several failing members to identify every one of them on the event spine, so that a multi-member halt is not reduced to a single name.

### Acceptance Criteria

#### Happy Path
- Given a validation group ends on its generic halt (no classified route remains) with `manual_test` and `prd_audit` both failing their gates, when the group halts, then the halting step is `manual_test` (the first failing member in group order) and the spine carries a member-scoped `step_refused` event for each of `manual_test` and `prd_audit`.
- Given `prd_audit` reports blocking gaps in a round the as-built review does not own, and the join's remediation planner returns a needs-human halt for those gaps, when the group halts, then the halting step is `prd_audit` (the first gap member in group order) and the spine carries a member-scoped `step_refused` event for every gap member the planner was given.
- Given `manual_test` FAIL rows are merged with gap members into one remediation work order and the planner returns a needs-human halt, when the group halts, then the halting step is the first non-`manual_test` gap member and the spine carries a member-scoped `step_refused` event for `manual_test` and for every gap member.
- Given the as-built review halts terminally while `manual_test` also failed its gate, when the group halts, then the halting step is `architecture_review_as_built` and the spine carries a member-scoped `step_refused` event for each of `architecture_review_as_built` and `manual_test`.

#### Negative Paths
- Given only one member fails, when the group halts, then exactly one member-scoped `step_refused` event names that member and no passing sibling is named.
- Given a passing sibling in a multi-member halt, when the halt is recorded, then that sibling is not marked refused and is not named as the halting step.

### Done When
- [ ] Each multi-member validation-group halt emits a member-scoped `step_refused` for every failing member, including the remediation-planner halts that emitted none before this change.
- [ ] The halting step of a multi-member halt is the member named by the rule above, never the group's entry step unless no failing member can be identified.

## Story 5: The daemon's dispatch-ended event carries the halting step under child isolation

**Requirement:** #3287 outcome-2

As the operator, I want the halted `feature_dispatch_ended` event to carry the same halting step and halt class as the halt, so that counting halts by step on the spine matches the halt records under the default child-executor isolation.

### Acceptance Criteria

#### Happy Path
- Given the daemon runs features in child executors and a feature halts in its validation group on the as-built review with class `plan-gap`, when the supervisor emits `feature_dispatch_ended`, then the event has outcome `halted`, step `architecture_review_as_built`, and haltClass `plan-gap`.
- Given the daemon runs features in-process and a feature halts in its validation group on the as-built review, when `feature_dispatch_ended` is emitted, then its step is `architecture_review_as_built`.
- Given a halted `feature_dispatch_ended` event carrying a step and haltClass, when the OTel metrics listener consumes it, then the feature-halt metric is recorded under that step and class.

#### Negative Paths
- Given a child executor running an older pinned engine whose terminal outcome carries no halting step or class, when the supervisor emits `feature_dispatch_ended`, then the event is still emitted with outcome `halted` and without step or haltClass, and the dispatch is not treated as an error.
- Given a child executor whose feature completes or terminates without halting, when the supervisor emits `feature_dispatch_ended`, then the event carries no step and no haltClass.
- Given the child exits before sending an outcome, when the supervisor records the dispatch, then `feature_dispatch_ended` is emitted once with outcome `terminated` and no step.

### Done When
- [ ] A halted child-executor dispatch emits `feature_dispatch_ended` whose step and haltClass equal the child's `loop_halt` step and the worktree's halt class.
- [ ] Non-halted and outcome-less child dispatches emit `feature_dispatch_ended` without step or haltClass, exactly once.
