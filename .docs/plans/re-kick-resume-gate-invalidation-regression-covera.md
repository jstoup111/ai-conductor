# Implementation Plan: Re-kick resume gate invalidation regression coverage

**Date:** 2026-09-05
**Source:** jstoup111/ai-conductor#2046
**Stories:** .docs/stories/re-kick-resume-gate-invalidation-regression-covera.md
**Conflict check:** No blocking conflicts identified; Small composer route skips the separate conflict-check artifact.

## Summary

One verification task completes the existing daemon resume telemetry's missing regression coverage. Production emission is already implemented; the task must add the requested documenting tests, not manufacture a runtime change to obtain RED.

## Technical Approach

Extend `src/conductor/test/engine/daemon-rekick.test.ts`, following its `post-rebase build pre-verify` block. Reuse `initFeatureRepo`, `advanceBaseWithCode`, local Git identity, per-test temporary directory, typed `ConductorEventEmitter`, and awaited cleanup. These fixtures invoke the real `resumeRebaseFirst` entry point over an actual local rebase and already isolate third parties. Add typed listeners before invoking resume and assert a hand-written expected gate set, not an expectation computed by the production classifier under test.

For `initFeatureRepo(['1'], ['1'])` plus `advanceBaseWithCode`, the feature owns `src/task-1.ts` and the delta is foreign `src/sibling.ts`. With `ranManualTest: true`, current classification invalidates `manual_test` and `test_suite`, and preserves `build_review`, `prd_audit`, and `architecture_review_as_built`. Preserve successful mechanical `build` verification with a deterministic injected `preVerify` response limited to that gate. Budget-specific `test_suite` preservation remains covered by the existing named test.

The preserved event's ordinary justification is its `surface` and `deltaConsidered`; its optional `basis` field specifically identifies drift-budget preservation. Do not require that optional budget marker on ordinary preserved gates, or change the schema to add it. Assert concrete declared feature surface and empty matched delta where the current feature-runtime and feature-codetest variants define those fields; for `prd_audit`, assert a nonempty declared surface and an array of considered paths, preserving its current extended stories/PRD-input contract. This task proves existing emissions reach resume callers; it does not redefine the emitter's per-surface payload semantics.

The operator explicitly approved this existing-payload boundary on 2026-09-05 and requested a separate intake follow-up for the PRD-audit metadata defect if needed. Do not broaden this plan to repair that payload; this specification has no dependency on the follow-up.

## Prerequisites

None. The required runtime and real-local-Git test seams are present on main. No new dependency, installed service, daemon session, or runtime mutation is needed. GitHub blocked-by lookup returned an empty list. The advisory overlap scan found historical spec branches touching this shared test module, but identified no prerequisite for this additive fixture-local coverage.

## Tasks

### Task 1: Cover the actual resume gate event stream and prove emission-loss sensitivity

**Story:** 1, H1–H3 and N1–N2
**Type:** verification
**Verify-only:** yes
**Files:** src/conductor/test/engine/daemon-rekick.test.ts
**Dependencies:** none

**Steps:**

1. In the existing post-rebase build pre-verify block, add a focused test named `emits every judged gate decision and mechanical re-verification on resume`. Reuse the single-task feature fixture and foreign-base runtime addition. Add typed listeners collecting full invalidated, preserved, and reverified event payloads. Keep the real Git/rebase/classifier/emitter path; inject only deterministic verifier behavior, returning `{ done: true }` for `build` and no success for other gates. Stop immediately when `resumeRebaseFirst` returns and await fixture cleanup.
2. Assert `rebased`; assert exactly one invalidated record each for `manual_test` and `test_suite`, each justified by `src/sibling.ts`. Assert exactly one preserved record each for `build_review`, `prd_audit`, and `architecture_review_as_built`, with their preservation payloads as described above. Assert the `build` reverified record has `skippedDispatch: true`. Reject duplicates, contradictory event types for any gate, and judged-gate events for `build`. Do not call `classifyGateInvalidation` to generate expected results, and do not directly invoke `emitGateInvalidationEvents` in the test.
3. Run the new test with the existing budget-preserved and fingerprint-reverified tests through `ai-conductor scoped-run src/conductor/test/engine/daemon-rekick.test.ts`. Existing runtime behavior should pass immediately; this is a declared verification task and not a claim of feature RED.
4. Establish N1's sensitivity in an isolated temporary checkout: omit only the `emitGateInvalidationEvents` invocation in `resumeRebaseFirst`, run the same scoped tests, and record that the new invalidated/preserved assertions fail for missing records while mechanical re-verification remains intact. Restore the exact production source and rerun green. The temporary mutation is evidence, not a committed production change. Halt if the failure is unrelated or if genuine runtime work is needed; do not widen this task.
5. Run the repository's typecheck that includes test files and required verification for this test-only change. Commit only the documenting test changes with a message such as `test: cover gate decision events on daemon resume (#2046)`.

**Done when:**

- The named direct resume test passes with exactly the fixture's two invalidated and three preserved gates, required payload checks, and the successful mechanical `build` re-verification event.
- The existing `records a rebase_gate_reverified event for test_suite when its current fingerprint skips dispatch` and `inspects a budget-preserved test suite once and carries its basis into the preserved event` tests retain their assertions and pass.
- The isolated missing-emission mutation produces assertion failures in the new invalidated/preserved event checks, and the restored source passes; the committed diff changes only the declared test module.
- Scoped verification and test-inclusive typechecking pass; no test reaches an LLM, GitHub, network service, or full conductor lifecycle.

## Coverage and verified claims

Task 1 owns all five Story 1 criteria through one direct resume integration test, existing budget/fingerprint cases, and its contained emission-loss mutation. It is the sole owner of the resume-to-emitter integration proof; there is no terminal aggregate-validation task. `Verify-only` declares existing production behavior, not permission to omit the missing regression test.

Verified against current `daemon-rekick.ts`, `rebase.ts`, `gate-invalidation.ts`, and `daemon-rekick.test.ts`: the resume emission exists, the named fixture performs an actual local rebase, and only budget-specific preservation/reverified records currently have resume assertions. No unconfirmed implementation assumption remains. Verify-claims: CLEAR.
