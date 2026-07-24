# Complexity: Provider-aware model and effort resolution (#902)

Tier: M

## Rationale

- **Several coupled runtime seams.** Provider-specific behavior must stay coherent
  across step defaults, effort support, retry escalation, unavailability fallback,
  and generated documentation.
- **Two built-in provider policies.** Codex needs valid native model IDs and effort
  values while the existing Claude behavior remains byte-for-byte compatible at
  the public boundary.
- **Failure-sensitive behavior.** Incorrect escalation or fallback policy can send
  an invalid model to a provider or silently change retry behavior.
- **Meaningful negative-path surface.** Stories must cover explicit overrides,
  unsupported efforts, unavailable models, ladder exhaustion, and unchanged Claude
  resolution.
- **Not Large.** The scope is internal to one package, adds no service, database,
  authentication, or public configuration schema, and deliberately excludes plugin
  policies and arbitrary providers.

Medium means architecture-diagram, lightweight architecture-review,
conflict-check, writing-system-tests, pipeline, and retro run. PRD and PRD audit
are skipped because this is a technical-track change.
