# Implementation Plan: when: gating authority aligned with disable: (#1777)

**Date:** 2026-08-30
**Stories:** .docs/stories/when-bypasses-gating-enforcement-while-disable-is-.md
**Conflict check:** Not required (tier S)

## Summary

Close the silent gating bypass: config-load validation rejects `when:` wherever `disable:` is (or should be) rejected — built-in and custom steps — and the `when_skip` event becomes rendered. 4 tasks.

## Technical Approach

All changes live in config validation and the event sink table; no runtime conductor logic changes.

- `src/conductor/src/engine/config.ts` already rejects `disable: true` on built-in structural steps and on gating steps without `configDisableAllowed` (the `Cannot disable` branch near line 681). Extract that predicate into a small local helper (`stepSkipAuthorityError(def)` or similar) and apply it to BOTH `disable: true` and any defined `when:` on built-in steps, producing parallel error messages (`Cannot disable …` / `Cannot condition ${enforcement} step "<name>" with when: …`).
- The custom-step validation branch (near line 630, where `enforcement` is validated) currently never checks `disable:`/`when:` against enforcement. Apply the same predicate there: custom steps have no `configDisableAllowed` opt-in, so `enforcement: gating` or `structural` on a custom step forbids both keys; advisory (explicit or defaulted) allows both.
- `src/conductor/src/engine/event-sinks.ts:82` flips `when_skip` to `render: true` (persist stays true).
- Tests follow the existing table-driven style in `src/conductor/test/engine/config.test.ts` (validation cases asserting `errVal` messages) and `src/conductor/test/engine/event-sinks.test.ts` (sink policy assertions). No test today covers the `Cannot disable` branch, so the new rejection tests establish that coverage alongside the `when:` cases.

Sequencing: built-in rejection first (establishes the shared predicate), custom steps second (reuses it), render flag last (independent).

## Prerequisites

- None — pure engine edits on existing files.

## Tasks

### Task 1: Reject when: on non-disableable built-in steps
**Story:** Story 1
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/config.test.ts`: a config with `steps.build_review.when: "tier == 'S'"` fails validation with an error naming `build_review`, `when`, and `gating`; a config with `steps.rebase.when: "x == 'y'"` fails naming `rebase` and `structural`; a config with `steps.build_review.when` set to a tautologically-true expression (e.g. `"'a' == 'a'"`) still fails (rejection is enforcement-based, never evaluated); configs with `steps.manual_test.when`, `steps.prd_audit.when`, and `steps.explore.when` all pass validation.
2. Verify tests fail (RED).
3. Implement in `src/conductor/src/engine/config.ts`: extract the enforcement predicate used by the `Cannot disable` branch into a shared helper and apply it to `cfg.when !== undefined` on built-in steps, alongside the existing `disable` use.
4. Verify tests pass (GREEN).
5. Commit: "fix(config): reject when: on non-disableable built-in steps"

**Done when:**
- Config validation returns an error for `when:` on every built-in structural step and every built-in gating step whose definition lacks `configDisableAllowed: true`; the error names the step, the `when` key, and the enforcement level
- `manual_test`, `prd_audit`, and advisory built-ins with `when:` validate successfully (asserted by named tests in `src/conductor/test/engine/config.test.ts`)
- The rejection tests fail against pre-change `config.ts`
- The `disable:` and `when:` checks share one enforcement predicate (single helper referenced by both call sites in the diff)

**Files likely touched:**
- src/conductor/src/engine/config.ts — shared skip-authority predicate applied to `when:` on built-ins
- src/conductor/test/engine/config.test.ts — rejection and allowed-case tests

**Dependencies:** none

### Task 2: Enforce skip authority for when: on custom steps
**Story:** Story 2
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/config.test.ts`: a custom step with `enforcement: gating` plus `when:` fails validation with the Task 1 error shape; a custom step with `enforcement: structural` plus `when:` fails; a custom step with `enforcement: advisory` plus `when:` passes.
2. Verify tests fail (RED).
3. Implement in the custom-step branch of `validate` in `src/conductor/src/engine/config.ts`, reusing the Task 1 helper for `when:`; custom steps have no `configDisableAllowed`, so gating and structural both forbid the key.
4. Verify tests pass (GREEN).
5. Commit: "fix(config): reject when: on gating and structural custom steps"

**Done when:**
- A custom step declared `enforcement: gating` or `enforcement: structural` fails validation when it carries `when:`, with the same error shape as built-ins
- A custom step with `enforcement: advisory` carrying `when:` validates successfully (asserted by a named test)
- The custom-step `when:` rejection tests fail against pre-change `config.ts`

**Files likely touched:**
- src/conductor/src/engine/config.ts — custom-step branch applies the shared predicate to `when:`
- src/conductor/test/engine/config.test.ts — custom-step when: rejection and allowed-case tests

**Dependencies:** Task 1

### Task 2.1: Enforce skip authority for disable: on custom steps
**Story:** Story 4
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/config.test.ts`: a custom step with `enforcement: gating` plus `disable: true` fails validation with the `Cannot disable` error shape; `enforcement: structural` plus `disable: true` fails naming the enforcement level; a custom step with `enforcement: advisory` plus `disable: true` passes; a custom step with no `enforcement` key (defaults advisory) plus `disable: true` passes.
2. Verify tests fail (RED).
3. Implement in the custom-step branch of `validate` in `src/conductor/src/engine/config.ts`, applying the shared predicate to `disable: true` beside Task 2's `when:` use.
4. Verify tests pass (GREEN).
5. Commit: "fix(config): reject disable: on gating and structural custom steps"

**Done when:**
- A custom step declared `enforcement: gating` or `enforcement: structural` fails validation when it carries `disable: true`, with the same `Cannot disable` error shape as built-ins
- Custom steps with advisory enforcement, explicit or defaulted, carrying `disable: true` validate successfully (asserted by named tests)
- The custom-step `disable:` rejection tests fail against pre-change `config.ts`

**Files likely touched:**
- src/conductor/src/engine/config.ts — custom-step branch applies the shared predicate to `disable:`
- src/conductor/test/engine/config.test.ts — custom-step disable: rejection and allowed-case tests

**Dependencies:** Task 2

### Task 3: Render the when_skip event
**Story:** Story 3
**Type:** happy-path

**Steps:**
1. Write failing test in `src/conductor/test/engine/event-sinks.test.ts` asserting the `when_skip` sink policy is `{ render: true, persist: true }`, following the file's existing policy-assertion style.
2. Verify test fails (RED).
3. Implement: flip `when_skip` to `render: true` in `src/conductor/src/engine/event-sinks.ts` (line 82), leaving `persist`, `audit`, and `otel` unchanged.
4. Verify test passes (GREEN); run the existing renderer suites (`src/conductor/test/engine/daemon-render.test.ts`, `src/conductor/test/ui/when-parallel-renderer.test.ts`) and fix any snapshot/expectation that assumed `when_skip` is unrendered.
5. Commit: "fix(events): render when_skip so conditional skips are visible"

**Done when:**
- `when_skip` in `src/conductor/src/engine/event-sinks.ts` carries `render: true` and `persist: true`
- The sink-policy test fails against pre-change `event-sinks.ts`
- The full conductor unit suite passes, including any renderer tests updated for the newly rendered event

**Files likely touched:**
- src/conductor/src/engine/event-sinks.ts — render flag
- src/conductor/test/engine/event-sinks.test.ts — sink policy test

**Dependencies:** none

## Task Dependency Graph

```
Task 1 ──> Task 2 ──> Task 2.1
Task 3 (independent)
```

## Integration Points

- After Task 2.1: any project config exercising `when:`/`disable:` on gating, structural, and advisory steps (built-in and custom) validates or rejects end-to-end.
- After Task 3: a run whose permitted `when:` evaluates false shows the skip in the conductor log.

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a falsifiable Done-when block
- [ ] Dependencies are explicit and acyclic
