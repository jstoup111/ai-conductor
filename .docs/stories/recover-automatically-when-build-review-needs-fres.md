**Status:** Accepted

# Build review recovers its test proof (#3586)

These scenarios apply to daemon runs with proof verification and retry routing enabled.

## Story 1: Check the active build before dispatching review

**Requirement:** FR-1, FR-2, FR-3, FR-5

As an operator, I want a run entering review to check the test results for the work it will review, so a recoverable gap is handled before review starts.

#### Happy Path

- Given missing or stale proof and an available attempt, when review is next in ordinary progression, on direct or routed entry, or after resume, then the suite runs in the active build context before review is dispatched. When the new proof is current, review proceeds to its verdict.
- Given current proof or proof successfully preserved under existing rules, when the run reaches review, then review proceeds with zero recovery reruns.

#### Negative Paths

- Given current proof for a sibling and stale proof for the active stacked child, when the daemon prepares review for the active child, then it obtains proof for that child before dispatching its review.

### Done When

- [ ] For a resumed child with stale proof, the observed order is the child’s suite execution, that child’s first review dispatch, then its review verdict.
- [ ] Direct, routed, and ordinary review entry apply the same proof requirement. Current and successfully preserved proof each permit review with zero additional suite executions.

## Story 2: Recover when proof changes after the early check

**Requirement:** FR-4, FR-5, FR-8

As an operator, I want review to recover if its test results become stale between the early check and review, so a late change does not strand the run.

#### Happy Path

- Given proof that passed the early check and an available attempt, when review discovers the proof has become stale, then the daemon reruns the suite for the same feature or child. Once the new proof is current, review resumes and reaches a verdict.

#### Negative Paths

- Given a recovery rerun initiated by either check, when the suite reports failing tests, then the run enters its existing test-failure route immediately without dispatching a review on those results or spending another attempt to repeat the failure.

### Done When

- [ ] A late change followed by a passing rerun yields one recovery suite execution and a verdict for the original review context.
- [ ] A failing recovery suite execution leads directly to the same repair outcome as an ordinary failing suite execution.

## Story 3: Bound recovery across children and restarts

**Requirement:** FR-6, FR-7

As an operator, I want one limit for the whole feature and an actionable halt when it is exhausted, so restarting a stuck run cannot repeatedly run the suite.

#### Happy Path

- Given an early recovery rerun in one child and a subsequent daemon restart, when another child discovers a late proof problem, then the feature can use its second recovery rerun. If that rerun produces current proof, review proceeds.
- Given ordinary suite executions and repeated inspections of one recovery rerun, when determining the remaining allowance, then only the actual recovery rerun counts, once.

#### Negative Paths

- Given two recovery reruns already spent for a feature, when either check determines another rerun is needed, then the daemon halts for operator intervention before starting a third. The halt identifies build_review, test_suite, and two attempts.

### Done When

- [ ] A run spanning a restart and two children permits exactly two recovery suite executions in total. A further stale-proof request yields a needs-human halt naming both steps and reporting two attempts.
- [ ] A current-proof check after the second rerun permits review without an exhaustion halt.
