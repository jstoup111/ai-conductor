# Track: ci-fix-resolver-autofix

**Track:** Technical

**Source:** GitHub intake `jstoup111/ai-conductor#666`

## Why technical (not product)

This change lives entirely inside the daemon's mergeable-sweep / CI-fix machinery. It
has no user-facing surface, no product acceptance criteria, and no PRD-level requirement —
it restores an internal automation that has never functioned on this host. Per the engineer
loop, the technical track skips `/prd`; acceptance lives in the stories.

## Problem statement (framing, not solution)

The daemon's ci-fix resolver crashes on every red shipped PR. `productionCiFixRunner`
(`src/conductor/src/engine/ci-fix.ts:264-268`) shells out to `claude --fix-session
--pr-url … --hint …`. **Verified directly:** the installed `claude` CLI (v2.1.215) has no
`--fix-session` flag — it exits non-zero at arg-parsing with
`error: unknown option '--fix-session' (Did you mean --fork-session?)`. The resolver has
therefore never worked on this host. The error is logged as a bare `ExecaError` and
re-thrown, so red-but-shipped PRs (#663/#664) strand with neither an automated fix nor a
diagnosable signal — the same fire-and-forget gap as #438, now with the resolver itself
broken.

## Desired outcomes (from intake #666)

1. The resolver runs a **real fix attempt** or surfaces a **diagnosable error** (spawn env,
   flag validity, auth) — never a bare swallowed `ExecaError` exit 1.
2. Red CI on a shipped PR triggers a **working resolution path** so PRs don't strand.
3. Whether the fix-invocation mechanism is valid is **verified mechanically at daemon
   startup** (fail loud once, not per-PR).

## Filer hypotheses (candidates, confirmed/deferred — NOT the chosen design)

- **`--fix-session` does not exist on the installed CLI** — **CONFIRMED (100%, verified)**.
  Root cause. `claude --help` lists no such flag; direct invocation errors at arg-parse.
- **Spawn env (PATH/auth) differs from interactive env** — secondary; not the root cause of
  the #663/#664 crashes (those are pure arg-parse failures), but folded into outcome #1's
  error classification and outcome #3's preflight so a future auth/PATH drift also fails loud.
- **The conductor CI failures themselves may be #573 flakiness or a real regression**
  (`Ambiguous plan discovery: multiple plans found`) — **explicitly out of scope**. The intake
  defers this to separate triage "once a resolver runs at all". This spec makes the resolver
  run; it does not diagnose the underlying red CI.

## Chosen direction (operator-gated)

**Real auto-fix via StepRunner.** Replace the fictional `--fix-session` spawn with the same
working mechanism setup-triage already uses (`ClaudeProvider` + `DefaultStepRunner`, real
`claude --print -p`), feeding the CI-failure hint as the fix prompt inside the resolver's
isolated worktree; keep the existing guard → suite-gate → lease-push pipeline. Add a
fail-loud-once startup preflight and diagnosable error classification.

## Discovery notes (ephemeral)

- Working precedent to mirror: `DefaultStepRunner.resolveSetupFailure`
  (`src/conductor/src/engine/step-runners.ts:697`) — fresh one-shot session,
  `invokeWithLadder(provider, …)`, `resume:false`, `dangerouslySkipPermissions`, cwd=worktree.
- Dispatch site: `daemon-cli.ts:1469` (`runCiFix(entry, branch, hint, { fixRunner, suiteCommand }, log)`).
- Preflight precedents: `src/conductor/src/engine/preflight.ts`,
  `src/conductor/src/engine/self-host/build-auth-preflight.ts`.
- Error swallow points: `ci-fix.ts:413` (log + rethrow), `daemon-cli.ts:1486` (log + swallow).
