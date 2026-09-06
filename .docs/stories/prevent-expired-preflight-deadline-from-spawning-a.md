**Status:** Accepted

# Stories: Bound the build_review counterfactual scoped run to its deadline (#2177)

Track: technical

Tier: S

Approved by the operator on 2026-09-06 (delegated). Scope is the counterfactual scoped-run launch guard and its termination path. The preflight timeout value, the materializer's own abort checkpoints, and every other engine spawn site remain outside this slice.

## Story 1: Refuse to launch a counterfactual whose deadline has already expired

As the build_review test-quality preflight, I want an expired deadline to prevent the counterfactual launch so that no unkillable test process is created after the timeout has already fired.

### Acceptance Criteria

#### Happy Path

- Given the preflight deadline has already expired when the counterfactual scoped run is requested, when the run is invoked, then no process is launched and the run reports a timeout outcome with empty captured output.
- Given the preflight deadline has not expired, when the counterfactual scoped run is invoked and the process exits, then exactly one process is launched and its exit status, standard output, and standard error are reported unchanged.
- Given a step runner holds a configured scoped-command template, when its counterfactual runner is invoked with an already-expired deadline, then the configured command is never launched and the outcome maps to the scoped-run timeout reason rather than the launch-failure reason.

#### Negative Paths

- Given no scoped-command template is configured, or the selector list is empty, when the counterfactual scoped run is invoked, then no process is launched and the run reports a launch-error outcome.

### Done When

- [ ] An already-expired deadline yields a timeout outcome and the injected launcher is never invoked.
- [ ] An unexpired deadline yields the launched process's exit status and captured output unchanged after exactly one launch.
- [ ] A step runner constructed with an injected launcher and a configured scoped command never invokes that launcher for an already-expired deadline, and its result maps to the scoped-run timeout reason.
- [ ] A missing template and an empty selector list each yield a launch-error outcome with no launch.

## Story 2: Terminate an aborted counterfactual before reporting its outcome

As the build_review test-quality preflight, I want a counterfactual that is already running when the deadline expires to be forcibly ended before its outcome is reported so that no test process survives the deadline or the disposable checkout's removal.

### Acceptance Criteria

#### Happy Path

- Given a counterfactual process is still running, when the preflight deadline expires, then the process is sent SIGTERM and the timeout outcome is reported only after that process's exit has been observed.

#### Negative Paths

- Given a counterfactual process has not exited after SIGTERM, when the bounded kill grace period elapses, then the process is sent SIGKILL and the run then reports a timeout outcome carrying the output captured so far.
- Given a counterfactual process exits within the kill grace period after SIGTERM, when the timeout outcome is reported, then no SIGKILL is sent and the pending escalation is cancelled.
- Given a counterfactual process already exited and its outcome was reported, when the deadline later expires, then no termination signal is sent and the reported exit outcome is not replaced.

### Done When

- [ ] A running process aborted at its deadline receives SIGTERM and the runner's promise remains unresolved until that process's exit is observed.
- [ ] A process that ignores SIGTERM receives SIGKILL after the bounded grace period and the runner then reports a timeout outcome carrying the captured output.
- [ ] A process that exits inside the grace period causes the escalation to be cancelled and no SIGKILL to be sent.
- [ ] A process whose outcome was already reported receives no signal when the deadline later expires and keeps its original outcome.

## Negative-category review

Timeouts and dependency unavailability are the subject of both stories and are covered by the expired-deadline, SIGTERM-ignored, and launch-error criteria. Invalid input is covered by the missing-template and empty-selector criteria, which are the only inputs this seam accepts. Concurrent access and partial failure are covered by the settle-once criterion, which fixes the outcome against a late abort racing an already-observed exit, and by the escalation-cancelled criterion, which prevents a signal being delivered to a reaped process identifier. Resource exhaustion is covered in substance by the SIGKILL escalation, which is what stops an abandoned test process from holding CPU, memory, and the disposable checkout after the deadline. Auth and permission failures, cascade deletion, model immutability, data integrity, and dedup keys are inapplicable: this seam launches one child process, reads its streams, and returns a value union; it performs no authorization, persists no record, and owns no queue, datastore, upload, or transaction.
