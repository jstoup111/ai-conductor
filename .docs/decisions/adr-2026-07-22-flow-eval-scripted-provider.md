# ADR: Flow eval drives real orchestration over a scripted LLMProvider

**Date:** 2026-07-22
**Status:** APPROVED
**Deciders:** engineer (operator delegate), #786

## Context

`conduct-ts` exposes several execution flows (inline, interactive, daemon, engineer, intake-loop).
Their v1-critical failures are **orchestration-level**: a daemon wedge (`no_task_progress`), a
`git worktree add` exit-128, an engineer land failure, a park loop (#497/#681/#438). These only
appear in a live run and are invisible to the current unit/acceptance tests. We need a standing
eval that exercises each flow end-to-end and emits an observable pass/fail — but flows normally
shell out to a live `claude` subprocess (`ClaudeProvider`, `claude … -p`), which is
non-deterministic, token-costly, and CI-hostile.

Two mock seams already exist in the codebase:
1. **`MockStepRunner`** (`full-flow.test.ts`) — replaces the entire `StepRunner`. Tests the
   conductor's abstract step sequencing + tier skipping. Does NOT run the real step logic, real
   gates, or real git/worktree operations.
2. **Canned `LLMProvider`** (`RecorderProvider`, `recorder-provider-flow.test.ts`) — replaces only
   the `claude` subprocess. The real `StepRunner`, gate loop, daemon drain, and git/worktree
   operations all run.

The repo's Design Principle mandates "deterministic where possible; LLM only where necessary."

## Options Considered

### Option A: Live-LLM eval (real `claude` per step)
- **Pros:** highest fidelity — also exercises agent output quality.
- **Cons:** non-deterministic (flaky), burns tokens/credits on every run, can hit rate/session
  limits, cannot be a reliable regression gate. Violates the Design Principle.

### Option B: `MockStepRunner`-only eval
- **Pros:** fastest, purely deterministic; already proven by `full-flow.test.ts`.
- **Cons:** too shallow — bypasses the real step logic, gates, and **git/worktree layer**. Cannot
  catch a `worktree add` exit-128, a `no_task_progress` wedge, or an engineer land failure. Misses
  exactly the failures #786 exists to catch.

### Option C: Scripted `LLMProvider` over the real orchestration (chosen)
- **Pros:** deterministic and token-free (no live model); runs the **real** StepRunner, conductor
  gate loop, daemon drain, engineer DECIDE loop, intake loop, tier step-skipping, and real
  `git`/worktree operations in a sandbox. Catches the orchestration/git failures #786 targets.
  Uses the existing `llm_provider` registry seam — no new injection plumbing.
- **Cons:** the scripted provider must produce **real side effects** per step (write the expected
  `.docs/` artifact, commit with a `Task:`/evidence trailer) so downstream deterministic gates pass
  — more than a canned string. Does not assess agent *output quality* (explicitly out of scope).

## Decision

Adopt **Option C**. Register a `ScriptedProvider` as `llm_provider:scripted` and select it via
sandbox config (`config.llm_provider = 'scripted'`), so both inline (`index.ts`) and daemon
(`daemon-cli.ts:746`) resolve it through the existing registry lookup; inject it as `deps.provider`
for the engineer loop. Scenario scripts model each step's response as an **action** (produce
artifact + commit), not just text, so the real gates (evidence gate, stories-`Status: Accepted`,
tier-vs-artifact, `isVerifiedShip`, shipped-record) are satisfied by genuine side effects.

We choose C over B because the target failures live in the orchestration/git layer that B bypasses,
and over A because A violates the Design Principle and cannot be a reliable regression signal. The
eval's contract is explicitly **flow-machinery correctness**, not agent output quality.

## Consequences

### Positive
- Deterministic, token-free, CI-runnable regression signal for every flow.
- Reuses existing, proven seams (`plugin-loader` registration, `registry.get('llm_provider', …)`,
  `StepRunner` provider arg, engineer `deps.provider`, the `daemon-ship`/`engineer` sandbox recipes).
- An injected break (a scripted stall, a bad artifact, a git conflict) is caught by the eval rather
  than only in a live run — the #786 acceptance signal.

### Negative
- Scripted scenarios must be maintained as artifact/commit-producing scripts; a happy scenario must
  be pinned to a known-green baseline before breaks are derived from it.
- The eval does not cover LLM output quality — a separate concern, out of scope here.

### Follow-up Actions
- [ ] Implement `ScriptedProvider` (`llm_provider:scripted`) with per-step artifact/commit actions.
- [ ] Guard its registration so it never activates in normal operation (eval/config-gated).
- [ ] Pin one known-green happy scenario per flow before authoring break scenarios.
