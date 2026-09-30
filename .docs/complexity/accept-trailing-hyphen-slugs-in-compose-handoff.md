# Complexity: Accept trailing-hyphen slugs in compose handoff

Tier: S

Operator scope: small (issue labeled `size: S`), confirmed 2026-09-28 (delegated).

The change adds one exported slug-grammar predicate beside the existing generator in `spec-branch.ts` and replaces one inline regular expression in `engineer-cli.ts` with it, plus focused tests. It introduces no service, schema, CLI flag, event, storage, or configuration, and touches two production files. Small-tier architecture, conflict, and coherence artifacts are not required.
