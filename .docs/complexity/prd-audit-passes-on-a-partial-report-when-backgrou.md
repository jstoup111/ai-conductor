# Complexity: prd_audit FR-coverage gate

Tier: S

## Rationale

- Single deterministic change inside one module's completion logic
  (`src/conductor/src/engine/artifacts.ts`), plus lifting one existing pure helper
  (`extractPrdFrIds`, currently private in `engineer/coherence-validator.ts`) into a shared
  module so both callers use one parser.
- Reuses existing machinery rather than adding any: the feature-scoped artifact resolution
  ladder (`resolveFeatureStoriesPath` / `buildArtifactResolutionContext`) already resolves a
  feature's own artifacts and already refuses to fall back to the whole corpus.
- No new models, integrations, auth, state machines, config keys, CLI flags, or provider
  behavior. No LLM involvement — the denominator and the coverage comparison are both
  mechanical.
- No new observability channel: the coverage failure surfaces through the existing
  `CompletionResult.reason`, which the existing `gate_verdict` event and HALT reason already
  carry. Nothing is added to the `ConductorEvent` union (event-spine §2 — the bus already
  carries this concern; no channel is being added).
- Three call sites, one shared predicate; ~3 stories.

Per tier rules, architecture-diagram, architecture-review, conflict-check, and coherence-check
are skipped.
