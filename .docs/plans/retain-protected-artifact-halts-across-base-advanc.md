# Implementation Plan: Retain protected-artifact halts across base-advance sweeps

**Date:** 2026-09-05
**Source:** jstoup111/ai-conductor#2199
**Stories:** .docs/stories/retain-protected-artifact-halts-across-base-advanc.md
**Conflict check:** Small-tier exemption; no blocking dependencies found.

## Summary

Two scoped tasks repair seal-halt retention and make the sweep's complete disposition contract compile-time exhaustive. No new runtime dependency or architecture is required.

## Technical Approach

Extend `isOperatorActionHalt` in `src/conductor/src/engine/halt-marker.ts` to include `PROTECTED_ARTIFACT_HALT_CLASS` in both its returned predicate type and value expression. `rekickSweep` already calls that predicate before every retry side effect and already logs the retained disposition, so its runtime structure stays unchanged. Preserve the separate `isStepWrittenHumanHalt` predicate: it serves a different writer behavior and is outside this fix.

Use the injected `fakeDeps` pattern in `src/conductor/test/engine/daemon-rekick.test.ts`: invoke the real sweep, inspect its returned cleared/skipped sets, operation trace, and SHA map, and fake external effects. Broaden only the fixture's reader type to the production `HaltDisposition` type. Reuse the existing retained-halt test for repeated base advances; extend the existing matrix with a literal expectation object constrained by `satisfies Record<HaltDisposition, 'retain' | 'retry'>`. Every writable `HaltClass` is a member of that union, so a future type addition without a matrix entry is a compilation error. Expected outcomes remain test-authored rather than derived from the predicate under test.

Approved seal-rebaseline and provenance-inheritance decisions already require operator review for feature-authored changes. Issue #2199 explicitly settles the missing retry classification. No assumption about a live incident is required: the omitted case and its only production caller are directly verified. No new channel is added; the existing sweep log supplies the requested observation.

## Prerequisites

None beyond the repository's existing test tooling. The issue's dependency endpoint is empty; no matching spec PR or committed feature artifacts existed at screening. The reference to #2190 records discovery provenance, not a prerequisite.

## Tasks

### Task 1: Retain seal halts through the production sweep

**Story:** 1
**Type:** happy-path
**Dependencies:** none

**Steps:**
1. In the existing sweep test fixture, import `HaltDisposition` from the production marker module and use it for the optional reader's resolved type. Extend the existing retained-halt parameterized case to include protected-artifact and plan-gap. Keep Git and filesystem operations injected; use the real sweep and predicate. This existing pattern fits because eligibility precedes every mutation and no real process is needed.
2. Establish RED on protected-artifact: at two different base SHAs the current implementation clears it instead of skipping it. Assert the skip log for each invocation, not merely one matching log across both calls. Preserve assertions that the rebase probe/abort/clear traces are absent and the SHA map is unchanged. `clearMarker` is the existing owner of the sentinel write, so proving it is never invoked proves no sentinel is requested.
3. Add `PROTECTED_ARTIFACT_HALT_CLASS` to `isOperatorActionHalt`'s narrowing return type and boolean expression. Do not change the separate step-writer predicate or rebase/reseal implementation.
4. Run the scoped sweep test to GREEN and commit `fix(halt): retain protected-artifact halts during base advances`.

**Done when:**
- [ ] Through `rekickSweep`, protected-artifact and plan-gap halt fixtures are skipped on both distinct base advances with no clearing, rebase probing/abort, or last-re-kick-SHA change.
- [ ] Each protected-artifact skip log identifies both the feature and its retained disposition; the clear/sentinel owner is never called.
- [ ] The shared predicate's TypeScript narrowing and runtime result both include protected-artifact, while step-writer classification remains unchanged.

**Files:** src/conductor/src/engine/halt-marker.ts, src/conductor/test/engine/daemon-rekick.test.ts

### Task 2: Enforce an exhaustive sweep matrix without widening retention

**Story:** 2
**Type:** negative-path
**Dependencies:** Task 1

**Steps:**
1. Replace the existing four-way matrix in the sweep test with an explicit expectation object: needs-human/plan-gap/protected-artifact/unclassified map to retain, mechanical/legacy map to retry. Constrain it using `satisfies Record<HaltDisposition, 'retain' | 'retry'>`; do not cast away completeness checks or obtain expected values from production classification. Iterate those keys through the existing injected `fakeDeps` pattern and call the real sweep.
2. Keep assertions on exact cleared/skipped sets, per-disposition log entries, actual clear calls, and lastRekickSha updates for retryable members. Exercise both mechanical and legacy under the existing same-SHA bound, ensuring a second sweep at the same SHA does not repeat a clear. The matrix's unclassified row plus existing marker-reader invalid/absent/unreadable-sidecar tests and operator-park/shipped precedence tests cover Story 2 N2.
3. Establish RED for the new exhaustiveness contract by applying the production-union constraint first to the existing four-way expectation object: the test-inclusive typecheck must reject its missing plan-gap and protected-artifact keys. Complete the matrix to reach GREEN. The behavioral matrix also remains sensitive to the original protected-artifact omission, while Task 1 owns the runtime RED proof; do not claim a fresh runtime failure for behavior already repaired by Task 1.
4. Run the affected sweep and marker-reader tests and the test-inclusive typecheck. Commit `test(halt): exhaustively cover retained and retryable dispositions`.

**Done when:**
- [ ] The production sweep's exact retained set is needs-human, plan-gap, protected-artifact, unclassified; its exact retryable set is mechanical, legacy, with clear calls and SHA updates only for those two.
- [ ] Both retryable dispositions obey the existing once-per-SHA bound; existing unreadable/invalid-class and park/shipped precedence cases still prove their named outcomes.
- [ ] Test-inclusive TypeScript checking accepts the complete production-union-keyed expectation object and rejects it with a required class entry omitted; no cast bypasses exhaustiveness.

**Files:** src/conductor/test/engine/daemon-rekick.test.ts

## Coverage

Task 1 owns the changed production boundary integration and Story 1 H1/H2/N1 through real `rekickSweep` with injected side effects. Task 2 owns Story 2 H1/H2/N1 and reuses existing tests for N2. Every criterion is diff-local; no external issue or deployment determines acceptance. There is no terminal aggregate-validation task and no new acceptance/system flow.

## Verify-Claims Ledger

99%, verified: the predicate omits protected-artifact; its only production caller is the sweep; retained cases exit before rebase or clear operations; existing logs interpolate the disposition; the sweep fixture and matrix currently omit two production classes. Sources: `halt-marker.ts`, `daemon-rekick.ts`, and the existing sweep tests. The source issue explicitly requires the target matrix. No unconfirmed load-bearing assumptions remain. Verdict: CLEAR.
