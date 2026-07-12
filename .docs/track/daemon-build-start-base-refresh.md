# Track: daemon-build-start-base-refresh

Track: technical

## Rationale

This change adds a deterministic, engine-native step to THIS repo's conductor/daemon
build pipeline — a build-start `git fetch origin` + rebase of the feature worktree onto
the latest `origin/<default>` before any task runs. It is gated to daemon (auto) mode /
the self-host build flow; it imposes no new command, flag, config key, or user-facing
surface on downstream consumer projects, and interactive `/conduct` is a deliberate
no-op (humans rebase manually, unchanged). There is no product requirement — the
behavior is an internal build-flow correctness gate whose acceptance criteria belong in
stories, not a PRD. → **technical track** (skip `/prd`).
