# Complexity: Authenticate contained Claude build_review reviewers

Tier: M

The change adds one engine-side Claude credential resolver with a fixed precedence, threads its
single short-lived value into the existing contained-reviewer environment overlay on both
build_review containment paths (custom policy members and their built-in peers), and adds a
fail-fast credential preflight ahead of the first review attempt. It touches a credential and
containment boundary, which warrants an architecture review, but introduces no new service,
persistent state, or multi-actor state machine. Two load-bearing assumptions (the env variable
accepting a stored-login access token; preflight refusals not consuming the fault allowance) are
carried as verification tasks. This matches the `size: M` disposition on the originating issue.
The plan stem must remain `authenticate-contained-claude-build-review-reviewe`.
