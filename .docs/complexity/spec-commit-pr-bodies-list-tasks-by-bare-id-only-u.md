# Complexity: Spec commit/PR bodies list tasks with their titles

Tier: S

Rationale: One production function changes. `composeSpecCommitMessage` in `src/conductor/src/engine/engineer/spec-commit-message.ts` switches its Tasks section from `parsePlanTaskBodies(...).keys()` to the already-exported, already-tested `parsePlanTaskTitles` and adds a bare-id fallback for untitled headings. No new parser, type, state, event, schema, CLI flag, or plan-format rule. `handoff` builds the PR body from the land commit (`release-metadata-inject.ts:122`, `git show -s --format=%B`), so it changes with no code of its own. Risk is limited to commit/PR body text and is covered by unit tests plus the existing `landSpec` commit-message integration test.
