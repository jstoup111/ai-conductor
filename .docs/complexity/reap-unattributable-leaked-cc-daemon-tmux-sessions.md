# Complexity: Reap unattributable leaked cc-daemon tmux sessions and orphaned dispatch processes

Tier: M

## Rationale

- Two cooperating engine changes: dispatch-scoped descendant-tree teardown wired into every daemon
  exit path it controls (dispatch end, timeout/abort, SIGHUP/SIGTERM), and a read-only
  `daemon status` attribution surface for `cc-daemon-*` tmux sessions and orphaned worktree processes.
- Touches process-lifecycle machinery with destructive effects (signals to pids), so the process
  boundary must be an injectable adapter and tests must follow the repo's Test Process Isolation rule.
- New event(s) on the existing `ConductorEvent` spine; no new persistence channel.
- Cross-platform process enumeration (`/proc` on Linux, `ps` fallback) adds a design decision worth
  an ADR, but no new external service, schema migration, or consumer-facing CLI contract change.
- Estimated 4–6 stories; not Large — no multi-subsystem redesign and no new sandbox dependency.

Per tier rules: architecture-diagram, lightweight architecture-review, and conflict-check apply;
no PRD (technical track).
