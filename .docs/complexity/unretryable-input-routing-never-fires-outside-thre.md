# Complexity: unretryable-input routing beyond the verdict steps (#2418)

Tier: S

Rationale: two production files change — the pure classifier `classifyRetryDecision`
(`src/conductor/src/engine/artifacts.ts`) and the step-runner failure seam plus its post-loop
failure path in `src/conductor/src/engine/conductor.ts`. No models, external integrations, or auth.
It adjusts an existing retry loop's routing rather than adding a state machine. Expected stories: 2.
The scope decision is recorded by amending the existing APPROVED
`adr-2026-08-19-unretryable-step-runner-failures-route-by-kind` in place (D2, D3) rather than a new
ADR, so no architecture review is needed. The behavior is latent today: the only facet producer is
`build_review`, already in scope. Per tier rules: architecture-diagram, architecture-review,
conflict-check, and coherence-check are skipped.
