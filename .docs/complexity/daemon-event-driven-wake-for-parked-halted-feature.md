# Complexity: daemon event-driven wake for parked (HALTED) features

Tier: M

## Rationale

- **Breadth:** six files across `src/conductor/src/engine/` (daemon, daemon-deps, daemon-command, daemon-backlog) and `src/conductor/src/daemon-cli.ts`, plus `package.json`/tsup config — more than a Small single-seam change.
- **Stateful lifecycle:** a per-slug watcher must be registered on park, disposed on re-dispatch (before worktree teardown) and on daemon exit; a latched single-shot waker races the injected sleep. Race conditions are real but bounded (watch is never dispatch authority).
- **New runtime dependency:** `chokidar` (plus `fsevents` external marking in tsup) — dependency and build-pipeline impact.
- **New CLI surface:** `--no-watch` flag and `idle-poll` default change (5s → 60s) with docs/CHANGELOG obligations.
- **Not Large:** no external integrations, no auth, no data model or schema changes, no cross-service coordination; correctness is preserved by the existing poll path, so the failure blast radius is latency, not state.

## Daemon step-skipping implication

Tier M ⇒ architecture-diagram, lightweight architecture-review, and conflict-check are all REQUIRED and present in this spec set.
