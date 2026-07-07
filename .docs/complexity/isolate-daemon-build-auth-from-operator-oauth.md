# Complexity: Isolate daemon build auth from the operator's OAuth credential

Tier: M

## Rationale

- **Architectural seam, not a spot fix** — introduces a daemon-owned build
  credential behind a swappable auth seam (setup-token today, API key /
  platform identity later), replacing the copy-operator-credentials design in
  the sandbox safety core (adr-2026-06-30-sandbox-build-isolation).
- **Config surface grows** — daemon auth mode / token source becomes
  configurable; onboarding gains a one-time `claude setup-token` step.
- **Behavioral change in the conductor loop** — the auth-failure park branch
  (conductor.ts) and `refreshSandboxCredentials` re-copy path change meaning:
  park-and-poll (adr-2026-07-04) demotes to a fallback for the daemon's own
  token.
- **Needs a real-binary smoke** — the headless token-consumption mechanism
  must be proven against the actual `claude` CLI, not just unit-tested argv.
- **Not L** — no new external integrations, services, DB state, or state
  machines; one subsystem (`src/conductor/src/engine/self-host/` plus the
  conductor auth branch); moderate story count (~6).
