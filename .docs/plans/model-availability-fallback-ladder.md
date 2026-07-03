# Implementation Plan: Model Availability Probe + Fallback Ladder

**Date:** 2026-07-03
**Design:** adr-2026-07-03-reactive-model-fallback-ladder (APPROVED); .docs/architecture/model-availability-fallback-ladder.md
**Stories:** .docs/stories/model-availability-fallback-ladder.md (Accepted, TS-1..TS-6)
**Conflict check:** Clean as of 2026-07-03 (.docs/conflicts/2026-07-03-model-availability-fallback-ladder.md)
**Source:** jstoup111/ai-conductor#186

## Summary

Reactive model-unavailable detection in `ClaudeProvider` plus a per-process fallback
ladder that degrades invocations in-attempt instead of HALTing. 16 tasks.

## Technical Approach

- **Detection (execution/):** `InvokeResult` gains `modelUnavailable?: boolean`.
  `ClaudeProvider.invoke()` sets it when subprocess output matches a narrowly-anchored
  `MODEL_UNAVAILABLE_RE` (known CLI/API signatures: `model not found`, `invalid model`,
  API `not_found_error` naming the model). Precedence: missing-binary and rate-limit
  results are returned unchanged and never set the flag.
- **Policy (engine/model-availability.ts, NEW):** a `ModelAvailability` class holding a
  per-process `Set<string>` of dead models (exact-string keys) plus the ladder. API:
  `effectiveModel(configured): {model, downgraded}` (pre-invoke cache consult),
  `invokeWithLadder(provider, options): InvokeResult` (the walk: on
  `modelUnavailable` → mark dead, advance to next live ladder entry — starting after
  the failed model's ladder position, or the first live entry for off-ladder models —
  warn, re-invoke; exhausted → return last failure). Warnings go through an injected
  `warn(line)` sink (default `console.warn`) carrying configured model, actual model,
  reason.
- **Config:** top-level `model_fallback_ladder?: string[]` on `HarnessConfig`
  (types/config.ts), validated in `validateConfig` (config.ts): must be an array of
  non-empty strings; `[]` is valid (no fallback); malformed → path-specific
  `ConfigError`. Default `['fable', 'opus', 'sonnet']` lives in
  `model-availability.ts` as `DEFAULT_MODEL_FALLBACK_LADDER`.
- **Wiring (engine/step-runners.ts):** `DefaultStepRunner` constructs one
  `ModelAvailability` from `options.config` (process-lifetime — the runner lives as
  long as the process). `runAutonomous` routes `provider.invoke` through
  `invokeWithLadder`; the collaborative path substitutes
  `effectiveModel(resolved.model)` before `invokeInteractive`. **`conductor.ts` diff
  is empty** — exhausted ladder surfaces as today's ordinary failure.
- **Sequencing:** types → detection → config → cache/walk → wiring → docs. Tests are
  vitest, colocated with existing test layout; run via `rtk proxy npx vitest run`
  (worktree needs its own `npm install` in `src/conductor`).

## Prerequisites

- `cd src/conductor && npm install` (fresh worktree has no node_modules).
- No migrations, no new dependencies.

## Tasks

### Task 1: Add `modelUnavailable` to the provider result type
**Story:** TS-1 Done-When 1
**Type:** infrastructure
**Steps:**
1. Add `modelUnavailable?: boolean` to `InvokeResult` in `src/execution/llm-provider.ts` with a doc comment (detection meaning + who consumes it).
2. Typecheck passes (`npx tsc --noEmit` in src/conductor).
3. Commit: "feat(conductor): add modelUnavailable flag to InvokeResult (#186)"
**Files:** src/conductor/src/execution/llm-provider.ts
**Dependencies:** none

### Task 2: Detect model-unavailable signatures in ClaudeProvider
**Story:** TS-1 happy path
**Type:** happy-path
**Steps:**
1. Failing test (claude-provider.test): stub execa result exiting non-zero with `API Error: 404 {"type":"error","error":{"type":"not_found_error","message":"model: claude-bogus"}}` → expect `modelUnavailable: true`, `success: false`. Second case: stderr `Invalid model name: bogus` → flag set.
2. RED, then implement `MODEL_UNAVAILABLE_RE` in claude-provider.ts (anchored alternatives: `not_found_error.{0,80}model`, `model not found`, `invalid model( name)?`, case-insensitive) applied to combined output; set flag in the returned result.
3. GREEN. Commit: "feat(conductor): detect model-unavailable failures in ClaudeProvider (#186)"
**Files:** src/conductor/src/execution/claude-provider.ts (+ its test file)
**Dependencies:** Task 1

### Task 3: Negative paths — detection must not false-positive
**Story:** TS-1 negative paths
**Type:** negative-path
**Steps:**
1. Failing tests: (a) ordinary failure output containing the word "model" in prose (e.g. `error: model output truncated mid-stream`) → flag NOT set; (b) rate-limit output (`429 overloaded`) → `rateLimited: true`, `modelUnavailable` NOT set; (c) exit 127/ENOENT → existing "provider not found" result unchanged, flag NOT set.
2. RED (tighten regex if (a) matches), GREEN.
3. Commit: "test(conductor): model-unavailable detection non-match negative paths (#186)"
**Files:** src/conductor/src/execution/claude-provider.ts test file (regex tweaks in source if needed)
**Dependencies:** Task 2

### Task 4: Real-binary smoke test for the detection regex
**Story:** TS-1 Done-When 3
**Type:** negative-path
**Steps:**
1. Add a guarded smoke test (same guard pattern as existing real-binary smokes — skips when the real `claude` binary/env kill-switch is absent): run `claude --model definitely-not-a-model-xyz -p ping --print`, assert the captured output matches `MODEL_UNAVAILABLE_RE` (export the regex or a `detectsModelUnavailable(output)` helper for the test).
2. Run it once for real to confirm the actual CLI error text matches; record the observed text in the test comment.
3. Commit: "test(conductor): real-binary smoke for model-unavailable signature (#186)"
**Files:** src/conductor/src/execution/ (smoke test file alongside existing smokes)
**Dependencies:** Task 2

### Task 5: `model_fallback_ladder` config key + validation
**Story:** TS-5 happy + malformed negative
**Type:** infrastructure
**Steps:**
1. Failing tests (config.test): valid list accepted; `[]` accepted; string value rejected; list with number rejected; list with `""` rejected — each with a path-specific error mentioning `model_fallback_ladder`.
2. RED; add `model_fallback_ladder?: string[]` to `HarnessConfig` (types/config.ts) and a `validateModelFallbackLadder` block in `validateConfig` (config.ts) following the existing block-validator shape.
3. GREEN. Commit: "feat(conductor): model_fallback_ladder config key + validation (#186)"
**Files:** src/conductor/src/types/config.ts, src/conductor/src/engine/config.ts (+ test)
**Dependencies:** none

### Task 6: ModelAvailability cache — mark/skip/exact-keying
**Story:** TS-3 happy paths + exact-string negative
**Type:** happy-path
**Steps:**
1. Failing tests (new model-availability.test): fresh instance → `effectiveModel('fable')` = fable, not downgraded; after `markDead('fable')` → `effectiveModel('fable')` = first live ladder entry with `downgraded: true`; `markDead('opus')` does not affect a full opus model-ID string; new instance re-allows all (restart semantics).
2. RED; implement `ModelAvailability` (ladder from config ?? `DEFAULT_MODEL_FALLBACK_LADDER = ['fable','opus','sonnet']`, `Set<string>` dead-cache, `effectiveModel`, `markDead`).
3. GREEN. Commit: "feat(conductor): ModelAvailability per-process cache (#186)"
**Files:** src/conductor/src/engine/model-availability.ts (NEW) + test
**Dependencies:** Task 5 (config type for ladder source)

### Task 7: Ladder walk — happy passthrough and single downgrade
**Story:** TS-2 happy paths
**Type:** happy-path
**Steps:**
1. Failing tests with an injected fake provider recording invocation models: (a) configured model succeeds → exactly one invoke, configured model, zero warn lines; (b) fable→modelUnavailable, opus→success → sequence [fable, opus], result success, fable marked dead.
2. RED; implement `invokeWithLadder(provider, options)` on ModelAvailability.
3. GREEN. Commit: "feat(conductor): in-attempt ladder walk on model-unavailable (#186)"
**Files:** src/conductor/src/engine/model-availability.ts + test
**Dependencies:** Tasks 1, 6

### Task 8: Walk negative — unavailable at every ladder position
**Story:** TS-2 negative path 1 (#186 mandated)
**Type:** negative-path
**Steps:**
1. Failing parameterized test: for each position p in the 3-model ladder, models before/at p unavailable, next live succeeds → success, sequence walks exactly the expected prefix.
2. GREEN. Commit: "test(conductor): ladder walk at every position (#186)"
**Files:** model-availability.test
**Dependencies:** Task 7

### Task 9: Walk negative — full exhaustion returns last failure
**Story:** TS-2 negative path 2; TS-4 exhaustion output
**Type:** negative-path
**Steps:**
1. Failing test: all ladder models modelUnavailable → result is the LAST failure (`success: false`), no throw, no extra invocations beyond one per live model, and the returned output (or appended context) names every model tried.
2. GREEN. Commit: "feat(conductor): exhausted ladder surfaces ordinary failure naming models tried (#186)"
**Files:** model-availability.ts + test
**Dependencies:** Task 7

### Task 10: Walk negative — off-ladder configured model
**Story:** TS-2 negative path 3
**Type:** negative-path
**Steps:**
1. Failing test: configured model `claude-fable-5-custom` (not on ladder) → modelUnavailable → walk falls to ladder's first live entry; sequence [claude-fable-5-custom, fable, ...] as applicable.
2. GREEN. Commit: "test(conductor): off-ladder configured model falls to first live entry (#186)"
**Files:** model-availability.test (impl tweak if needed)
**Dependencies:** Task 7

### Task 11: Walk negative — only modelUnavailable advances the walk
**Story:** TS-2 negative path 4
**Type:** negative-path
**Steps:**
1. Failing test: fable→modelUnavailable, opus→rateLimited → result is the rate-limited result (flag intact for the step-runner's existing handling), opus NOT marked dead, no further walk to sonnet. Also: ordinary failure on opus → returned as-is, no walk.
2. GREEN. Commit: "test(conductor): rate-limit/ordinary failures do not advance ladder (#186)"
**Files:** model-availability.test
**Dependencies:** Task 7

### Task 12: Downgrade warning format + empty-ladder behavior
**Story:** TS-4 happy paths; TS-5 empty-ladder negative (#186 mandated)
**Type:** negative-path
**Steps:**
1. Failing tests: (a) reactive downgrade emits one warn line containing `fable`, `opus`, and a reason phrase (assert all three fields verbatim format); (b) `effectiveModel` substitution emits the same-format warning; (c) happy path emits zero warn lines; (d) ladder `[]` → modelUnavailable failure returned unchanged, nothing marked, no walk, no warn beyond the failure itself.
2. GREEN. Commit: "feat(conductor): loud three-field downgrade warnings; empty ladder = no fallback (#186)"
**Files:** model-availability.ts + test
**Dependencies:** Tasks 6, 7

### Task 13: Wire ladder into runAutonomous
**Story:** TS-2 Done-When 1/3
**Type:** happy-path
**Steps:**
1. Failing test (step-runners.test, injected provider): autonomous step with fable-dead provider → step succeeds on opus, one attempt; all-dead → step returns ordinary `{success:false}` that the existing retry path consumes (assert no new result fields needed by conductor).
2. RED; construct `ModelAvailability` in `DefaultStepRunner` (from `options.config`), route `runAutonomous`'s invoke through `invokeWithLadder`.
3. GREEN; assert `git diff --stat src/conductor/src/engine/conductor.ts` is empty.
4. Commit: "feat(conductor): route autonomous invocations through fallback ladder (#186)"
**Files:** src/conductor/src/engine/step-runners.ts + test
**Dependencies:** Tasks 7, 12

### Task 14: Interactive path pre-invoke cache consult
**Story:** TS-3 negative path 1
**Type:** negative-path
**Steps:**
1. Failing test: mark fable dead via a prior autonomous downgrade (or directly on the runner's availability), then dispatch a collaborative step → `invokeInteractive` receives the substituted live model and the substitution warning fired.
2. RED; substitute `effectiveModel(resolved.model)` in the collaborative branch of `run()`.
3. GREEN. Commit: "feat(conductor): interactive dispatch consults availability cache (#186)"
**Files:** src/conductor/src/engine/step-runners.ts + test
**Dependencies:** Task 13

### Task 15: Documentation sweep
**Story:** TS-6
**Type:** infrastructure
**Steps:**
1. README.md + src/conductor/README.md: fallback behavior, config key, default ladder, restart semantics, log location. HARNESS.md Model Selection: REPLACE #189's interim-fallback note with the ladder documentation (keep `--model` documented as an override). CHANGELOG `[Unreleased]` Added entry citing #186.
2. Verify doc claims against shipped defaults (grep the constant).
3. Commit: "docs: model fallback ladder — README/HARNESS/CHANGELOG (#186)"
**Files:** README.md, src/conductor/README.md, HARNESS.md, CHANGELOG.md
**Dependencies:** Tasks 5–14 (documents final behavior)

### Task 16: Full validation
**Story:** all Done-Whens
**Type:** infrastructure
**Steps:**
1. `rtk proxy npx vitest run` in src/conductor — full suite green.
2. `test/test_harness_integrity.sh` — passes (HARNESS.md edits validated).
3. Confirm `conductor.ts` diff empty; confirm zero behavior change path (Task 7a test) still green.
**Files:** none (verification)
**Dependencies:** all

## Task Dependency Graph

```
T1 ─► T2 ─► T3
      T2 ─► T4
T5 ─► T6 ─► T7 ─► T8, T9, T10, T11
      T6,T7 ─► T12 ─► T13 ─► T14 ─► T15 ─► T16
                (T1..T12 feed T13)
```

## Integration Points

- After Task 13: end-to-end autonomous step with a dead configured model completes on a
  downgraded model in one attempt — the core #186 acceptance criterion is demonstrable.
- After Task 14: both dispatch paths honor the cache.

## Verification

- [ ] All happy path criteria covered (T2, T6, T7, T12a, T13)
- [ ] All negative path criteria covered (T3, T4, T8, T9, T10, T11, T12d, T14; malformed config T5)
- [ ] No task exceeds 5 minutes
- [ ] Dependencies explicit and acyclic
- [ ] conductor.ts untouched (asserted in T13/T16)
