# Complexity: tmux-leak-guard fail-closed hardening (#437)

Tier: S

Rationale: single test-infrastructure module (`src/conductor/test/tmux-leak-guard.ts`)
plus its `global-setup.ts` wiring and regression tests. No data models, no external
integrations, no auth, no state machines; expected story count 2–3. Pure deterministic
control-flow hardening (fail-closed snapshot + tmpdir cwd corroboration).
Per tier rules: architecture-diagram, architecture-review, and conflict-check are skipped.
