# Complexity: autoheal-path-corroboration-rejects-valid-build-co (#707)

Tier: M

## Rationale
- **Code footprint is small** (a bounded dirname branch in `fileMatchesPlanPath` /
  `filesOverlappingTaskPaths`), but the tier is set by RISK, not line count.
- **High blast radius:** this matcher decides when EVERY build task is credited complete;
  a too-broad match causes false-positive completion across all features.
- **Direct conflict surface (needs conflict-check, an M/L step):** #445 ("same as Task N"
  inheritance) is reopened by an unbounded dirname/ancestor match — conflict-check must
  confirm the bound holds. Adjacent: #570/#700 (judge dispatch, done), #531, #672.
- **Not S:** Small would skip conflict-check and architecture-review, which is exactly wrong
  given the #445 overlap and completion-derivation criticality.
- **Not L:** single subsystem, no new models/auth/integration/migration; judge fallback
  untouched (already built).

Stem matches `.docs/plans/autoheal-path-corroboration-rejects-valid-build-co.md`.
