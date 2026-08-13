# Intake origin: rebase-invalidated-test-failures-never-reach-build

Source-Ref: jstoup111/ai-conductor#1535
Owner: jstoup111

## Desired outcome

- When a base advance invalidates work and the build repairs it, build_review can tell that repair apart from unplanned change — the repair is not flagged as out-of-scope or tautological on that ground.
- A test failure caused by a base advance is attributed to that advance, regardless of which gate observes the failure first.
- The grader's repair-context block reflects every recorded base-advance repair for the feature; when it is empty, that is because no base advance invalidated anything.
- A genuinely unplanned deletion is still flagged — a base advance does not become blanket permission to remove coverage.
- An operator can tell from the run's artifacts whether a given build_review finding was graded with or without repair context available.
