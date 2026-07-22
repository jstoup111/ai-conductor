# Conflict Check: Flow-Level Eval Harness (#786)

**Date:** 2026-07-22
**Scope:** Stories 1–8 in `.docs/stories/flow-eval-harness.md` vs each other and vs existing
harness behavior.
**Result:** PASS — zero blocking conflicts, zero degrading conflicts accepted.

## Inventory

- New stories: flow-eval-harness Stories 1–8 (scripted provider, sandbox, flow drivers, tier
  scenarios, matrix runner, injected-break, interactive wiring, docs).
- Existing behavior considered: `llm_provider` plugin registry + selection (`plugin-loader.ts`,
  `index.ts`, `daemon-cli.ts`), `StepRunner`/daemon/engineer/intake entry points, `ComplexityTier`
  + `selector.ts` tier skipping, existing sandbox test patterns (`daemon-ship`, `engineer`), CLI
  command-detection chain (`index.ts` / `cli.ts`), `package.json` scripts.

## Pairwise scan (5 conflict types)

### Contradiction — none
No story asserts behavior opposite to another. Story 1 (scripted provider selected) and the
negative path "scripted provider never activates outside the eval" are complementary (gated
selection), not contradictory.

### Behavioral overlap — none blocking
Stories 3 (per-flow drivers) and 5 (matrix runner) both touch pass/fail results, but at different
layers: a driver returns one scenario's result; the runner aggregates results into a table. The
discriminated `PASS | FAIL(reason)` shape (architecture-review §Domain Integrity) is the shared
contract, so they compose rather than conflict. Story 4 (tier scenarios) and Story 6 (injected
break) both produce scenarios but on orthogonal axes (healthy tier coverage vs deliberate breakage);
no shared mutable state.

### State conflict — none
The eval introduces no persistent shared state: every scenario is an isolated `mkdtemp` sandbox
(Story 2) with env-scoped registry/state. Two scenarios cannot reach an impossible combined state.
The new `llm_provider:scripted` registration is additive to the registry (a distinct name), so it
cannot collide with the built-in `claude` provider.

### Resource contention — none
Story 2's isolation guarantees no port/DB/branch/path contention between scenarios or against the
real repo. The `AI_CONDUCTOR_NO_REAL_EXEC` / `AI_CONDUCTOR_NO_DAEMON_AUTOLAUNCH` fences prevent
contention with the real registry/daemon (directly honoring operator-safety rules #497/#681/#438).
The new `conduct-ts eval` subcommand name does not collide with existing detected commands
(inline/daemon/engineer/intake-loop/shipped-record/…); to be verified against the live detector
list at plan/build time (recorded as a plan prerequisite).

### Sequencing conflict — none
Dependencies are a DAG (see plan Task Dependency Graph): provider (1) and sandbox (2) precede
drivers (3), which precede tier scenarios (4) and the runner (5); the injected-break proof (6)
depends on a green baseline existing first (per ADR-scripted-provider follow-up). No circular
"each assumes it runs first."

## Notes carried to plan

- **Prerequisite:** confirm `eval` is a free command name in the `index.ts` detection chain before
  wiring `detectEvalCommand` (avoid shadowing an existing subcommand).
- **Prerequisite:** confirm whether the harness prefers an `evals/` top-level tree vs `test/eval/`;
  ADR chose `evals/` — verify no existing tooling assumes only `test/**` for TS sources.

## Verdict

Conflict check **PASS**. Proceed to `/plan`. No superseding ADRs required.
