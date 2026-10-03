# Track: Daemon records that a build is not advancing HEAD but never acts on it

Track: technical

Scope boundary: Classify + end the attempt. Add a classified three-state build-progress condition on the existing event spine (provider quiet / active and committing / active and not committing). Add a per-project `build_progress` bound with a configurable action (`warn` by default, `end_attempt` opt-in) that ends the provider attempt through a dispatcher-owned abort when "active and not committing" persists. Renewed HEAD or task movement clears the condition. Excluded: a spend-since-last-commit (cost) bound, which depends on #2095; any new channel, log, or sidecar file.

Daemon/engine supervision behaviour plus a config key, with no end-user product surface, so acceptance criteria live in stories and there is no PRD.
