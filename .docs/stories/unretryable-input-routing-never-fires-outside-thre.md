**Status:** Accepted

# Stories: unretryable-input routing applies to every step except build (#2418)

Technical track; no PRD. Acceptance criteria derive from issue #2418's desired outcomes and
`adr-2026-08-19-unretryable-step-runner-failures-route-by-kind` (D2, D3, D4, D6 as amended
2026-10-09). "Daemon run" means a conductor constructed with `daemon: true` and `mode: 'auto'`;
"the facet" means a failing step-runner result carrying `unretryableInputs: { retryAfterStep }`.

## Story 1: A non-verdict step with unretryable inputs halts on its first attempt

As the operator of a daemon run, I want any step other than `build` whose runner declares its inputs
unretryable to stop on its first attempt and tell me which step must re-run, so that no retry budget
or remediation round is spent on a failure that cannot change.

### Acceptance Criteria

#### Happy Path
- Given a daemon run with retry routing enabled, when the `finish` step's runner fails with the facet naming `test_suite`, then `finish` is dispatched exactly once and exactly one `retry_decision` event is emitted for it with attempt 1, decision `route`, and signal `unretryable-inputs`.
- Given the same run, when the routed failure ends the run, then `.pipeline/HALT` names step `finish` and step `test_suite`, `.pipeline/HALT.class` is `needs-human`, the halt reason does not contain `retries exhausted`, and the step runner never receives a `remediate` dispatch.

#### Negative Paths
- Given a daemon run with retry routing enabled, when the `build` step's runner fails with the facet, then `build` is dispatched as many times as in the identical run whose runner omits the facet, and no `retry_decision` event with signal `unretryable-inputs` is emitted.
- Given a daemon run with `retry_routing.enabled: false`, when the `finish` step's runner fails with the facet on every attempt, then `finish` is dispatched once per allowed attempt (three with `maxRetries: 3`) and no `retry_decision` event is emitted.
- Given a daemon run with retry routing enabled, when an advisory step (`architecture_diagram`) fails with the facet, then it is dispatched exactly once, recorded as skipped, no `.pipeline/HALT` is written, and the run dispatches the next step.
- Given a daemon run with retry routing enabled, when the `finish` step's runner fails without the facet on every attempt, then `finish` is dispatched once per allowed attempt (three with `maxRetries: 3`) and no `retry_decision` event with signal `unretryable-inputs` is emitted.

### Done When
- [ ] A daemon conductor test with a `finish` runner returning the facet observes one `finish` dispatch, no `remediate` dispatch, one `route`/`unretryable-inputs` decision, and a `needs-human` HALT naming `finish` and `test_suite`.
- [ ] Daemon conductor tests observe the ordinary retry count for `build` with the facet, for `finish` with routing disabled, and for `finish` without the facet.
- [ ] A daemon conductor test observes an advisory step with the facet skipped after one dispatch with no HALT written.

## Story 2: The classifier's scope matches the recorded decision

As a maintainer reading the code or the ADR, I want the classifier to apply signal (c) to every step
except `build` while leaving the completion-gate-miss scope unchanged, so the code and the approved
decision state the same scope.

### Acceptance Criteria

#### Happy Path
- Given `classifyRetryDecision` called for a non-verdict step (`finish`) on attempt 1 with the facet, when it classifies, then it returns decision `route` with signal `unretryable-inputs`.
- Given `classifyRetryDecision` called for `build_review` on attempt 1 with the facet, when it classifies, then it still returns decision `route` with signal `unretryable-inputs`.

#### Negative Paths
- Given `classifyRetryDecision` called for `build` on attempt 1 with the facet, when it classifies, then it returns decision `rerun` with no signal.
- Given `classifyRetryDecision` called for a non-verdict step (`finish`) with a completion carrying `routeClass: 'named-route'` and no facet, when it classifies, then it returns decision `rerun` with no signal.

### Done When
- [ ] Classifier unit tests assert `route`/`unretryable-inputs` for `finish` and `build_review` with the facet.
- [ ] Classifier unit tests assert `rerun` for `build` with the facet and for `finish` with a named-route completion and no facet.
