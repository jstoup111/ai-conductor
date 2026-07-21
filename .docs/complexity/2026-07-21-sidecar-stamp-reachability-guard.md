# Complexity: sidecar-stamp-reachability-guard (#766)

Tier: S

## Rationale
Small. Signals assessed (same as conduct uses):
- **Models / integrations / auth / state machines:** none. No new data model, no
  external integration, no auth surface, no new state machine.
- **Blast radius:** a single branch in one function (`deriveCompletionInternal`,
  autoheal.ts:773-788). The fix reuses machinery that already exists a few lines
  above in the same function (`resolveThroughMap` + `git rev-parse --verify` +
  `merge-base --is-ancestor`) — no new subsystem.
- **Story count:** ~3 (reachable stamp → pin held; unreachable stamp → demote
  loudly; rebase-translated stamp → pin held / #535 no-regression).

Tier S → skip PRD (technical track anyway), architecture-diagram,
architecture-review, and conflict-check. Proceed explore → stories → plan.
