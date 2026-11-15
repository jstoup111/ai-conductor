# Complexity: Manual-test report left in product worktree blocks next routed host

Tier: S

## Rationale

- One new engine helper. It records which paths are untracked before a validation dispatch, then moves the untracked paths that appeared during the dispatch into `.pipeline/`. It reuses the confinement and move checks that rebase's untracked-file quarantine already applies (`src/conductor/src/engine/rebase.ts`).
- Two call sites in `conductor.ts`: the serial dispatch of a validation-group member, and the grouped fan-out before the join. Plus one additive `ConductorEvent` variant and its `event-sinks.ts` row.
- One skill edit: `skills/manual-test/SKILL.md` names `.pipeline/manual-test-evidence/` as the place for screenshots and reports.
- No new module boundary, contract surface, persisted schema, CLI flag, or config key. It stays inside the APPROVED designs: the dirty-tree refusal on child switching (`adr-2026-10-07-per-child-build-region`) is unchanged, and the validation-group join (`adr-2026-07-10-validation-group-join`) only gains a step before its existing verdict recomputation.
- Two stories, about four tasks.

Per tier rules, architecture-diagram, architecture-review, conflict-check, and coherence-check are skipped.
