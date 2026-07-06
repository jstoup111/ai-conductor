# Complexity: engineer handoff write-back gh ENOENT fix

Tier: S

## Rationale

- Bug fix confined to two existing modules (`engine/engineer/intake/github-issues.ts`
  cwd resolution, `engine/engineer-cli.ts` handoff failure messaging) plus the
  shared `writeback.ts` helper's ledger meta — no new modules or subsystems.
- No new models, integrations, external services, auth surfaces, or state machines;
  the ledger entry gains one advisory flag, not a new state.
- Fully covered by the existing injectable-runner unit-test pattern (GhRunner is
  already injected); expected story count is small (3).
- No schema/CLI-contract changes: flags and JSON outputs of `engineer handoff`
  are unchanged; only stderr guidance and ledger metadata are added.

Per tier S: /architecture-diagram, /architecture-review, and /conflict-check are
skipped; acceptance criteria live in stories (technical track, no PRD).
