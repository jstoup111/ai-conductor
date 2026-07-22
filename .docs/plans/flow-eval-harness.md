# Implementation Plan: Flow-Level Eval Harness (#786)

**Date:** 2026-07-22
**Design:** `.docs/architecture/flow-eval-harness.md`
**Decisions:** `.docs/decisions/adr-2026-07-22-flow-eval-scripted-provider.md`,
`.docs/decisions/adr-2026-07-22-flow-eval-tier-mapping-and-surface.md`
**Stories:** `.docs/stories/flow-eval-harness.md`
**Complexity:** L (`.docs/complexity/flow-eval-harness.md`)
**Conflict check:** Clean as of 2026-07-22

## Summary

Builds a deterministic, token-free eval harness that drives each `conduct-ts` flow (inline,
interactive, daemon, engineer, intake-loop) to its real completion checkpoint at S/M/L
(`ComplexityTier`) inside isolated sandboxes, using a scripted `LLMProvider` in place of the live
`claude` subprocess, and reports per-(flow,tier) pass/fail. ~17 tasks.

## Technical Approach

The eval TypeScript tree lives at **`src/conductor/evals/`** (inside the conductor package so it can
import engine symbols and run under `tsx`/`vitest`; this refines the ADR's "`evals/` tree" — the
conflict-check left the exact location open, and importability of engine oracles forces it inside
the package). It reuses three existing seams verified during DECIDE:

- **Provider selection by name** — register `ScriptedProvider` as `llm_provider:scripted` in the
  plugin registry; sandbox config sets `llm_provider: scripted`, so `index.ts` and `daemon-cli.ts`
  resolve it through the existing `registry.get('llm_provider', …)` lookup; the engineer loop takes
  it as `deps.provider`.
- **Sandbox recipe** — extract a `SandboxRepo` builder from the proven `mkdtemp`+`git init`+
  `writeSpec` pattern in `test/integration/daemon-ship.integration.test.ts` and the fake-origin
  `initRepo` in `test/acceptance/engineer.test.ts`, with env isolation
  (`AI_CONDUCTOR_REGISTRY`/`AI_CONDUCTOR_ENGINEER_DIR`/`AI_CONDUCTOR_NO_REAL_EXEC`/
  `AI_CONDUCTOR_NO_DAEMON_AUTOLAUNCH`).
- **Public flow entry points + oracles** — drive `Conductor.run`, `runDaemonMode`, `runEngineerMode`,
  `runIntakeLoop`; assert `feature_status==='complete'` / `isVerifiedShip()` + shipped-record / spec
  PR / routed+notified.

Scripted step responses are modeled as **actions** (write artifact + commit with trailer), not bare
strings, so real gates pass. Each scenario pins `state.complexity_tier` deterministically. The
matrix runner is exposed via a `conduct-ts eval` subcommand + `npm run eval`, run on-demand/nightly
(not the per-PR `vitest run`).

## Prerequisites

- Confirm `eval` is a free subcommand name in the `index.ts` `detect*` chain (no shadowing).
- Confirm no tooling assumes TS sources only under `src/conductor/src/**` such that
  `src/conductor/evals/**` needs `tsconfig`/`vitest` include adjustment; add includes if needed.
- Establish, per flow, one known-green scenario baseline before deriving break scenarios (ADR
  follow-up).

## Tasks

### Task 1: ScriptedProvider skeleton + gated registration
**Story:** Story 1 (happy: scripted provider selected, no claude spawn)
**Type:** infrastructure
**Steps:**
1. Write failing test: `registry.get('llm_provider','scripted')` returns a `ScriptedProvider` and normal config still returns `ClaudeProvider`.
2. Verify RED. 3. Implement `ScriptedProvider implements LLMProvider` returning canned per-step responses keyed by prompt/step; register it in the registry gated so it is inert in normal operation (eval/config-gated). 4. GREEN. 5. Commit.
**Files likely touched:**
- `src/conductor/evals/scripted-provider.ts` — new provider
- `src/conductor/src/engine/plugin-loader.ts` — gated registration of `llm_provider:scripted`
**Wired-into:** `src/conductor/src/engine/plugin-loader.ts#registerBuiltins` (gated); selected via `src/conductor/src/index.ts#main` + `src/conductor/src/daemon-cli.ts` provider lookup
**Dependencies:** none

### Task 2: ScriptedProvider artifact/commit actions
**Story:** Story 1 (happy: step response writes artifact + commit satisfying a real gate)
**Type:** happy-path
**Steps:**
1. Write failing test: a scripted step whose action declares an artifact + commit produces the file and a commit carrying the expected `Task:`/evidence trailer in a sandbox.
2. RED. 3. Implement action execution (write `.docs/` artifact, `git commit` with trailer) inside `invoke()`. 4. GREEN. 5. Commit.
**Files likely touched:**
- `src/conductor/evals/scripted-provider.ts` — action execution
- `src/conductor/evals/scenario-types.ts` — scripted-response/action shape
**Wired-into:** same as Task 1
**Dependencies:** 1

### Task 3: ScriptedProvider missing-response error
**Story:** Story 1 (negative: no scripted response → explicit error)
**Type:** negative-path
**Steps:**
1. Write failing test: `invoke()` for an unscripted step rejects with "no scripted response for step <name>" (not empty success).
2. RED. 3. Implement the guard. 4. GREEN. 5. Commit.
**Files likely touched:**
- `src/conductor/evals/scripted-provider.ts` — missing-response guard
**Wired-into:** same as Task 1
**Dependencies:** 1

### Task 4: SandboxRepo builder
**Story:** Story 2 (happy: isolated repo + env)
**Type:** infrastructure
**Steps:**
1. Write failing test: `SandboxRepo.create()` yields a `mkdtemp` repo with `git init -b main`, seed commit, fake origin, and env pointed inside the tmpdir (`AI_CONDUCTOR_REGISTRY`/`_ENGINEER_DIR`/conductor state).
2. RED. 3. Implement, extracting the `daemon-ship`/`engineer` recipe. 4. GREEN. 5. Commit.
**Files likely touched:**
- `src/conductor/evals/sandbox-repo.ts` — builder
- `src/conductor/evals/sandbox-repo.test.ts` — test
**Wired-into:** `src/conductor/evals/run.ts` (matrix runner, Task 14) and each FlowDriver (Tasks 7–11)
**Dependencies:** none

### Task 5: SandboxRepo teardown + real-registry refusal guard
**Story:** Story 2 (negatives: finally-teardown, refuse real registry, no daemon autolaunch)
**Type:** negative-path
**Steps:**
1. Write failing tests: teardown removes the tmpdir even on scenario crash (finally); the eval refuses to run when `AI_CONDUCTOR_REGISTRY` resolves outside the sandbox; `AI_CONDUCTOR_NO_DAEMON_AUTOLAUNCH` is set for scenarios.
2. RED. 3. Implement teardown + guards. 4. GREEN. 5. Commit.
**Files likely touched:**
- `src/conductor/evals/sandbox-repo.ts` — teardown + guards
**Wired-into:** same as Task 4
**Dependencies:** 4

### Task 6: FlowDriver interface + discriminated result + budget
**Story:** Story 3 (result shape, timeout, no-hang)
**Type:** infrastructure
**Steps:**
1. Write failing test: a `FlowDriver` returns `{status:'pass'}` or `{status:'fail',reason}`; a driver exceeding its budget aborts with `fail: timeout`.
2. RED. 3. Implement the interface, discriminated `FlowResult`, and a bounded-budget wrapper. 4. GREEN. 5. Commit.
**Files likely touched:**
- `src/conductor/evals/flow-driver.ts` — interface + result type + budget wrapper
**Wired-into:** `src/conductor/evals/run.ts` (Task 14)
**Dependencies:** none

### Task 7: Inline flow driver + oracle
**Story:** Story 3 (inline oracle), Story 4 (tier observation)
**Type:** happy-path
**Steps:**
1. Write failing test: green inline scenario reaches `feature_status==='complete'` + `feature_complete` event → PASS; a non-completing scenario → FAIL with reason.
2. RED. 3. Implement the inline driver over `Conductor.run` in a sandbox with the scripted provider. 4. GREEN. 5. Commit.
**Files likely touched:**
- `src/conductor/evals/drivers/inline-driver.ts` — driver
**Wired-into:** `src/conductor/evals/run.ts#driverRegistry`
**Dependencies:** 2, 5, 6

### Task 8: Daemon flow driver + oracle
**Story:** Story 3 (daemon oracle)
**Type:** happy-path
**Steps:**
1. Write failing test: green daemon scenario reaches `isVerifiedShip()` true + `.docs/shipped/<slug>.md` committed → PASS.
2. RED. 3. Implement the daemon driver over `runDaemonMode`/`daemon-runner` with a scripted provider + a seeded stories+plan fixture. 4. GREEN. 5. Commit.
**Files likely touched:**
- `src/conductor/evals/drivers/daemon-driver.ts` — driver
**Wired-into:** `src/conductor/evals/run.ts#driverRegistry`
**Dependencies:** 2, 5, 6

### Task 9: Engineer flow driver + oracle
**Story:** Story 3 (engineer oracle)
**Type:** happy-path
**Steps:**
1. Write failing test: green engineer scenario opens a spec PR (or records the local-commit fallback) via handoff → PASS.
2. RED. 3. Implement the engineer driver over `runEngineerMode` with injected `deps.provider` (scripted), `deps.gh` stub, env registry. 4. GREEN. 5. Commit.
**Files likely touched:**
- `src/conductor/evals/drivers/engineer-driver.ts` — driver
**Wired-into:** `src/conductor/evals/run.ts#driverRegistry`
**Dependencies:** 2, 5, 6

### Task 10: Intake-loop driver + oracle
**Story:** Story 3 (intake-loop oracle)
**Type:** happy-path
**Steps:**
1. Write failing test: intake-loop `--once` routes an idea + notifies (status surface) with zero `claude` spawns → PASS.
2. RED. 3. Implement the intake-loop driver over `runIntakeLoop` with injected deps. 4. GREEN. 5. Commit.
**Files likely touched:**
- `src/conductor/evals/drivers/intake-loop-driver.ts` — driver
**Wired-into:** `src/conductor/evals/run.ts#driverRegistry`
**Dependencies:** 5, 6

### Task 11: Interactive wiring-level coverage
**Story:** Story 7 (interactive wiring + documented boundary)
**Type:** happy-path
**Steps:**
1. Write failing test: the interactive coverage check verifies `--interactive` routes steps into REPL mode / `invokeInteractive` (wiring), and FAILs if that dispatch is broken — without a live TTY.
2. RED. 3. Implement the wiring-level check. 4. GREEN. 5. Commit.
**Files likely touched:**
- `src/conductor/evals/drivers/interactive-wiring.ts` — wiring check
**Wired-into:** `src/conductor/evals/run.ts#driverRegistry`
**Dependencies:** 6

### Task 12: Tier scenario mapping + executed-step assertion
**Story:** Story 4 (S/M/L exercise real tier skipping)
**Type:** happy-path
**Steps:**
1. Write failing test: an `S` scenario skips the tier-skippable steps and an `L` scenario runs them; a regression where an `S` scenario runs a skippable step → FAIL naming the step; a non-S/M/L tier is rejected.
2. RED. 3. Implement tier pinning (`state.complexity_tier`) + executed-step comparison against `getSkippableSteps(tier)`. 4. GREEN. 5. Commit.
**Files likely touched:**
- `src/conductor/evals/tier.ts` — tier pin + expected-skip assertion
- `src/conductor/evals/scenario-types.ts` — reuse `ComplexityTier`
**Wired-into:** consumed by each driver (Tasks 7–10) and `run.ts`
**Dependencies:** 6, 7, 8

### Task 13: Committed S/M/L example prompt fixtures per flow
**Story:** Story 4 (each flow has S/M/L example prompts committed)
**Type:** infrastructure
**Steps:**
1. Write failing test: the fixture loader finds an S, M, and L example prompt for every enumerated flow.
2. RED. 3. Author the committed prompt fixtures + their scripted scenario scripts. 4. GREEN. 5. Commit.
**Files likely touched:**
- `src/conductor/evals/fixtures/<flow>/{s,m,l}.prompt.md` — example prompts
- `src/conductor/evals/fixtures/<flow>/{s,m,l}.scenario.ts` — scripted responses
**Wired-into:** loaded by `src/conductor/evals/run.ts#loadScenarios`
**Dependencies:** 12

### Task 14: Matrix runner + per-combination report + exit code + filters
**Story:** Story 5 (single runner, per-combination table)
**Type:** happy-path
**Steps:**
1. Write failing test: the runner executes the flow×tier matrix, emits a PASS/FAIL row per combination with reasons, exits non-zero on any failure, supports `--flow`/`--tier` filters, rejects unknown values, and one scenario's throw does not abort the matrix.
2. RED. 3. Implement `run.ts` (driver registry + scenario loader + aggregation + report + exit code). 4. GREEN. 5. Commit.
**Files likely touched:**
- `src/conductor/evals/run.ts` — matrix runner + reporter
**Wired-into:** `src/conductor/src/index.ts#main` (via `detectEvalCommand`, Task 15) and `src/conductor/package.json` `scripts.eval`
**Dependencies:** 7, 8, 9, 10, 11, 13

### Task 15: `conduct-ts eval` subcommand + `npm run eval` script
**Story:** Story 5 (operator surface)
**Type:** infrastructure
**Steps:**
1. Write failing test: `detectEvalCommand(argv)` routes `conduct-ts eval [--flow …] [--tier …]` to the runner; `cli.ts` declares the flags; `npm run eval` invokes the runner.
2. RED. 3. Implement `detectEvalCommand` + dispatch in `index.ts`, declare in `cli.ts`, add the `eval` script. 4. GREEN. 5. Commit.
**Files likely touched:**
- `src/conductor/src/index.ts` — `detectEvalCommand` guard + dispatch
- `src/conductor/src/cli.ts` — flag declarations
- `src/conductor/package.json` — `scripts.eval`
**Wired-into:** `src/conductor/src/index.ts#main` (detect chain)
**Dependencies:** 14

### Task 16: Injected-break scenarios + repaired-PASS proof
**Story:** Story 6 (deliberately broken flow is caught; repaired → PASS)
**Type:** negative-path
**Steps:**
1. Write failing tests: a daemon no-progress (`no_task_progress`) scenario → FAIL with wedge reason; a forced `git worktree add` failure → FAIL with git exit; an engineer land-reject (DRAFT/stub) → FAIL with land-guard reason; and the same daemon scenario repaired → PASS.
2. RED. 3. Author the break scenarios + assertions. 4. GREEN. 5. Commit.
**Files likely touched:**
- `src/conductor/evals/fixtures/breaks/*.scenario.ts` — break scenarios
- `src/conductor/evals/breaks.test.ts` — FAIL-then-repaired-PASS assertions
**Wired-into:** loaded by `src/conductor/evals/run.ts#loadScenarios` (break suite)
**Dependencies:** 8, 9, 14

### Task 17: Documentation + CHANGELOG
**Story:** Story 8 (docs track features)
**Type:** infrastructure
**Steps:**
1. Write failing check (or manual gate): README sections describe `conduct-ts eval`/`npm run eval`, the flow×tier matrix, the interactive boundary, and the on-demand/nightly (non-PR-gate) posture; `CHANGELOG.md [Unreleased]` has an Added entry.
2. Implement the docs edits. 3. Verify. 4. Commit.
**Files likely touched:**
- `README.md` — eval command + posture
- `src/conductor/README.md` — eval command + matrix + boundary
- `CHANGELOG.md` — `[Unreleased]` Added entry
**Wired-into:** none (no new production surface)
**Dependencies:** 15, 16

## Task Dependency Graph

```
1 ─┬─ 2 ─┬─ 7 ─┐
   └─ 3   │     │
4 ─── 5 ──┤     │
6 ────────┼─ 8 ─┤
          ├─ 9 ─┤
          ├─10 ─┤
          └─11 ─┤
7,8,6 ── 12 ── 13 ── 14 ── 15 ──┐
8,9,14 ─────────── 16 ──────────┴─ 17
```

- 1 → 2, 3 (provider actions + guard build on the skeleton)
- 4 → 5 (teardown/guards extend the builder)
- 2,5,6 → 7,8,9 ; 5,6 → 10 ; 6 → 11 (drivers need provider actions + sandbox + interface)
- 6,7,8 → 12 → 13 (tier assertion + fixtures)
- 7,8,9,10,11,13 → 14 (runner aggregates all drivers + scenarios)
- 14 → 15 (CLI surface wraps the runner)
- 8,9,14 → 16 (break proof needs daemon/engineer drivers + runner)
- 15,16 → 17 (docs describe the finished surface)

## Integration Points

- After Task 5: a scenario can spin an isolated sandbox with a scripted provider (no live model, no real state).
- After Task 11: every flow can be driven to (or short of) its oracle individually.
- After Task 15: `conduct-ts eval` / `npm run eval` runs the full flow×tier matrix and reports per-combination pass/fail — the #786 primary acceptance signal.
- After Task 16: the eval is proven to catch a deliberately broken flow (and distinguish repaired = PASS).

## Verification

- [ ] All happy path criteria covered by at least one task (Tasks 1,2,4,6–15)
- [ ] All negative path criteria covered by explicit tasks (Tasks 3,5,6,12,14,16)
- [ ] Dependencies explicit and acyclic (see graph)
- [ ] Every task touching new production surface carries a `Wired-into:` line
- [ ] Scope: 17 tasks (< 20) — coherent first slice per the complexity doc's scope-discipline note
- [ ] Operator-safety isolation (Story 2 / Tasks 4–5) present before any driver runs
