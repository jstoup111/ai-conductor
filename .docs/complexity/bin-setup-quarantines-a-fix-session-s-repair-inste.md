# Complexity: Setup fix-session repairs must converge (#1346)

Tier: M

## Rationale

- The change spans the setup-triage state transition, exact repair-change capture, forced setup
  verification, engine-owned git commit behavior, quarantine/HALT fallback, and event-spine
  telemetry.
- The safety contract needs adversarial coverage for clean-start provenance, setup-added or
  setup-altered drift, commit failure, preservation failure, provider failure, and the successful
  convergent path.
- It changes one existing bounded recovery state machine and several coupled engine seams, making
  the architecture and conflict gates load-bearing.
- It adds no external integration, authentication boundary, persistence schema, or new subsystem,
  so Large-tier ceremony is not warranted.

Medium requires an architecture diagram, lightweight architecture review, conflict check, and
coherence check.
