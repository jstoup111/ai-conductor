# Complexity: no-op guard keys on delivered build-review cases (#3661)

Tier: S

Rationale: two production files change — the pure guard module `src/conductor/src/engine/build-outcome.ts`
(record shape, its validator, `sameNoOpCycle`, the refusal text) and its one consumer in
`src/conductor/src/engine/conductor.ts` (capture the case ids `durableBuildReviewRetryContext` delivers,
pass them to the guard and to each `recordBuildOutcome` site, spend a record on refusal). No models,
external integrations, auth, or new module; the persisted change is two optional fields on an existing
gitignored sidecar that already fails open on absence. Expected stories: 2. The decision is recorded by
amending D3 of the existing APPROVED `adr-2026-08-05-build-settle-outcome-stamp` in place, so no
architecture review is needed. Per tier rules: architecture-diagram, architecture-review, conflict-check,
and coherence-check are skipped.
