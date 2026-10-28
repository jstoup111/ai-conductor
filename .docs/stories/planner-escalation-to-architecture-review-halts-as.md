**Status:** Accepted

# Stories: An as-built finding the planner escalates halts as an escalation, not a missing finding (#3320)

Track: technical

Tier: S

Approved by the operator on 2026-10-21 as a composer hotfix. Scope is the halt that the as-built remediation planner's exact-match check writes when the planner routes a REMEDIABLE finding, with no tasks, to a non-build step such as `architecture_review`, `plan`, or `acceptance_specs`. Extended by the operator on 2026-10-28 as a composer hotfix (#3471) to a finding whose tasks direct an edit of another feature's sealed artifact, which the engine sends to DECIDE whether or not it carries tasks. Routing escalations to their target step instead of halting is out of scope.

## Story 1: Report a planner escalation as an escalation

### Acceptance Criteria

#### Happy Path

- Given an as-built BLOCKED round whose planner routes a REMEDIABLE finding to `architecture_review` with no tasks, when the remediation round is planned, then it halts `needs-human` and the halt names that finding id, the target step, and the planner's rationale, and does not list the finding as `Missing`.
- Given an as-built BLOCKED round whose planner routes a REMEDIABLE finding to `architecture_review` with a task directing an edit of another feature's sealed artifact, such as an on-main ADR, when the remediation round is planned, then it halts `needs-human` and the halt names that finding id, the target step, and the planner's rationale, and does not list the finding as `Missing`.
- Given an as-built BLOCKED round whose planner gives a REMEDIABLE finding a `build` repair whose task directs an edit of another feature's sealed artifact, when the remediation round is planned, then it halts `needs-human` naming that finding as escalated to `plan` with the planner's rationale, does not list it as `Missing`, and appends no task to the plan.
- Given a round where every escalated finding is addressed and no finding is missing, duplicated, or unexpected, when the round halts, then the halt does not claim the planner findings fail to match the parsed REMEDIABLE findings.

#### Negative Paths

- Given a round where one REMEDIABLE finding is escalated to `plan` and a sibling finding has a `build` repair with tasks, when the round is planned, then it still halts naming the escalation and appends no task to the plan.
- Given a round where the planner omits, duplicates, or invents an as-built finding, when the round is planned, then it still fails closed without routing: the remediation plan contract rejects the answer, and any such finding that reaches the exact-match check is still reported as `Missing`, `Duplicate`, or `Unexpected` with a `needs-human` halt.
