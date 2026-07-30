# Implementation Plan: User-level configuration precedence (#1000)

**Date:** 2026-07-30
**Design:** `.docs/architecture/user-level-config-for-8-keys-is-silently-discarded.md`
**Architecture review:** `.docs/decisions/architecture-review-2026-07-30-user-level-config-precedence.md`
**Stories:** `.docs/stories/user-level-config-for-8-keys-is-silently-discarded.md`
**Conflict check:** Clean as of 2026-07-30

## Summary

Make configuration validation pure and source-aware, then prove the complete precedence and compatibility contract in thirteen short TDD tasks. The production change remains localized to the existing configuration loader; focused tests cover immutable validation, all eight affected keys, malformed values, default materialization, and existing merge/source safeguards.

## Technical Approach

- Clone the validator input deeply before any normalization so successful, warning-producing, fallback, and rejected validation cannot mutate caller-owned values or share mutable nested references with the normalized result. `structuredClone` is already supported by the repository's Node 20 runtime and used elsewhere in the engine.
- Add an internal validation option that controls whether defaults for absent values are materialized. Its default preserves today's runtime-ready `loadConfig` behavior. It is a phase property, not an eight-key allowlist: explicit values are always validated and normalized, while only absent defaults may be deferred.
- In `loadMergedConfig`, read and validate project configuration through the source-aware pre-merge path with absent defaults deferred, deep-merge that explicit project result over user configuration using the existing `mergeConfigs` contract, then validate the merged result with ordinary default materialization enabled.
- Keep project-source protections before the merge. In particular, `spec_owner` remains forbidden in project configuration, and malformed explicit project values continue to reject or normalize/fallback according to their existing contracts instead of exposing an underlying user value.
- Add focused data-driven tests at the narrow configuration boundary. Mock/inject only the user-config file adapter where loader-level coverage requires it; do not run the daemon or contact third parties.

## Prerequisites

- Accepted stories and a clean conflict check are present.
- No schema migration, external service, database, port, or fixture installation is required.

## Tasks

### Task 1: Return a normalized clone for successful validation

**Story:** Story 1 — valid top-level/nested input and absent-default happy paths.
**Type:** happy-path

**Steps:**
1. Write failing tests that snapshot a valid input, validate it, and assert the normalized/defaulted result is correct while the original lacks every injected value.
2. Verify the tests fail because validation currently writes into the supplied object.
3. Deep-clone the validator input before normalization without changing its public result or default behavior.
4. Verify the focused tests pass.
5. Commit with message: `fix: validate config on a clone`.

**Files:** `src/conductor/src/engine/config.ts`, `src/conductor/test/engine/config.test.ts`

**Wired-into:** `src/conductor/src/engine/config.ts#loadConfig`, `src/conductor/src/engine/config.ts#loadMergedConfig`

**Dependencies:** none

### Task 2: Preserve inputs across warnings, fallbacks, and rejection

**Story:** Story 1 — warning normalization, fallback, and unknown-key/malformed rejection paths.
**Type:** negative-path

**Steps:**
1. Write failing regression tests that snapshot inputs before a clamped warning, a documented fallback, and top-level/nested unknown-key rejection.
2. Verify at least one test exposes input mutation while preserving the current warning/result/error assertions.
3. Adjust clone-first validation only where needed so every exit path leaves its input unchanged and retains existing diagnostics.
4. Verify the focused tests pass.
5. Commit with message: `test: preserve config inputs on every validation exit`.

**Files:** `src/conductor/src/engine/config.ts`, `src/conductor/test/engine/config.test.ts`

**Wired-into:** same as Task 1

**Dependencies:** Task 1

### Task 3: Isolate normalized nested references

**Story:** Story 1 — normalized output must not share mutable nested objects with caller input.
**Type:** negative-path

**Steps:**
1. Write a test that mutates nested objects/arrays on the returned configuration after validation and asserts the original nested values and identities remain isolated.
2. Verify the assertion fails if cloning is shallow or skips a nested shape.
3. Harden the clone boundary if any supported nested configuration shape remains shared.
4. Verify the focused test passes.
5. Commit with message: `test: isolate normalized config references`.

**Files:** `src/conductor/src/engine/config.ts`, `src/conductor/test/engine/config.test.ts`

**Wired-into:** same as Task 1

**Dependencies:** Task 2

### Task 4: Defer defaults for absent project values

**Story:** Story 2 — create the source-aware seam required for user-only inheritance.
**Story:** Story 3 — preserve source-specific validation while deferring absent defaults.
**Type:** infrastructure

**Steps:**
1. Write failing direct-validation tests showing a project pre-merge pass omits defaults for absent top-level and nested values but still normalizes an explicitly present value.
2. Verify the tests fail because absent defaults are currently always materialized.
3. Add an internal validation/default-materialization option whose ordinary default is enabled, and guard all absent-value default writes consistently rather than enumerating the issue's eight keys.
4. Verify deferred and ordinary validation modes both pass their focused assertions.
5. Commit with message: `feat: defer absent config defaults before merge`.

**Files:** `src/conductor/src/engine/config.ts`, `src/conductor/test/engine/config.test.ts`

**Wired-into:** `none (inert until src/conductor/src/engine/config.ts)`

**Dependencies:** Task 3

### Task 5: Wire source-aware validation into merged loading

**Story:** Story 2 — wire the corrected project-over-user precedence flow.
**Story:** Story 3 — keep project validation before merge and effective validation after merge.
**Type:** happy-path

**Steps:**
1. Write a failing loader test with a user-only affected value and an otherwise valid project file, asserting the effective result inherits the user value.
2. Verify the test fails because the project load injects a competing default.
3. Refactor the shared project read/validation path so `loadMergedConfig` requests deferred absent defaults, performs the existing project-over-user merge, then performs ordinary merged validation; leave ordinary `loadConfig` on enabled defaults.
4. Verify the loader test and existing configuration tests pass.
5. Commit with message: `fix: merge explicit project config over user config`.

**Files:** `src/conductor/src/engine/config.ts`, `src/conductor/test/engine/config-precedence.test.ts`

**Wired-into:** `src/conductor/src/engine/config.ts#loadMergedConfig`

**Dependencies:** Task 4

### Task 6: Prove all eight user-only precedence cases

**Story:** Story 2 — user-only happy-path matrix for all eight affected keys.
**Type:** happy-path

**Steps:**
1. Add a data-driven table with schema-valid non-default user values for `ci_watch`, `build_review`, `auto_restart_on_stale_engine`, `engine_refresh_min_interval_seconds`, `attribution_audit_sample_pct`, `build_progress_halt`, `kickback_escalation`, and `retry_routing`.
2. For each row, load effective configuration with that key absent from project configuration and assert the user value survives.
3. Verify all eight focused cases pass through the production loader seam.
4. Make only a localized source correction if a key exposes an incomplete phase guard.
5. Commit with message: `test: cover user-only config precedence`.

**Files:** `src/conductor/src/engine/config.ts`, `src/conductor/test/engine/config-precedence.test.ts`

**Wired-into:** same as Task 5

**Verify-only:** yes

**Dependencies:** Task 5

### Task 7: Prove project-only and both-scope precedence cases

**Story:** Story 2 — project-only and distinct both-scope happy paths for all eight affected keys.
**Type:** happy-path

**Steps:**
1. Extend the data table with distinct schema-valid project and user values for each affected key.
2. Add eight project-only assertions and eight both-scope assertions, proving the explicit project value wins and any required normalization remains authoritative.
3. Verify the full minimum 24-case precedence matrix passes.
4. Make only a localized source correction if an explicit project value is accidentally treated as absent.
5. Commit with message: `test: cover explicit project config precedence`.

**Files:** `src/conductor/src/engine/config.ts`, `src/conductor/test/engine/config-precedence.test.ts`

**Wired-into:** same as Task 5

**Verify-only:** yes

**Dependencies:** Task 6

### Task 8: Materialize neither-scope defaults exactly once

**Story:** Story 2 — neither-scope defaults and no duplicate-warning negative path.
**Type:** negative-path

**Steps:**
1. Add data-driven assertions for the existing effective default of each affected key when both scopes omit it.
2. Capture warnings while loading a configuration that exercises a warning-producing normalization and assert the two validation phases do not duplicate a warning solely because both ran.
3. Verify no affected effective value remains undefined and diagnostics retain their existing count/content.
4. Correct only the default phase or validation sequencing if the assertions fail.
5. Commit with message: `test: materialize merged config defaults once`.

**Files:** `src/conductor/src/engine/config.ts`, `src/conductor/test/engine/config-precedence.test.ts`

**Wired-into:** same as Task 5

**Verify-only:** yes

**Dependencies:** Task 7

### Task 9: Reject or normalize malformed user values after merge

**Story:** Story 2 — malformed user-only values must retain the existing error/fallback contract.
**Type:** negative-path

**Steps:**
1. Add representative malformed user-only cases covering one rejecting contract and one warning/fallback contract among the affected keys.
2. Assert merged validation either returns the existing normalized fallback plus warning or rejects with the existing diagnostic; never accept the raw malformed value.
3. Verify the tests pass through `loadMergedConfig`.
4. Fix only a demonstrated gap in the merged validation phase.
5. Commit with message: `test: validate malformed user config after merge`.

**Files:** `src/conductor/src/engine/config.ts`, `src/conductor/test/engine/config-precedence.test.ts`

**Wired-into:** same as Task 5

**Verify-only:** yes

**Dependencies:** Task 5

### Task 10: Keep malformed project policy authoritative

**Story:** Story 2 — malformed or warning-producing explicit project values cannot fall through to a valid user value.
**Story:** Story 3 — rejected project validation cannot return a partial effective configuration.
**Type:** negative-path

**Steps:**
1. Add a rejecting project-value case over a valid user value and assert loading fails before producing an effective configuration.
2. Add a project value with an existing warning/fallback contract over a distinct valid user value and assert the project fallback/result remains authoritative with the current warning.
3. Snapshot both source values and assert neither is mutated on success or failure.
4. Correct only project pre-pass handling if an explicit project value is dropped or laundered.
5. Commit with message: `test: preserve malformed project config authority`.

**Files:** `src/conductor/src/engine/config.ts`, `src/conductor/test/engine/config-precedence.test.ts`

**Wired-into:** same as Task 5

**Dependencies:** Task 5

### Task 11: Preserve object, scalar, and array merge semantics

**Story:** Story 2 — unrelated nested objects merge recursively while project scalars and arrays replace user values.
**Type:** negative-path

**Steps:**
1. Add or extend a focused regression fixture containing unrelated object siblings, a scalar, and an array in both scopes.
2. Assert user-only object members survive, explicit project object members win, and project scalar/array values replace rather than reverse or concatenate.
3. Include partial `build_review` or `ci_watch` blocks to prove per-key normalization does not erase valid sibling values.
4. Verify the current `mergeConfigs` behavior remains unchanged; change production code only if the new validation phase corrupts its inputs or result.
5. Commit with message: `test: preserve merged config shape semantics`.

**Files:** `src/conductor/src/engine/config.ts`, `src/conductor/test/engine/config-precedence.test.ts`

**Wired-into:** same as Task 5

**Verify-only:** yes

**Dependencies:** Task 5

### Task 12: Preserve ordinary project-only defaults

**Story:** Story 3 — ordinary `loadConfig` remains runtime-ready when affected and nested defaulted values are absent.
**Type:** negative-path

**Steps:**
1. Add a direct `loadConfig` regression test asserting representative affected and nested defaults remain identical to the pre-change contract.
2. Contrast it with the deferred project pre-pass assertion so the two entry-path contracts cannot be collapsed accidentally.
3. Verify existing inline/full-suite callers still receive normalized defaults through the unchanged function surface.
4. Correct option defaults or call-site selection if ordinary loading loses defaults.
5. Commit with message: `test: preserve project-only config defaults`.

**Files:** `src/conductor/src/engine/config.ts`, `src/conductor/test/engine/config.test.ts`, `src/conductor/test/engine/config-precedence.test.ts`

**Wired-into:** `src/conductor/src/engine/config.ts#loadConfig`

**Dependencies:** Task 5

### Task 13: Preserve project-source identity protection

**Story:** Story 3 — `spec_owner` rejection remains source-specific, fail-closed, and non-mutating before merge.
**Type:** negative-path

**Steps:**
1. Extend the existing `spec_owner` project-source regression to run through merged loading and assert the established actionable diagnostic.
2. Assert no user value can hide the forbidden project field, no effective configuration is returned, and both inputs remain unchanged.
3. Verify the focused config tests pass without weakening the guard or changing its message.
4. Restore the guard's pre-merge ordering if the refactor moved it.
5. Commit with message: `test: preserve merged config source guards`.

**Files:** `src/conductor/src/engine/config.ts`, `src/conductor/test/engine/config.test.ts`, `src/conductor/test/engine/config-precedence.test.ts`

**Wired-into:** same as Task 5

**Verify-only:** yes

**Dependencies:** Task 5

## Task Dependency Graph

```text
Task 1 -> Task 2 -> Task 3 -> Task 4 -> Task 5
                                           |-> Task 6 -> Task 7 -> Task 8
                                           |-> Task 9
                                           |-> Task 10
                                           |-> Task 11
                                           |-> Task 12
                                           `-> Task 13
```

## Integration Points

- After Task 5: the production merged-loader path exercises pure project validation, established merge precedence, and final effective normalization.
- After Task 8: all 24 mandated precedence cases and all eight neither-scope defaults are covered.
- After Tasks 9–13: malformed values, shape semantics, project-only compatibility, source guards, input immutability, and no-partial-result behavior are covered.

## Coverage Check

| Story | Task(s) | Criterion |
|---|---|---|
| 1 | 1 | Valid/defaulted validation returns normalized output without mutating input. |
| 1 | 2 | Warning normalization and fallback preserve the original. |
| 1 | 2 | Top-level/nested rejection preserves the original and diagnostics. |
| 1 | 3 | Normalized nested output shares no mutable references. |
| 2 | 5, 6 | All eight user-only values survive. |
| 2 | 7 | All eight project-only values apply. |
| 2 | 7 | All eight explicit project values beat distinct user values. |
| 2 | 8 | All eight neither-scope defaults materialize. |
| 2 | 9 | Malformed user-only values retain error/fallback behavior. |
| 2 | 10 | Malformed/normalized project values remain authoritative. |
| 2 | 8 | Defaults and warnings occur once after merge. |
| 2 | 11 | Objects merge; project scalars/arrays replace. |
| 3 | 4, 12 | Ordinary `loadConfig` retains runtime defaults. |
| 3 | 5 | Project validation precedes merge and effective validation follows it. |
| 3 | 4, 10 | Explicit project normalization remains authoritative. |
| 3 | 13 | `spec_owner` remains rejected before merge. |
| 3 | 10, 13 | Rejected project validation returns no partial configuration and mutates neither source. |

## Verification

- [ ] Run `cd src/conductor && npx vitest run test/engine/config.test.ts test/engine/config-precedence.test.ts --reporter=dot --silent`.
- [ ] Run `cd src/conductor && npm run typecheck`.
- [ ] Run `cd src/conductor && npm run typecheck:test`.
- [ ] Run `cd src/conductor && npm run lint`.
- [ ] Run the configured aggregate suite from `src/conductor`: `npm test`.
- [ ] Run the repository-mandated harness validation from the repository root: `test/test_harness_integrity.sh`.
- [ ] Confirm all happy and negative criteria map to the task tree above.
- [ ] Confirm dependencies remain explicit and acyclic and each task stays within the 2–5 minute execution target.
