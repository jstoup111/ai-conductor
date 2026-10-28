# Complexity: Running provider is invisible per step, and absent for parallel members

Tier: M

## Rationale

- Adds one `ConductorEvent` variant (`provider_attempt_started`) to the existing event spine, with
  its event-sink matrix and persister handling — a schema extension, not a new subsystem.
- One emission site at per-candidate provider dispatch in `engine/step-runners.ts`, which must carry
  `executionContext` so concurrent parallel-group members (validation, build_verification, and
  config-declared `steps.<name>.parallel` branches) are attributable.
- Two live renderers change: the daemon log (`daemon-cli.ts`) and the interactive terminal renderer
  (`ui/terminal-renderer.ts`), including fallback and "provider unknown" rendering.
- Crosses types, engine, and UI layers with concurrency (parallel members) in play, so it exceeds
  Small; no new state machine, external integration, or migration, so it is below Large.

Per tier rules: architecture-diagram, lightweight architecture-review, conflict-check,
coherence-check, and plan-review apply.
