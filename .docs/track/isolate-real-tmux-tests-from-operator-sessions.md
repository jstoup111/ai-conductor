# Track: Isolate real-tmux tests from operator sessions

Track: technical

Scope boundary: Comprehensive (operator-confirmed). In scope: a run-level tmux redirection floor (per-run/per-worker `TMUX_TMPDIR`, `TMUX`/`TMUX_PANE` stripped) for the whole test process tree; a shared fixture-owned private-socket runner with owned teardown and interrupted-run sweep; migration of every ambient real-tmux test (`daemon-restart-wiring`, `daemon-tmux.smoke`, `daemon-lifecycle.e2e`, `daemon-stale-respawn.e2e`) plus alignment of `daemon-exit-witness-tmux.e2e`; a static integrity check rejecting ambient tmux access and unsafe tmux environment overrides in tests; retained real-tmux restart/cleanup coverage. Out of scope: production daemon tmux behavior and the production `AI_CONDUCTOR_NO_REAL_EXEC` kill-switch semantics.

Test-infrastructure safety work with no user-facing behavior; acceptance criteria live in stories (no PRD).
