# Complexity: malformed-as-built-clause-forces-an-operator-decis

Tier: S

Rationale: one regex change in `resolveAsBuiltGoverningClause` (`src/conductor/src/engine/conductor.ts`) so a dotted decision cite collapses to its whole decision, matching the collapse `parseAdrDecisions` already applies to ADR headings; one test; one contract sentence in `skills/architecture-review/SKILL.md`. No new halt class, no schema or config change, no cross-module interaction. Operator confirmed S over the issue's pre-scope `size: M` label.
