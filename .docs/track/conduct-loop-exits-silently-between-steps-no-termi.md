# Track: Conduct loop exits silently between steps — enrich no-verdict diagnostics

Track: technical

Internal conductor-engine reliability/diagnostics fix (no user-facing product
behavior, no PRD). The daemon's no-verdict backstop (`conductor.ts` `finally`)
parks features with zero inspectable evidence; the fix captures WHY the loop
exited (breadcrumb + last event + derived last step), eliminates
`last step: unknown`, and converts an escaped async rejection in the
step-transition path into a normal HALT. Acceptance criteria live in stories.

Chosen approach: A — single-point breadcrumb + enriched catch/finally backstop
(matches the repo's "enforce the invariant in one place" principle already
present in that block). Rejected B (instrument ~50 return sites: fragile,
high-churn) and C (root-cause the transient first: blocks on a bug that
resumed fine on rekick — the issue scopes the deliverable to diagnosability
precisely because the trigger is transient).
