# Complexity: Daemon logs — surface kickback steps visibly

Tier: M

## Rationale

- **Not Small:** scope goes beyond restyling one renderer case. It adds engine `kickback`
  event emissions on two paths that currently emit nothing (DECIDE-phase amendment
  kickbacks before the first loopGate, and rendering the dropped `navigation_back`
  event), touching the conductor's routing/selector layer and the shared event types.
- **Not Large:** no new models, no external integrations, no auth, no new state machine —
  the step-status ledger and gate-verdict provenance already exist; this surfaces them.
- Expected story count: ~3–5 (prominent kickback line, DECIDE-phase emission,
  navigation_back rendering, ANSI-stripped file-log parity, ping-pong count display).
- Touched areas: src/conductor/src/daemon-cli.ts (renderer), src/engine/conductor.ts
  (emission sites), src/types/events.ts, byte-exact renderer tests + gate-loop
  integration tests.
