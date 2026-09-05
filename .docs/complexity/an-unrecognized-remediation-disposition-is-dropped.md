# Complexity: an-unrecognized-remediation-disposition-is-dropped

Tier: S

Rationale: one parser seam (`readRemediationPlan` in `src/conductor/src/engine/artifacts.ts`) gains a typed rejection list, `planRemediation` in `conductor.ts` emits one new `ConductorEvent` per rejection and renders one new halt message, and `event-sinks.ts` registers the event. No schema, CLI, hook, or ADR change; existing behavior for fully-recognized outputs is unchanged. Source: https://github.com/jstoup111/ai-conductor/issues/2187
