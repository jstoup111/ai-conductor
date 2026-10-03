# Complexity: Daemon records that a build is not advancing HEAD but never acts on it

Tier: M

## Rationale

- **State machine:** the build-progress watcher's quiet-episode state grows from a single
  fire-once warning to a three-state classification. It covers provider quiet, active and
  committing, and active and not committing. It also gets a bound, and renewed HEAD or task
  movement clears the condition.
- **Dispatch side effect:** with the opt-in `end_attempt` action, the watcher asks the build
  dispatcher, through an abort callback the dispatcher owns, to end the live provider attempt. The
  existing attempt-end stall classification and retry caps then govern what follows. Whether each
  provider's build dispatch honours that abort must be established during architecture review.
- **Configuration:** new keys in the existing `build_progress` block (a bound in minutes and an
  action of `warn` or `end_attempt`, default `warn`). They need validation and resolver defaults
  alongside `quiet_minutes`/`heartbeat_minutes`.
- **Observability:** the classification travels on the existing `ConductorEvent` spine
  (`build_progress` / `build_no_progress` fields plus the attempt-end record) and is rendered in the
  daemon log. No new channel.
- **Not Large:** one subsystem (the build-progress watcher and the build dispatch loop), no new
  durable state, no external effects, and no cross-provider protocol change beyond honouring an
  existing abort signal.
