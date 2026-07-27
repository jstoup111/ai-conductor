# Complexity: Full-Suite Verification Gate (#940)

Tier: M

Rationale: The feature adds no external integrations, authorization surface, or
application data model, but it changes the conductor gate sequence, BUILD kickback,
freshness invalidation, finish fallback, direct-Claude parity, and multiple workflow
contracts. The expected story count is within the Medium range, and the cross-flow
state behavior warrants architecture, conflict, coherence, and acceptance-spec gates.
