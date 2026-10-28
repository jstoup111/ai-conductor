# Complexity: Preserve self-host provider transcripts for failed, stalled, or zero-progress dispatches

Tier: M

## Rationale

- Touches several existing engine seams rather than one: self-host provider descriptors
  (transcript-glob declaration), the scratch-home release and dead-owner sweep
  (`provider-scratch.ts`, `provider-home.ts`, `sandbox-build-env.ts`, `provider-execution.ts`),
  the conductor's post-verdict path (retain/prune by outcome), the `ConductorEvent` union (one
  new capture event), and the `conduct` CLI (one new read-only `transcripts` subcommand).
- Every change extends an existing mechanism; no new subsystem, persistence store, or
  cross-repo contract. Consumer projects are unaffected.
- Ordering hazard worth an ADR: harvest must precede every scratch release, while the keep/prune
  decision follows the stall verdict — the two halves live in different lifetimes.
- Security-adjacent: scratch homes hold seeded credentials, so the harvest is allowlist-only.
- Expected ~5–7 stories.

Per tier rules: architecture-diagram, lightweight architecture-review, conflict-check, and
coherence-check are required; no PRD (technical track).
