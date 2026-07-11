# Complexity: daemon restart leaves the daemon STOPPED when origin is ahead (#353)

Tier: M

## Rationale

- **State machine involved:** the daemon restart lifecycle (running → stale-detected → respawn /
  exit-with-marker → revived) spans two marker files, the pidfile, and tmux session/pane state —
  changes must keep `daemon status` derivation (`daemon-observe-cli.ts`) coherent.
- **Multiple modules touched:** `daemon-tmux.ts` (setRemainOnExit fix + arming at start),
  `daemon-cli.ts` (RestartRequester rewiring), `restart-intent.ts`/`restart-marker.ts` (marker
  unification), `install-freshness.ts` (relink on restart handoff), `daemon-supervisor-cli.ts`.
- **Real-tmux integration tests required:** the missing end-to-end stale-engine-through-tmux test
  is part of the fix; smoke-level tmux assertions must distinguish respawn-while-alive from
  survive-own-exit (the gap that let the broken primitive pass).
- **Not Large:** no new services, external integrations, auth, or data model; no new standing
  components (watchdog approach was rejected); story count expected 4–6.
- **Not Small:** three coordinated defects across the lifecycle, an approved-ADR amendment
  (exit-to-respawn transport wiring), and cross-module invariants rule out a single-story patch.
