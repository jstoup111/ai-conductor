# Complexity: composer labels its pane with the idea slug and DECIDE phase

Tier: S

Rationale: one best-effort pane-label helper (`herdr pane rename` inside herdr, `tmux select-pane
-T` inside tmux, no-op elsewhere), one new `compose phase` subcommand, the same helper invoked from
the existing `worktree`, `plan-review`, `land`, and `handoff` primitives, and one short instruction
in the composer skill. No data models, persisted state, auth, or state machines; the only
integration is the two multiplexer CLIs, mocked at the process boundary in tests. Expected story
count 2–3. Not a hotfix: it adds a CLI subcommand and a new module. Per tier rules:
architecture-diagram, architecture-review, conflict-check, coherence-check, and plan-review are
skipped. Operator-confirmed 2026-10-24.
