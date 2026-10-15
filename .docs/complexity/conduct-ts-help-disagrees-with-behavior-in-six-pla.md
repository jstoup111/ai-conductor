# Complexity: CLI help disagrees with behavior (#1012)

Tier: M

## Rationale

- Touches the CLI entry surface in two files with a structural seam between them:
  `src/conductor/src/cli.ts` (commander declarations) and `src/conductor/src/index.ts`
  (42 pre-commander argv intercepts), plus `src/engine/engineer-cli.ts` help strings and
  `src/engine/daemon-command.ts` runtime defaults.
- Introduces new drift machinery: an exported pre-dispatch command-name list, a commander
  coverage test, `--help`/`-h` yield in intercepts, and shared default constants.
- No models, persistence, external integrations, or state machines; behavior change is limited
  to help output and `--help` handling.
- Story count ~6-7 (one per symptom plus the drift guard), more than a Small change carries.
- Approach A deliberately leaves the 42 dispatch blocks intact, keeping this below Large.

Per tier rules: architecture-diagram, lightweight architecture-review, and conflict-check apply.
