# Track: daemon-build-start-base-refresh

Track: technical

## Rationale

This change adds an opt-in, config-driven build-start refresh to THIS repo's conductor/
daemon build flow: when the project's `.ai-conductor/config.yml` sets
`build_start_base_refresh: true`, the daemon runs `git fetch origin` + rebase of the
feature worktree onto the latest `origin/<default>` at the BUILD boundary (before any
task runs). It is read at daemon startup exactly like the existing `owner_gate_cutover`,
`auto_restart_on_stale_engine`, and `attribution_judge_cutover` flags — absent/false is a
no-op, so it imposes no new command, flag, or behavior on downstream consumer projects,
and interactive `/conduct` is unaffected. There is no product requirement — the behavior
is an internal, per-project build-flow correctness toggle whose acceptance criteria belong
in stories, not a PRD. → **technical track** (skip `/prd`).
