# Hotfix: publish verified clean autoresolve rebases

Track: technical · Tier: S

## Scope

Operator-requested hotfix, 2026-09-09. PR #2461 reported `refreshed` at
`rebase-clean`, but the successful rebase returned before preservation checks,
verification, and publication. Reuse the approved autoresolve guard → suite →
lease-push path from the 2026-07-04 autoresolve architecture and the approved
post-rebase force-with-lease decision. No new configuration, skill, or telemetry
channel is required.

## Task 1: Share verification and publication after every successful rebase

Restrict Tier 1 and Tier 2 resolution to an actually conflicted rebase. A clean
rebase proceeds through the existing preservation checks, configured suite, and
lease-protected publication. Report `refreshed` only after publication succeeds.
Update the daemon guide and cover the real orchestrator with a local bare origin,
injecting only the suite, GitHub, and resolver boundaries.

Done when: a clean rebase verifies its resulting HEAD before changing the remote;
a passing suite publishes exactly that verified commit; a failing or unconfigured
suite leaves the remote unchanged; a concurrent remote update rejects publication
without overwriting the other writer; clean rebases never dispatch the resolver.
The configured native verifier owns aggregate evidence before the manual push.
