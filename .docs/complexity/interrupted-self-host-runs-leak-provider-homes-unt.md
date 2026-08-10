# Complexity: Interrupted self-host runs leak provider homes until /tmp quota fails

Tier: M

## Rationale

Medium rather than Small:

- **Three independent call sites migrate to one new port.** `provider-home.ts`,
  `sandbox-build-env.ts`, and `token-liveness.ts` each resolve their own base
  directory from `os.tmpdir()` today; all three must move behind a single
  worktree-anchored scratch resolver without changing their existing teardown
  contracts.
- **New lifecycle state.** An owner lease (repo, slug, run, attempt, pid,
  startedAt) is written per scratch home and read by a sweeper that must
  distinguish a dead owner from a live one. Getting this wrong deletes a live
  provider home mid-attempt.
- **A new sweep runs at a daemon boundary**, alongside the existing
  reconciliation hooks, and must be best-effort in the same way they are — a
  throw can never disrupt the dispatch loop.
- **The telemetry spine is extended.** Cleanup decisions and failures become a
  `ConductorEvent` variant rather than a bespoke log line.
- **A one-time legacy sweep** collects the already-leaked `/tmp` prefixes.

Not Large:

- No new models, no external integrations, no auth surface, no state machine.
- No consumer-facing CLI, hook, settings schema, or skill-symlink change, so no
  migration block is required.
- The reap backstop is existing machinery reused unchanged, not new machinery.
