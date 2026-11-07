# Stories: Routed remediation skips re-run steps on stale child verdicts, then exits markerless

**Status:** Accepted

Source: intake jstoup111/ai-conductor#3455. Technical track, no PRD. Governing design:
`adr-2026-10-12-routed-whole-feature-repair` decisions 7 and 9 as amended by #3455, and
`.docs/decisions/architecture-review-2026-10-28-routed-remediation-skips-re-run-steps-on-stale-chi.md`.
Depends on #3445 for the bounded routing stall (`routing_rounds_stalled`, attempts 1 and 2
`mechanical`, then `needs-human`). A `mechanical` HALT is the retryable stop: the daemon re-kicks it
without an operator.

## Story 1: A routed host re-runs every region step its round re-pended

**Requirement:** #3455 desired outcome 1; adr-2026-10-12 decision 9 (amended by #3455)

As the operator of a stacked feature with routed repair on, I want every region step that a routed
round re-pends on its host child to actually run again, so that a verdict left over from an earlier
lap can never stand in for the repair's own validation.

### Acceptance Criteria

#### Happy Path
- Given a host child whose `children/<k>/gates/` holds satisfied `build`, `test_suite` and `build_review` verdicts written before audit round `r5` was admitted, when `r5` enters that host's region and the loop selects the next gate, then the selected step is `acceptance_specs` or `build`, and `test_suite` and `build_review` are not counted as satisfied.
- Given a `revalidate` round whose queued entry names `test_suite` and `build_review` for child 2, and child 2 holds satisfied verdicts for both from its original closure, when the round enters child 2's region, then both steps dispatch on child 2 before the round exits the host.
- Given an `operator` round entered at `test_suite` on a closed child holding satisfied `test_suite` and `build_review` verdicts from an earlier lap, when the round enters the host region, then `test_suite` dispatches and is followed by `build_review` on that child.
- Given a feature already wedged before this change, with host 1 `repairing` in round `r5`, region steps `pending` or `in_progress`, and unstamped satisfied verdicts on disk, when the operator clears the needs-human HALT its markerless exit left and the daemon re-dispatches it, then the pending region steps run on host 1 with no verdict file edited by hand, instead of the run ending with no step dispatched.

#### Negative Paths
- Given a host child whose earlier-lap `build_review` verdict reads `satisfied: false` with a kickback and whose round did not re-pend `build_review`, when the round's host region is selected, then `build_review` is still treated as unsatisfied and dispatches.
- Given a flat N=1 feature with no routing marker whose `.pipeline/gates/test_suite.json` reads satisfied and whose `test_suite` state is `pending`, when the loop selects the next gate, then `test_suite` is treated as satisfied exactly as before this change.
- Given a stacked feature with no routing marker whose active cursor child holds satisfied region verdicts, when the loop selects the next gate for that child, then those verdicts count exactly as before this change.

### Done When
- [ ] A test seeds satisfied pre-round verdicts for all four region steps on a routed host and observes the selector choose a region step, with `test_suite` and `build_review` unsatisfied.
- [ ] Equivalent tests cover the `revalidate` and `operator` round kinds.
- [ ] A test reproduces the #3455 r5 state (host `repairing`, unstamped satisfied verdicts) and observes a region step dispatch on re-dispatch.
- [ ] Tests prove flat N=1 and unrouted child verdict reads are unchanged.

## Story 2: A routed repair build is always followed by fresh validation on the host

**Requirement:** #3455 desired outcome 2; adr-2026-10-12 decision 9 (amended by #3455)

As the operator, I want a routed repair build to be followed by a fresh `test_suite` and
`build_review` run on the host child, so that unverified remediation code can never pass the gates.

### Acceptance Criteria

#### Happy Path
- Given an audit round whose host child held satisfied `test_suite` and `build_review` verdicts from an earlier lap, when the host's repair `build` completes, then `test_suite` dispatches next on that host, then `build_review`, and the daemon log shows a `test_suite` running line and a `build_review` running line for that host after the build line.
- Given a host whose repair build finished and whose fresh `test_suite` and `build_review` both pass, when the region completes, then each of the host's four region verdicts on disk records the executing round and the routed exit for that host runs.

#### Negative Paths
- Given a host whose repair build completes with the tree unchanged, when the region continues, then `test_suite` and `build_review` still dispatch on that host and are not skipped on an earlier-lap verdict.
- Given a host whose fresh `test_suite` fails after the repair build, when the loop selects the next gate, then the routed exit for that host does not run and the host stays in its region.

### Done When
- [ ] A test drives a routed host from repair `build` through `test_suite` and `build_review` with earlier-lap verdicts seeded, and records all three steps dispatched in order.
- [ ] A test asserts the region verdicts written in the round carry that round's id.
- [ ] A test with an unchanged-tree build asserts `test_suite` still dispatches.

## Story 3: Work finished within the current round is not redone after a resume

**Requirement:** #3455 desired outcome 4; adr-2026-10-12 decision 9 (amended by #3455)

As the operator, I want region steps that already completed in the current routed round to stay
satisfied across a crash, halt or re-dispatch, so that resuming a round never repeats finished work.

### Acceptance Criteria

#### Happy Path
- Given host 1 `repairing` in round `r5` whose `build` and `test_suite` completed in `r5` with verdicts written during `r5`, when the run is interrupted and the daemon re-dispatches the feature, then the resumed run dispatches `build_review` and does not dispatch `build` or `test_suite` again.
- Given a verdict for `test_suite` written during round `r5` whose step state was not saved before a crash, when the feature resumes in `r5`, then `test_suite` is treated as satisfied and is not re-run.
- Given host 1 `repairing` in round `r5`, when the feature resumes, then the host region is not restaged a second time and no `r5` verdict is replaced.

#### Negative Paths
- Given a satisfied verdict for host 1 written during round `r4`, when host 1 executes in round `r5`, then that verdict is not counted for `r5`.
- Given round `r5` closes and round `r6` later admits the same host 1, when `r6` enters the host region, then `r5` verdicts are not counted for `r6` and the re-pended steps dispatch again.

### Done When
- [ ] A resume test with in-round verdicts records no re-dispatch of completed steps.
- [ ] A test where a verdict was written before its state save shows that step is not re-run.
- [ ] A two-round test on the same host shows the earlier round's verdicts are ignored by the later round.

## Story 4: A parked routed exit always writes a named, bounded HALT

**Requirement:** #3455 desired outcome 3; adr-2026-10-12 decision 7 (amended by #3455)

As the operator, I want a run that cannot proceed because routed parking left nothing runnable to
stop with a HALT naming the round, the parking kind and the reason, and to retry itself before
asking me, so that the daemon never reports a markerless exit and I only step in when retries are
exhausted.

### Acceptance Criteria

#### Happy Path
- Given routed parking of kind `child` on host 1 of round `r5` with no runnable region gate, when the loop stops, then `.pipeline/HALT` is written whose first line names round `r5`, parking kind `child`, host 1 and the reason, `.pipeline/HALT.class` reads `mechanical`, a `loop_halt` event carries the same text, and one `routing_rounds_stalled` event is persisted with `attempt` 1.
- Given a non-empty revalidation queue, no repair marker and no runnable gate at or before `build_review`, when the loop stops, then the HALT first line names the queued child, parking kind `queue` and the reason, and the HALT class is `mechanical`.
- Given every whole-feature gate converged but completion is refused because a routed round is still open, when the run ends, then a HALT naming the open round and the reason is written with class `mechanical`, and no DONE marker is written.
- Given a mechanical parked HALT for round `r5`, when the daemon re-kicks the feature and the next stack preflight admits, resumes or exits the round, then the next dispatch runs a step or closes the round without operator action.
- Given a parked stop, when the daemon records the dispatch outcome, then the reason contains the HALT's first line and not "loop ended without DONE or HALT marker".

#### Negative Paths
- Given two identical parked stalls for round `r5` with no intervening routing progress event, when a third identical parked stall occurs, then the HALT class is `needs-human` and its first line still names round `r5`, the parking kind and the reason.
- Given a routing progress event (`routed_repair_phase` or `remediation_routed`) after the second parked stall, when the next parked stall occurs, then it records `attempt` 1 with class `mechanical`.
- Given a live `.pipeline/HALT` already present when a parked stall is recorded, when the loop stops, then the existing HALT file is left byte-identical.
- Given a flat N=1 feature whose gates all converge, when the loop ends, then DONE is written and no parked HALT or `routing_rounds_stalled` event is recorded.

### Done When
- [ ] A conductor test for each parking kind (`child`, `leaf-host`, `queue`) asserts the HALT first line, the `mechanical` class, the `loop_halt` text and one `routing_rounds_stalled` event.
- [ ] A test of the refused-completion exit asserts a named `mechanical` HALT and no DONE marker.
- [ ] A test of three identical parked stalls asserts the third is `needs-human`, and a progress event resets the attempt to 1.
- [ ] A test asserts a live HALT present at a parked stop is left byte-identical.
- [ ] A daemon dispatch test asserts the outcome reason carries the HALT text, not "loop ended without DONE or HALT marker".

## Story 5: A host region finished in the current round takes its routed exit on resume

**Requirement:** #3455 desired outcome 3; adr-2026-10-12 decision 13 (amended by #3455)

As the operator, I want a routed host whose region already finished in the current round to take its
routed exit when the feature resumes, so that an interruption between the host's `build_review` and
its exit never parks the feature or needs me.

### Acceptance Criteria

#### Happy Path
- Given host 1 `repairing` in round `r5` whose `acceptance_specs`, `build`, `test_suite` and `build_review` all completed with verdicts written during `r5`, and whose run was interrupted before the routed exit, when the daemon re-dispatches the feature, then host 1's routed exit runs, host 1 leaves `repairing`, and the round continues to its next routed step without a HALT.
- Given host 2 `repairing` in a `revalidate` round whose re-pended `test_suite` and `build_review` completed in that round while its `build` and `acceptance_specs` stayed `done`, and whose run was interrupted before the routed exit, when the daemon re-dispatches the feature, then host 2's routed exit runs without dispatching any region step.
- Given the interrupted state of host 1, when the resumed run takes host 1's exit, then the route record and repair marker it leaves are identical to those left by an uninterrupted in-loop exit from the same state.

#### Negative Paths
- Given host 1 `repairing` in round `r5` whose `build_review` verdict was written during `r4`, when the feature resumes, then host 1's routed exit does not run and `build_review` dispatches on host 1.
- Given an interrupted host whose routed exit is refused on resume, when the run stops, then the HALT left and its class are identical to those an in-loop exit refusal leaves from the same state, and no `routing_rounds_stalled` event is recorded for that refusal.

### Done When
- [ ] A resume test of an interrupted, fully completed host region records the routed exit and no step dispatch.
- [ ] A comparison test shows the resumed exit and the in-loop exit leave the same route record and marker.
- [ ] A resume test of an interrupted `revalidate` host records its routed exit with no region step dispatched.
- [ ] A refused resume exit leaves the same HALT and class as the in-loop refusal and records no `routing_rounds_stalled` event.
- [ ] A test with one earlier-round region verdict shows the exit is not taken and that step dispatches.
