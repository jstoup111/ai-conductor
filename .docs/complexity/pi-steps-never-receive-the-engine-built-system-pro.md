# Complexity: Pi steps never receive the engine-built system prompt

Tier: M

## Rationale

- Touches four production areas across `execution/` and `engine/`: the Pi adapter
  (`pi-provider.ts`), the provider capability registry (`provider-catalog.ts`), plugin provider
  capability declarations (`plugin-manifest`/`plugin-registry`), and the guard that refuses an
  undeclared provider.
- Adds a declared provider capability, which is a contract surface for built-in and plugin
  providers, and makes undeclared providers fail closed on the dispatch path.
- The guard's placement is a real design decision: about ten engine call sites invoke a provider
  directly (`step-runners.ts`, `provider-execution.ts`, `project-prelude.ts`,
  `model-availability.ts`, `attribution-lane.ts`), so no single existing seam is proven to cover
  every dispatch. Architecture review settles where it lives.
- No schema, migration, persisted format, new service, or dependency. About 4-5 stories.
- Not Large: one capability, one adapter, one guard; the change stays inside the existing
  provider registry pattern.

Per tier rules: architecture-diagram, lightweight architecture-review, conflict-check,
coherence-check, and plan-review run.
