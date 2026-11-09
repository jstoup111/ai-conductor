# Track: Intake carries no semver signal

Track: technical

Scope boundary: minimal and display-only. An intake issue can carry a declared semver tier as one of the repository's existing `semver:major` / `semver:minor` / `semver:patch` labels, set at filing time through an optional `--semver major|minor|patch` flag on the bundled `intake-file` helper (an interactive prompt where Enter skips) and through an optional Semver dropdown on `.github/ISSUE_TEMPLATE/intake.yml` that the intake label-sync stamps. An undeclared tier is never inferred or defaulted: the issue gets no `semver:` label and the filing reports `semver=unset`. Excluded: carrying the tier to DECIDE, to `release-disposition`, or to the PR; any check of `Release-Semver` against the declaration; backfill of existing issues.

Rationale: internal intake tooling with no product requirements; the operator wants a visible label on the issue only, and a guessed tier would display a wrong release signal, so absence is reported rather than defaulted.
