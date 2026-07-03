# Complexity: dependency-ordered-intake-and-dispatch

Tier: M

## Rationale

- **Breadth (pushes above S):** four coordinated touch points — dispatch gate in `discoverBacklog`, new WAITING dashboard/status group, intake `claim` deferral, one-time prose→link migration command — plus one new external API surface (GitHub native issue "blocked by" relationships via gh).
- **Bounded (keeps below L):** no new subsystem, no auth or schema changes, no new state machine. The dispatch gate mirrors the existing owner-gate skip pattern (daemon-backlog.ts gauntlet + warn-once); intake deferral is an ordering change to an existing queue; dependency state is resolved live from GitHub, so no persisted graph to manage.
- Estimated 6–9 stories; single-repo; no model/effort ladder implications.

Consequence: architecture-diagram + lightweight architecture-review + conflict-check are all required (non-Small).
