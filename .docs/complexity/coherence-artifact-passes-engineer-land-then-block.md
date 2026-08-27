# Complexity: coherence-artifact-passes-engineer-land-then-block

Tier: M

Rationale: Cross-module contract change — `parseCoherenceArtifact`'s result shape gains line-level
defect detail and acquires a second consumer (daemon dispatch), while the bespoke
`hasCoherenceTableDataRow` check is deleted. No new models, integrations, auth, or state machines,
but two engine seams (engineer land, daemon backlog discovery) must stay behaviorally aligned and
the fail-closed dispatch semantics for absent/empty/table-less artifacts must be preserved, so
Small's skipped review artifacts are not appropriate. Matches the intake issue's `size: M` label.
