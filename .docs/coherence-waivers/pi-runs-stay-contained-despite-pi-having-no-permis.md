Waives: outcome-1, outcome-2

Rationale: On 2026-09-29 the operator narrowed #1886 during `/explore` to three things: Pi
`readOnlyReview`, `nativeSchema`, and parity hardening. OS write-containment moved to a separate
intake that covers every provider, filed as jstoup111/ai-conductor#2851. `outcome-1` (an unattended
Pi dispatch cannot write outside its worktree) and `outcome-2` (fail closed with a halt when
containment cannot be established) are that containment, so this spec does not deliver them.

This is a scope decision grounded in what DECIDE found, not trimming:

- Harness bubblewrap containment exists only for self-host builds (`engine/conductor.ts`
  `isSelfBuild()`), and Pi is already refused there because it declares no `selfHost` (#1887).
- In consumer projects no provider's writes are harness-contained. Claude runs with
  `--dangerously-skip-permissions` and no wrap, and only Codex limits itself through its own
  `workspace-write` sandbox.
- So a Pi-only wrap would give Pi a guarantee Claude lacks. The operator chose to build the guarantee
  once, for all providers, in #2851. That intake carries both outcomes, including fail-closed before
  dispatch.

Until #2851 ships, unattended Pi has the same write exposure as unattended Claude. This spec removes
the Pi-specific exposures on top of that: repository `.pi/` extensions no longer load by default
(Story 5), review invocations have no write-capable tools (Story 1), and the Pi env gets the
daemon-session marker (Story 6).
