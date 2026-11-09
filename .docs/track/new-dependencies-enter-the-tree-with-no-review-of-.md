# Track: New dependencies enter the tree with no review of necessity, pinning, or license

Track: technical

Scope boundary: Balanced — a dependency-hygiene judgement (necessity versus existing code, version pinning, license compatibility) on any diff that changes a dependency manifest or lockfile, ecosystem-agnostic, delivered as a shipped review-policy skill run through `build_review.custom_rubrics` with a new optional `paths` trigger that deterministically skips the rubric when no changed path matches; findings route through the existing adjudicator. License is judged from local evidence only and reported non-blocking when unverifiable. Excluded: vulnerability/CVE scanning, configurable license allow/deny policy, maintenance/abandonment signals, a new built-in registry rubric, and per-ecosystem mechanical parsers.

Internal harness gate tooling with no end-user product requirements; acceptance criteria live in stories.
