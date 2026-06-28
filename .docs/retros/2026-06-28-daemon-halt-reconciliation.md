# Retro: Daemon Halt-Reconciliation
**Date:** 2026-06-28

## Tool (harness workflow)
- **Worked:** conflict-check caught the genuinely dangerous interaction (re-kick auto-clearing a
  9.0 paused-rebase HALT → corruption class) at DESIGN time, before any code — turning a latent
  recurring bug into an explicit ADR decision (Option 1 abort-before-clear). This is the gate
  earning its keep.
- **Worked:** the AskUserQuestion clarifications (downtime-SHA persistence, rebase-HALT handling,
  no-new-skill) resolved real forks the operator owned, with recommendations + tradeoffs.
- **Friction:** concurrent-session activity in the same repo moved the main checkout to another
  branch mid-build; the implementation agent had to detect this and isolate into its own worktree.
  Lesson: a long DECIDE→BUILD on a shared checkout should claim a dedicated worktree up front
  (the always-worktree rule) rather than committing on the main checkout's branch.

## Product (the code)
- **Worked:** the load-bearing design choice — "clear the marker IS the re-kick" — kept the
  feature to pure additive modules + optional DaemonDeps hooks, with zero changes to dispatch
  discipline. Re-kick cannot diverge from canonical dispatch because it issues no dispatch.
- **Worked:** reusing rebase.ts primitives (rebaseStateActive/performRebase/applyRebaseVerdicts)
  meant the corruption-sensitive path was never reimplemented.
- **Follow-up:** FR-12 ordering is enforced structurally (call-site placement) + contract tests,
  not a full end-to-end Conductor run. If a future change moves the resumeRebaseFirst call site, an
  e2e conductor test would catch a regression the structural guarantee would miss. Candidate
  hardening, not a blocker.
