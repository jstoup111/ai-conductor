# Complexity: engine-gc-self-eviction-guard

Tier: S

## Rationale

- **One subsystem.** The change is localized to engine-version GC (`src/conductor/src/engine/engine-store.ts` `gcVersions`) plus the daemon startup ordering in `src/conductor/src/daemon-cli.ts` (publish+GC at ~:441 vs `holdLock` at ~:523).
- **No new models, integrations, auth, or state machines.** No schema, CLI, hook, or settings surface changes.
- **Small story count.** A self-guard assertion, a startup-ordering guarantee, and their negative paths.
- **Deterministic and testable in isolation** — GC retention logic is a pure-ish function over a version set plus the running process's own resolved dist; unit-testable without the live daemon.

Small tier ⇒ architecture-diagram, architecture-review, and conflict-check are skipped.
