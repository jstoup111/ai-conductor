# Complexity: CI test-suite workflow

Tier: S

## Rationale

Signals (same as conduct uses):

- **Models / data:** none.
- **Integrations:** one — GitHub Actions (a single new `.github/workflows/*.yml`).
- **Auth:** none beyond the default `GITHUB_TOKEN` (read-only; no secrets added).
- **State machines:** none.
- **Story count:** small (happy path + a couple of negative/robustness paths).

This is a single declarative workflow file that shells out to two already-existing,
already-passing test entrypoints (`test/test_harness_integrity.sh` and the
`src/conductor/` vitest suite). No application code, no schema, no new runtime
surface. Squarely **Small**.

Per the tier rules, the DECIDE chain for this feature is:
`explore (track) → complexity → stories → plan`.
PRD (technical track), architecture-diagram, architecture-review, and
conflict-check are all skipped for Small.
