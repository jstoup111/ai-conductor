# Complexity: land-time-validation-that-every-plan-task-carries-

Tier: S

Rationale: One ~24-line pure function ported from a retained branch, one call site in
`land-spec.ts`, unit tests. No models, integrations, auth, or state machines; reuses existing
parsers (`parsePlanTaskDoneWhen`, `parsePlanTaskIds`) unchanged. Expected 2-3 stories.
