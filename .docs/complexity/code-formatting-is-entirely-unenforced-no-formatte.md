# Complexity: Enforce canonical code formatting on touched files

Tier: M

## Rationale

- Adds a new formatter development dependency (tool choice, version pin, and line width are an
  architecture decision worth a lightweight ADR; a measured whole-repository dry run rewrites 2,294
  of 2,562 TypeScript files at width 120, so the canonical style choice is load-bearing).
- Adds a new merge gate in two enforcement points that must agree: a CI job in
  `.github/workflows/ci.yml` joined to the required aggregate check, and a `test_suite` command in
  `.ai-conductor/config.yml` so self-host builds fail before a pull request exists.
- Adds one command surface (`format` / `format:check`) that resolves the changed-file set against a
  base reference, covering TypeScript (src/conductor, plugins/) and shell files.
- No engine module, state machine, persisted format, or consumer-facing surface changes;
  `hooks/claude/lint-after-edit.sh` and the errors-only ESLint configuration are untouched.
- Expected story count ~3: changed-file format check, canonical-form command (changed and whole
  repository), and enforcement in both CI and test_suite.

Operator confirmed Medium on 2026-11-07. Per tier rules, architecture-diagram, lightweight
architecture-review, conflict-check, coherence-check, and plan-review run.
