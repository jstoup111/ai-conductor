# Complexity: Stories represent current behavior without amendment records

Tier: S

## Rationale

Signals assessed against the standard set (models, integrations, auth, state machines, story count):

- **No new models, integrations, auth, or state machines.** The change touches no runtime engine
  code path. `grep` over `src/`, `bin/`, and `hooks/` finds no consumer of the `Amended` marker —
  it is a prose convention only.
- **Contained, enumerable surface.** Five prose surfaces (`HARNESS.md`,
  `skills/stories/SKILL.md`, `skills/conflict-check/SKILL.md`, `skills/architecture-review/SKILL.md`,
  `docs/reference/artifacts.md`) and one acceptance test
  (`build-tasks-can-amend-protected-docs-artifacts-ame.acceptance.test.ts`, TS-1) whose `stories`
  row inverts.
- **Low story count.** Two stories: the replace-in-place contract and the converge-on-touch rule.
- **No data migration.** The chosen approach deliberately rejects a bulk codemod; existing story
  files converge when DECIDE next touches them.
- **No new CLI flag, config key, hook, or settings schema change**, so no migration block is owed.

The only non-trivial edge is that the change must invert an existing machine-checked assertion
rather than merely add one — a single, well-located test edit, not a complexity driver.
