**Status:** Accepted

# Stories: One transient failure in a validation-group member discards its siblings

Source-Ref: jstoup111/ai-conductor#1425

Scope boundary (from the track marker, as amended after conflict-check): retain completed sibling verdicts across a no-verdict validation-group halt. The per-branch retry budget (the member's resolved `max_retries` instead of the literal `1`) is delivered by #2190 (`.docs/stories/a-halted-feature-only-re-runs-when-a-human-clears-.md` Story 1, PR #2206); #1425 is blocked by #2190 and these stories assume that budget is in place. The join policy is unchanged (a no-verdict branch still halts the group) and no new observability surface is added.

## Story 1: A genuine failure still halts the group loudly

As a daemon operator, I want a member that cannot produce a verdict after its full budget to halt the feature for a human, so that broken infrastructure is never retried forever or papered over.

### Acceptance Criteria

#### Happy Path
- Given a member throws on every attempt up to its resolved `max_retries`, when the join runs, then the loop writes a `needs-human` HALT whose reason names the failed member and its no-verdict reason, records the same `failed`/`last_step` stamping it records today, and emits `loop_halt` and `step_failed`.
- Given a member's runner is dead in this way, when its siblings are already in flight, then the siblings still run to their own outcomes before the join halts (no cancellation).

#### Negative Paths
- Given a member settles as `no-verdict`, when the join runs, then no `remediation.json` is synthesized and no `kickback` event is emitted for that round.
- Given a member settles as `no-verdict`, when the halt is written, then the halt class is `needs-human`, not `mechanical`, regardless of how many siblings passed.
- Given the operator has not cleared the HALT, when the daemon's next scan reaches the feature, then the feature is not re-dispatched.

### Done When
- [ ] The existing acceptance flow (a validator that throws before any completion marker still lets its siblings dispatch and synthesizes no remediation) stays green with the raised budget.
- [ ] A test observes, for an always-throwing member, the `needs-human` HALT class, the pre-existing `failed` stamping, and zero `kickback` events.

## Story 2: A no-verdict halt keeps the siblings that already passed

As a daemon operator, I want the passing members' completed work retained when one member halts the group, so that clearing the halt costs one member's work, not three.

### Acceptance Criteria

#### Happy Path
- Given `prd_audit` and `architecture_review_as_built` produced `verdict: pass` outcomes with satisfied objective gate verdicts and `manual_test` settled as `no-verdict`, when the join halts, then `conduct-state.json` records `prd_audit` and `architecture_review_as_built` as `done` (both their bare keys and their synthetic group-member keys) in the same commit that records the halt's `failed` stamping.
- Given the halt is written with retained siblings, when an operator inspects `conduct-state.json` after the halt, then the HALT marker, its `needs-human` class, and `last_step` are exactly what they were before this change.

#### Negative Paths
- Given a member's dispatch succeeded but the join's objective gate verdict for it is unsatisfied, when a sibling halts the group, then that member is NOT recorded `done`.
- Given `manual_test` dispatched successfully but its results file carries FAIL rows, when a sibling halts the group, then `manual_test` is NOT recorded `done`.
- Given a member's dispatch succeeded but its verdict-run-identity handshake failed, when a sibling halts the group, then that member is NOT recorded `done`.
- Given the member that produced `no-verdict`, when the halt commits, then that member's status is not `done` and its synthetic group-member key is not `done`.
- Given the state commit that would retain siblings throws, when the join halts, then the HALT marker is still written, `loop_halt` and `step_failed` are still emitted, and the failure to persist is logged loudly.
- Given a process crash between the halt marker write and the state commit, when the feature is next read, then the state is either the pre-halt state or the complete post-halt state (siblings `done` and the `failed` stamping together), never siblings `done` without the `failed` stamping.

### Done When
- [ ] A test with one always-throwing member and two passing members observes both passing members `done` and the `failed` stamping in `conduct-state.json` after the halt, written by a single state commit.
- [ ] Negative tests observe that a member with an unsatisfied gate verdict, `manual_test` with FAIL rows, and a member with a handshake failure are each left not-`done` when a sibling halts the group.
- [ ] A test with a state store that rejects the commit observes the HALT marker, `loop_halt`, and `step_failed` still produced.

## Story 3: Clearing the halt re-runs only the failed member

As a daemon operator, I want the re-dispatch after I clear a validation-group halt to dispatch only the member that failed, so that the expensive green validators are not repeated.

### Acceptance Criteria

#### Happy Path
- Given a halted feature whose state records two members `done` and one member not `done`, when the operator clears the HALT and the daemon re-dispatches, then the group round dispatches only the not-`done` member and, on its pass, joins all-green and continues the tail.
- Given the re-dispatched member throws once and passes on its next attempt within its resolved `max_retries` (the #2190 budget), when the join runs, then the round joins all-green with no halt.
- Given the re-dispatched member passes, when the join commits, then every member is `done` and the group step is `done`, indistinguishable from a round in which all three passed together.

#### Negative Paths
- Given a retained `done` member, when a kickback to `build` occurs before the re-dispatch, then that member is restaged to `stale` and is dispatched again in the next group round.
- Given a retained `done` member, when the feature is rebased and the post-rebase invalidation flags that member's gate surface, then the member is restaged and dispatched again.
- Given a retained `done` member whose on-disk verdict no longer satisfies its gate at FINISH, when the finish publication fence runs, then that member is reported non-green and publication does not proceed.
- Given the re-dispatched member fails again after its full budget, when the join halts, then the previously retained members stay `done` and the halt names only the member that failed.

### Done When
- [ ] A test seeds state with two `done` members and one pending member, runs the group round, and observes exactly one dispatch (the pending member) followed by an all-green join.
- [ ] A test observes that a kickback restage flips a retained member to `stale` and that the next round dispatches it.
- [ ] A test observes that the finish fence reports a retained member non-green when its gate verdict is unsatisfied.
