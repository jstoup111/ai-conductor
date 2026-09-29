**Status:** Accepted

# Stories: Show autoresolve guard and suite gate progress (#2762)

Track: technical

Tier: S

Approved by the operator on 2026-09-28 (delegated). Scope is the passing acceptance-guard stage, the suite-gate start, and the suite-gate pass inside resolveConflictingPr, surfaced in the daemon log and as one new rebase_resolution_stage event on the existing event spine. Failure logging and escalation stay as they are today.

## Story 1: Each passing stage between the tier-2 outcome and the push leaves a trace

### Acceptance Criteria

#### Happy Path

- Given an autoresolve attempt whose rebased branch passes the acceptance guards, when resolveConflictingPr continues past the guards, then the daemon log records that the acceptance guards passed for that PR and a rebase_resolution_stage event with stage acceptance-guards, status passed, the PR URL, and the resolution worktree path is emitted before the suite gate starts.
- Given an autoresolve attempt that reaches the suite gate, when the suite gate starts, then the daemon log records the suite-gate start naming the PR and the resolution worktree, and a rebase_resolution_stage event with stage suite-gate, status started, the PR URL, and the worktree path is emitted before the suite runner is invoked.
- Given the suite runner reports exit code 0, when the suite gate settles, then the daemon log records the suite-gate pass for that PR with the runner's duration in milliseconds, and a rebase_resolution_stage event with stage suite-gate, status passed, the PR URL, the worktree path, and durationMs equal to the runner's reported duration is emitted before the lease push updates the remote branch.

#### Negative Paths

- Given the injected event emitter rejects every emit, when the attempt passes both stages, then all three stage log lines are still written, the resolution is still pushed, and the outcome is refreshed.
- Given no event emitter is injected, when the attempt passes both stages, then all three stage log lines are still written and the outcome is refreshed.

### Done When

- [ ] A real-git autoresolve integration test records the acceptance-guards passed, suite-gate started, and suite-gate passed events and log lines in that order, with the suite-gate started event present when the suite runner is invoked and the suite-gate passed event present while the remote branch still holds its pre-resolution tip.
- [ ] Integration tests with a rejecting emitter and with no emitter both end refreshed with all three stage log lines present.
- [ ] The ConductorEvent union and EVENT_SINKS declare rebase_resolution_stage as persisted and not rendered, audited, or exported to OTel.

## Story 2: Failure logging and escalation behave as today

### Acceptance Criteria

#### Happy Path

- Given the suite runner reports a nonzero exit code, when the suite gate settles, then the existing suite gate failed log line and the suite-gate escalation outcome line are written as today, no suite-gate passed log line or event is recorded, no push is attempted, and the outcome is escalated.

#### Negative Paths

- Given the acceptance guards reject the rebased branch, when the guard stage settles, then the existing acceptance guard failed log line and the acceptance-guards escalation outcome line are written as today, no acceptance-guards passed or suite-gate started log line or event is recorded, the suite runner is never invoked, and the outcome is escalated.

### Done When

- [ ] A red-suite integration test asserts the unchanged failure and escalation lines, the absence of any suite-gate passed line or event, the unchanged remote branch tip, and the escalated outcome.
- [ ] A guard-rejection integration test asserts the unchanged guard failure and escalation lines, zero suite runner calls, the absence of any acceptance-guards passed or suite-gate started line or event, and the escalated outcome.

## Negative-category review

Dependency failure is covered by the rejecting-emitter case: an observability failure must not change the resolution outcome. Absent configuration is covered by the no-emitter case. The two failing stages (guard rejection and red suite) cover the alternate branches where a pass signal must not appear and the existing escalation must be preserved. No input validation, authentication, permission, concurrency, idempotency, deletion, or storage behavior changes; those categories are inapplicable. A suite with no configured command already escalates through the existing nonzero path and gains no pass signal.
