# Implementation Plan: Persist routed-forward build verdict before selection

**Date:** 2026-09-05
**Source:** jstoup111/ai-conductor#2178
**Stories:** .docs/stories/persist-routed-forward-build-verdict-before-select.md
**Conflict check:** No blocking conflicts identified; separate conflict-check artifact skipped on Small composer route.

## Summary

One task durably records the already-authorized routed-forward build verdict and proves next-gate selection observes it. This fixes the repeated-budget loop without altering the meaning of build progress or validation success.

## Technical Approach

In `src/conductor/src/engine/conductor.ts`, `advanceTail` synthesizes verdicts for routed-forward build and completed finish; every other verdict-producing step uses `computeAndWriteVerdict`. Extend the existing synthetic-verdict write condition to cover exactly finish or the current `build && buildRoutedForward` branch. Await `writeVerdict` with the exact synthesized object before the existing `gate_verdict` event and selector. Use the same existing reason/fallback and checkedAt semantics. Replacing the full verdict removes the obsolete kickback payload; do not merge that payload into a positive route decision.

Keep `gateSatisfied`'s verdict-over-state and stale-state precedence intact. Do not infer a route from `state.build_routed_reason` alone, modify `computeAndWriteVerdict`, remove the on-disk verdict, add retry refunds, or weaken downstream review/SHIP checks. Reuse existing transition error handling if the write fails.

For narrow transition coverage, follow the direct `advanceTail` invocation pattern in `src/conductor/test/engine/resume-verdict-clamp.test.ts`, using a typed structural cast, real temporary verdict files, and existing topology fixtures. This exercises actual persistence and selection without completing an entire feature. For the positive loop proof, follow `src/conductor/test/acceptance/build-reports-step-completed-status-done-while-lea.acceptance.test.ts`'s clean-tree budget-exhaustion fixture, using its local Git commits and injected StepRunner. Adapt the setup to the minimum valid pre-build evidence; do not copy unrelated placeholder artifacts. Keep the real retry/advance/selector path, use a faithful fake full-suite verifier, and terminate at the first subsequent build-review dispatch with an expected test-owned halt. The guard must also stop a third build attempt so a regression cannot loop to the global selection cap or timeout.

## Prerequisites

None. Current main contains the route-forward decision, persisted verdict API, selector, and required test patterns. GitHub reports no blocked-by dependencies. Issue is M-labeled but has verified Small scope; no dependency on any other speculative work.

## Tasks

### Task 1: Persist the current forward verdict before emitting and selecting

**Story:** 1, H1–H3 and N1–N3
**Type:** happy-path
**Files:** src/conductor/src/engine/conductor.ts; src/conductor/test/engine/resume-verdict-clamp.test.ts; src/conductor/test/acceptance/build-reports-step-completed-status-done-while-lea.acceptance.test.ts
**Dependencies:** none

**Steps:**

1. Add direct transition regressions using the existing typed `advanceTail` pattern and a temporary project. Seed `build.json` with `satisfied:false`, a rebase kickback, and an old timestamp. Invoke the real routed-forward transition and assert the file becomes satisfied, contains the current route reason and a fresh timestamp, has no obsolete kickback, and selection chooses the next unsatisfied gate. Include the no-existing-file case with the current fallback reason. These assertions establish RED against the missing-write branch.
2. Add one bounded real `Conductor.run()` scenario to the existing clean-tree route fixture: start from build with valid upstream evidence and the negative gate file, keep the plan unresolved, and land a clean unattributed local Git commit in each of two fake build attempts. Configure the retry budget to two. Use the existing fake verifier for the intervening mechanical test-suite gate. At the first build-review dispatch, capture the durable build verdict and emit a test-owned terminal halt; if a third build attempt occurs, halt immediately as a regression guard. Assert exactly two build attempts, subsequent validation reached, and a satisfied persisted route verdict before that dispatch. Await conductor cleanup; do not traverse SHIP, contact third parties, or use a timeout as termination.
3. Extend the synthetic persistence condition in `advanceTail` to exactly `step.name === 'finish' || (step.name === 'build' && buildRoutedForward)`, awaiting the existing `writeVerdict` before successful event emission or selection. Keep the synthesized verdict object and ordinary compute-and-write path unchanged. No new helper or state format is necessary.
4. Add targeted negative transition coverage: without the current route-forward flag, an unsatisfied completion remains negative even if state retains an old route reason. Retain existing selector coverage for stale state and later negative verdict precedence. Inject a rejecting write at the existing storage boundary and assert the transition rejects before successful `gate_verdict` emission or selection; keep existing engine transition-failure handling rather than introducing a new recovery policy. Restore every injected spy/fake after the case.
5. Run `ai-conductor scoped-run` for the two changed test files, test-inclusive typechecking, and required repository verification. Commit with a message such as `fix: persist routed-forward build verdict before gate selection (#2178)`.

**Done when:**

- Direct transition tests prove obsolete negative verdict replacement and no-file creation, including satisfaction, reason, fresh checkedAt, and removal of the obsolete kickback before the next selection.
- The bounded real-loop fixture observes exactly one two-attempt build budget followed by subsequent validation with the persisted satisfied verdict; a third-build guard stops the unfixed failure promptly.
- Ordinary unsatisfied behavior and existing stale/negative selector precedence remain covered, and write failure produces no successful verdict event or forward selection.
- Both changed test modules and test-inclusive typechecking pass, with no altered retry policy, route eligibility, gate selector precedence, or downstream validation authority.

## Coverage and verified claims

Task 1 is the sole owner of the route-decision-to-persisted-verdict-to-selector integration. H1–H2 use the bounded conductor loop; H3 and N1/N3 use direct transition tests; N2 retains sufficient existing selector tests. There is no terminal catch-all task or speculative recovery implementation.

Verified against current `advanceTail`, route-forward flag assignment, `gateSatisfied`, and the named test fixtures: persistence is missing only for the synthetic build verdict; the selector consumes the disk verdict; the approved liveness policy already permits the route. The repair preserves that policy and needs no new ADR. Verify-claims: CLEAR.
