# Complexity: engineer-cli-subcommand-help-executes-the-command

Tier: S

## Signal assessment

| Signal | Reading | Tier |
|--------|---------|------|
| Data models / persistence | None new. No ledger/inbox/registry schema change. | S |
| Integrations | None new. `gh`, git, tmux all pre-existing and untouched by this fix. | S |
| Auth / identity | None. | S |
| State machine | None. Pure argv-parsing branches in an existing hand-rolled dispatcher (`detectEngineerCommand`); no new persistent state. | S |
| Concurrency | None introduced. | S |
| Story count | 4 stories (help short-circuits every subcommand with zero side effects; per-subcommand help text; unknown-flag rejection; root `--help` names both loops and stays rename-neutral). | S |
| Correctness risk | The BUG's real-world impact was high (an operator docs-lookup silently dequeued a live intake entry) — but the FIX itself is low-risk: a guard-clause pattern that already exists, verified working, for the sibling `daemon --help` case (`src/conductor/src/index.ts:378-388`). Copying a proven pattern into a second command, not inventing new mechanism. | S |

## Verdict

**Tier: S (Small).** Contained entirely to one file's argv-dispatch function
(`src/conductor/src/engine/engineer-cli.ts`) plus a documentation-completeness pass on
the existing (already-declared, never-executed-for-dispatch) commander help tree in
`src/conductor/src/cli.ts`. No new data model, integration, auth, or concurrency; no
gate-semantics change to the SDLC pipeline (this is a standalone CLI's own arg
parsing, not a build/ship gate). The mechanical fix pattern is already proven in this
codebase for `daemon --help` — this applies the same shape to `engineer`. Not L:
no architecture change. Estimated 8-9 small, pattern-following tasks (guard clause,
help text, unknown-flag allowlists per subcommand family, root-help completeness,
docs, changelog).

## DECIDE consequences (Small)

- PRD: **skipped** (technical track).
- architecture-diagram: **skipped** (no architecture change — S tier, no new
  component/flow).
- architecture-review: **skipped** (S tier; the fix mirrors an already-approved,
  already-shipped pattern in the same file family — no new design decision to
  review).
- conflict-check: **included** (required regardless of tier per HARNESS.md).
- stories + plan: **required**.
