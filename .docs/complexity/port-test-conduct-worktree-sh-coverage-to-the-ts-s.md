# Complexity: Port test_conduct_worktree.sh coverage to the TS suite

Tier: S

## Signals

| Signal | Value |
|--------|-------|
| New models / data structures | 0 |
| External integrations | 0 |
| Auth / security surface | 0 |
| State machines | 0 |
| Story count | ~6 (homogeneous, additive test stories) |

## Rationale

Purely additive black-box vitest tests against modules that **already exist** in `src/engine/`
(`task-progress.ts`, `artifacts.ts`, `worktree.ts`, `worktree-prepare.ts`, `conductor.ts`,
`state.ts`). No production behavior changes, no new architecture, no integrations, no data model.
The single file deletion (`test/test_conduct_worktree.sh`) is deferred to the v1.0 cutover PR (#226),
not part of this spec. Design risk is near-zero; the work is mechanical gap-filling guided by an
already-completed coverage audit.

Per the Small tier, `/architecture-diagram`, `/architecture-review`, and `/conflict-check` are
skipped. Acceptance criteria live directly in the stories (technical track — no PRD).
