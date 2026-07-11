# Complexity: re-enable bin/setup worktree smoke via worktree-local invocation (#334)

Tier: S

## Rationale

Single test-file change (`src/conductor/test/engine/publish-interrupted.test.ts`):
re-enable a skipped smoke and re-point its `bin/setup` invocation at the temp
worktree's own copy, with an explicit generous timeout. No production code, no
new models, integrations, auth, or state machines; 1 story. Architecture
diagram, architecture review, and conflict-check are skipped per tier rules.

Operator-selected approach (Option C of #334) deliberately avoids touching
`bin/setup`, `worktree-prepare.ts`, and the shared dist store — the delicate
areas that would have pushed this to M.
