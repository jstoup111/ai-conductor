# ADR: Dispatch ci-fix via DefaultStepRunner, not a bespoke claude spawn

**Status:** APPROVED
**Date:** 2026-07-20
**Context tier:** Medium
**Related:** intake jstoup111/ai-conductor#666, adr-2026-07-20-ci-fix-startup-preflight-and-error-classification

## Context

`productionCiFixRunner` (`ci-fix.ts:264-268`) invokes `claude --fix-session --pr-url … --hint …`.
The `--fix-session` flag does not exist on the installed CLI (v2.1.215; verified — arg-parse
error `unknown option '--fix-session'`), so the resolver has never produced a fix. We must
replace it with a real headless Claude invocation that diagnoses and fixes the failing PR
inside the resolver's isolated worktree.

## Options considered

1. **Reuse `DefaultStepRunner` via a new `resolveCiFailure(ctx)` method** (mirror of
   `resolveSetupFailure`, `step-runners.ts:697`) — fresh one-shot session,
   `modelAvailability.invokeWithLadder(provider, …)`, `resume:false`,
   `dangerouslySkipPermissions`, cwd = resolver worktree, CI hint in the prompt.
2. **Bespoke `claude --print -p <prompt>` spawn** directly inside `ci-fix.ts` (mirroring
   `ClaudeProvider.runPrint` but hand-rolled).
3. **Keep `execa('claude', …)` but only correct the flags** — no real dispatch abstraction.

## Decision

**Option 1 — reuse `DefaultStepRunner` through a new `resolveCiFailure`.**

The production `CiFixRunner` seam is rewired to call a StepRunner-backed dispatcher (injected,
preserving the existing `CiFixRunner` interface so tests keep their fake runner and the
`AI_CONDUCTOR_NO_REAL_EXEC` kill-switch still short-circuits). The dispatcher builds a
CI-failure system prompt + the existing `buildCiFixHint` payload and dispatches one-shot.

## Rationale

- **Proven path.** `resolveSetupFailure` already dispatches headless Claude in production with
  the model fallback ladder; `resolveCiFailure` is a near-mechanical sibling, minimizing new
  surface and risk.
- **Model-availability resilience.** `invokeWithLadder` walks the fallback ladder, so the
  resolver is not blocked by one model's unavailability — a bespoke spawn (option 2) would
  reimplement this or lose it.
- **Single dispatch convention.** Both setup-failure and ci-failure fixes flow through one
  StepRunner mechanism; option 2 forks a second spawn path to maintain, and option 3 leaves
  the resolver brittle (no ladder, no shared config resolution) and merely relocates the flag
  problem.

## Consequences

- New `DefaultStepRunner.resolveCiFailure(ctx: { worktreePath; prUrl; hint; slug })` returning
  an attempted/outcome marker, consumed by the rewired production runner.
- The existing guard → suite-gate → lease-push pipeline in `runCiFix` is unchanged; it still
  gates whatever the dispatch produces.
- Tests inject a fake `CiFixRunner` (interface unchanged), so no real Claude spawn in the suite.
