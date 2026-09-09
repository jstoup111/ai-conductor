# Hotfix: daemon-owned CI repair verification

Track: technical · Tier: S

## Scope

Operator-requested hotfix, 2026-09-09: CI repair test execution belongs to the daemon.
The observed repair of PR #2461 ran tests and pushed inside its provider session,
then the daemon skipped its own suite gate because no legacy command was configured.

Reuse the approved guard → suite → lease-push design in
`adr-2026-07-20-ci-fix-dispatch-via-steprunner`, using the existing configured verifier.
No new skill, configuration key, provider-specific mechanism, or telemetry channel.

## Task 1: Restore daemon ownership of repair verification and publication

Route `runCiFix` through the engine's configured test-suite dispatcher, reading the
repair worktree's `test_suite` configuration and preserving its evidence policy.
Remove the legacy command wiring from the daemon's CI repair dispatch. Direct the
repair agent to diagnose from CI logs and commit changes without running tests or
pushing. Update the CI repair documentation and boundary regression coverage.

Done when: verification observes the committed repair before publication; a failed
verifier or missing configuration leaves the remote branch unchanged; successful
verification permits the lease-protected push; both provider dispatch paths receive
the repair-session ownership instructions. The engine gate owns aggregate proof.

The session prompt expresses agent responsibilities; it does not sandbox arbitrary
shell commands. Existing tool permissions are outside this bounded hotfix.
