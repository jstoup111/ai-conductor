# Complexity: Pi auth failures and rate limits surface as plain step failures

Tier: M

## Rationale

- The intake is labelled S, but its first outcome is not reachable from the Pi adapter alone. A
  Pi `authFailure` today would reach `parkOnAuthFailure` in `engine/conductor.ts` with no
  readiness record. Pi declares no `readiness` capability, so the park falls through to the
  Claude-only branches and polls `~/.claude/.credentials.json`. Parking Pi correctly needs a
  Pi-owned recovery branch in the engine and an identity record that both the serial and the
  concurrent-group auth paths already carry.
- Touches four production areas: the Pi adapter (`execution/pi-provider.ts`), the provider
  contract types (`execution/llm-provider.ts`, `types/provider.ts`), the provider catalog
  (`execution/provider-catalog.ts`), and the conductor auth park (`engine/conductor.ts`).
- Adds one declared catalog capability and widens one shared result type. It changes no CLI flag,
  hook, settings schema, or persisted format beyond one additive value of an existing telemetry
  field.
- About five stories. Not Large: one adapter, one park branch, no new service or dependency.

Per tier rules: architecture-diagram, lightweight architecture-review, conflict-check,
coherence-check, and plan-review run.
