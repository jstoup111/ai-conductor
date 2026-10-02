# Complexity: PRD-audit typed verdict migration

Tier: L

Source: jstoup111/ai-conductor#2521

The operator approved the technical-track migration on 2026-09-30 after Tier L was proposed.

The change crosses input projection, provider dispatch, schema/reference validation, persistence,
completion predicates, validation-group and serial routing, remediation, durable widening decisions,
restart/replay and code-stamp preservation, and publication evidence. Migrating only the writer
would leave independent Markdown readers as competing authorities. These consumers must change
as one coherent delivery while preserving current decision and routing semantics.

The existing as-built migration supplies a working local pattern, so this is not a technology
spike. Full architecture review, accepted stories, conflict check, dependency-bearing plan, and
coherence mapping are required. No production directory deletion is intended.
