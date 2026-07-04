# Complexity: conductor test suite leaks a real .pipeline/HALT into the process cwd

Tier: S

## Rationale

- No data models, integrations, auth, or state machines touched.
- One-line engine change (remove the `?? process.cwd()` fallback; make `projectRoot` a required
  `ConductorOptions` field) with zero production impact — both production call sites already pass it.
- Mechanical test edits (~80 constructor call sites across 3 test files) plus one global-setup
  teardown guard.
- Expected story count: 3 (required projectRoot, test-site isolation, leak guard).

Per tier S: architecture-diagram, architecture-review, and conflict-check are skipped; track is
technical so PRD is skipped.
