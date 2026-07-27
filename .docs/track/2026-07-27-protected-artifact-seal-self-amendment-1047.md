# Track: protected-artifact-seal-self-amendment-1047

Track: technical

## Rationale

This change adjusts an internal engine gate (`protected-artifact-seal.ts`), the engine's
handling of its verdict in `conductor.ts`, and the `build_review` grader prompt. There is no
user-facing product surface: no new command, flag, config key, or end-user-perceived
behavior. The observable acceptance signals are all harness-internal (a seal verdict shape, a
log line, a grader rubric rule) and belong in stories, not a PRD. → **technical track**
(skip `/prd`).
