# Intake origin: a-routed-fix-cannot-be-built-charged-and-reviewed-

Source-Ref: jstoup111/ai-conductor#3211
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#3211 digest=69ca7b1ff74d0f83dfbcb93182f1e1360a158cc652e0c92349ccaba604be23f9 >>>
## Desired outcome

- **Built on the host.** A placed fix is appended, built and reviewed on the host child's own branch, and the host's region re-runs.
- **Plan stays valid.** Routed remediation tasks carry their child in committed text, and the plan stays valid after every routed append.
- **Budgets stay feature-wide.** prd_audit and as-built laps and growth keep their per-feature meaning. A routing round settles exactly once, at the host's dispatch, including after a crash or a worktree recreation.
- **Verified reroute.** A builder's claim that a prerequisite lives in a later child moves the fix only when the engine verifies the claim. A test failure is never treated as "cannot host".
- **N=1 features** remediate exactly as today.
<<< END INBOUND >>>
