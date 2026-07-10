# Complexity: Priority-banded intake claim (issue #461)

Tier: M

## Rationale

- Single subsystem (engineer intake claim path), but the change integrates an
  external label read (gh REST) into a concurrency-sensitive queue walk whose
  hold/release semantics must never drop an entry.
- Explicit failure-mode contract: fail-open to FIFO on label-reader outage,
  logged once — mirrors the daemon resolver's outage behavior (PR #460).
- Must compose with existing blocker-verdict deferral (#279 closed-issue
  liveness, dependency claims) without reordering guarantees breaking.
- Heavy reuse of existing machinery (`backlog-priority.ts`) — no new models,
  integrations, auth, or state machines; modest story count.

M ⇒ architecture-diagram + lightweight architecture-review + conflict-check run;
not Large (no cross-cutting redesign).
