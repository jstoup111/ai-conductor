# Implementation Plan: Qualify the reported cost figure when it covers only metered dispatches

**Date:** 2026-09-06
**Stories:** .docs/stories/qualify-the-reported-cost-figure-when-it-covers-on.md
**Track:** technical
**Complexity:** S
**Conflict check:** Small-tier formal check skipped; the scoped intent conforms to the existing usage-reporting contract — no fabricated cost, exclusion counts preserved with their present meanings, and cost and token figures still withheld rather than printed as zeros when nothing was measured.

## Summary

Three bounded tasks deliver #1863 by changing how one pure formatter presents its money figure, then proving the change at the boundary where an operator actually reads the line. The rollup arithmetic, the event payload, the per-dispatch provider lines, and the shipped-record Cost block are untouched.

## Technical Approach

The dollars on the whole-feature usage line are summed over the fully-metered dispatches only, while the dispatch count printed beside them counts every dispatch. Both operands of that difference are already on the formatter's input: `meteredDispatches` is every dispatch that reported token usage, and `costUnmeteredDispatches` is the subset of those that reported tokens without a cost. The cost denominator is therefore `meteredDispatches - costUnmeteredDispatches`, clamped at zero because unreadable records inflate the unmetered count independently of the dispatch count. Compute it inside the formatter as a local value; do not add a field to the rollup projection or the event union, because the quantity is derivable from what the payload already carries and a new field would be a schema change for a presentation concern.

Replace the money figure's current gate. Emit the figure only when the cost denominator is above zero, and render it plainly when that denominator equals the recorded dispatch count. When the denominator is below the dispatch count, append a short clause naming the count — a denominator clause worded in the same vocabulary the line already uses for its exclusion segments, singular for one dispatch and plural otherwise, so the three segments read as one family rather than three idioms. Leave the token figures on their existing `meteredDispatches` gate: tokens and dollars genuinely have different denominators, and merging the two gates would suppress token volume that was really measured.

The zero-denominator case is the degenerate end of the same rule and must not print a qualified zero. When every metered dispatch reported tokens but no cost, the money figure is withheld entirely while the token figures and the cost-unmetered segment still render — the same no-fabricated-zeros discipline the line already applies when nothing at all was metered.

Follow the local test pattern this formatter already carries: table-shaped unit cases that build a plain totals value inline and assert the complete rendered string, with a comment naming the misreading each case prevents. Find comparable cases by searching the existing formatter suite for the current exact-line assertions. The rollup-side cases use the seeded temporary event log the existing projection suite already builds, asserting the rendered line beside the projected value so the two can never disagree. The renderer-side case builds a usage event and captures the emitted lines through the injected log sink; it must not launch a conductor run, spawn a process, or reach any third party. Variation in fixture builders and assertion grouping is allowed; what must be preserved is that each case asserts the whole line, not a fragment, wherever the existing case did. No exact-copy pattern declaration applies.

Three existing suites pin the line's exact text and will move with the change: the formatter's own unit suite, the rollup projection suite, and the daemon renderer suite. Their mixed-build cases currently assert an unqualified figure over a partial denominator, which is exactly the misreading being corrected.

## Preconditions and claim ledger

- Operator approved Small scope, the technical track, the presentation-only approach, and both stories on 2026-09-06 (delegated).
- Verified: `formatFeatureUsageTotal` in `src/conductor/src/execution/provider-diagnostics.ts` pushes the money figure and the token figures under a single `meteredDispatches > 0` gate, then appends the cost-unmetered and unmetered segments.
- Verified: `toFeatureUsageTotals` in `src/conductor/src/engine/cost-rollup.ts` derives `meteredDispatches` as the recorded dispatch count minus the unmetered count, clamped at zero, and passes `costUnmetered.count` through as `costUnmeteredDispatches`.
- Verified: `addDispatch` in the same file adds tokens for every non-unmetered dispatch but adds `costUsd` only when the classification is fully-metered, so the dollars cover the metered set less the cost-unmetered set.
- Verified: `classifyMetering` in `src/conductor/src/engine/metering.ts` returns exactly fully-metered, cost-unmetered, or unmetered and never invents a cost.
- Verified: the only callers of the formatter are the daemon event renderer in `src/conductor/src/daemon-cli.ts` and the terminal renderer in `src/conductor/src/ui/terminal-renderer.ts`; both pass the event through unmodified, so no other rendering path needs a change.
- Verified: `src/conductor/test/execution/provider-diagnostics.test.ts`, `src/conductor/test/engine/cost-rollup.test.ts`, and `src/conductor/test/daemon-render-provider-attempt.test.ts` each assert the exact rendered line for at least one partially metered build.
- Verified: `docs/guides/running-the-daemon.md` documents the line's segment order and its partial-cost caveat.
- Scope check: consumer-facing engine behavior; no new skill; provider-agnostic. Event spine: no channel is added, and no event union member or field changes.
- Verify-claims verdict: CLEAR. Every path, symbol, and derivation above was read in the worktree; no load-bearing assumption remains unconfirmed.

## Tasks

### Task 1: Name the cost denominator when it is below the dispatch count
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/src/execution/provider-diagnostics.ts, src/conductor/test/execution/provider-diagnostics.test.ts
**Dependencies:** none

**Steps:**
1. Write failing unit cases in the formatter suite for a fully cost-metered build, a build whose unmetered dispatches reduce the cost denominator, a build whose cost-unmetered dispatches reduce it, and a one-dispatch build. Assert the complete rendered string in each, following the suite's existing table-shaped convention of building a plain totals value inline with a comment naming the misreading the case prevents.
2. Verify the new cases fail (RED) against the current single-gate formatter.
3. Implement the denominator inside the formatter as the metered count minus the cost-unmetered count, clamped at zero, and render the money figure plainly when it equals the recorded dispatch count or with its denominator clause when it is lower. Update the function's doc comment example to show the qualified shape.
4. Update the suite's existing partially metered assertions to the qualified line, leaving the fully metered assertions unchanged.
5. Verify the formatter suite passes (GREEN) and the repository typecheck target that includes test files passes.
6. Commit with message: "fix(usage-line): name the dispatch count the reported cost was summed over"

**Done when:**
1. A fully cost-metered fixture renders the money figure with nothing between it and the token figures.
2. A fixture whose cost-metered count is below its recorded dispatch count renders that count immediately after the money figure.
3. A one-dispatch cost-metered fixture and a many-dispatch fixture agree on singular and plural wording for the denominator clause.
4. No fixture renders a denominator above its own recorded dispatch count.

### Task 2: Withhold the money figure when no dispatch was cost-metered
**Story:** Story 1 (negative path)
**Type:** negative-path
**Files:** src/conductor/src/execution/provider-diagnostics.ts, src/conductor/test/execution/provider-diagnostics.test.ts
**Dependencies:** 1

**Steps:**
1. Write failing unit cases for a build whose dispatches all reported tokens with no cost, and for a build whose unmetered count exceeds its recorded dispatch count because records were unreadable. Assert the absence of a dollar sign and of any negative number, and assert that the token figures and the cost-unmetered segment still render on the first case.
2. Verify the new cases fail (RED) — the current formatter prints a zero money figure for the first and would print a qualified zero after Task 1 alone.
3. Implement the zero-denominator branch so the money figure is omitted while the token gate stays on the metered count, keeping the existing exclusion segments and their wording untouched.
4. Verify the formatter suite passes (GREEN) and the repository typecheck target that includes test files passes.
5. Commit with message: "fix(usage-line): omit the cost figure when nothing was cost-metered"

**Done when:**
1. A fixture whose dispatches all report tokens without a cost renders no dollar sign while still rendering the token figures.
2. That same fixture still renders its cost-unmetered segment with its existing wording.
3. A fixture whose unmetered count exceeds its recorded dispatch count renders no dollar sign and no negative number.
4. The existing case for a build with no metered dispatch at all still renders neither a money figure nor token figures.

### Task 3: Prove the qualified line at the renderer an operator reads
**Story:** Story 2
**Type:** happy-path
**Files:** src/conductor/test/daemon-render-provider-attempt.test.ts, src/conductor/test/engine/cost-rollup.test.ts, docs/guides/running-the-daemon.md
**Dependencies:** 1, 2

**Steps:**
1. Write a failing case in the daemon renderer suite that hands the renderer a whole-feature usage event whose cost-metered dispatches are fewer than its recorded dispatch count, capturing the emitted lines through the suite's existing injected log sink, and a second case for a fully cost-metered event asserting no denominator clause. Do not launch a conductor run, spawn a process, or contact any third party.
2. Update the rollup projection suite's mixed-build case, whose seeded temporary event log yields a partial cost denominator, to assert the qualified line beside the projected value.
3. Verify both suites fail for the expected reason (RED), then run them against the implementation from Tasks 1 and 2 and verify they pass (GREEN).
4. Bring the daemon guide's description of the line's segments and its partial-cost caveat into agreement with the rendered shape, in the same change.
5. Run the repository validation suite and the repository typecheck target that includes test files, and fix any failure.
6. Commit with message: "test(usage-line): pin the qualified cost figure at the daemon renderer"

**Done when:**
1. The daemon event renderer emits one line naming both the money figure and its cost-metered count for a partially cost-metered usage event.
2. The daemon event renderer emits a line with no denominator clause for a usage event whose dispatches were all cost-metered.
3. The rollup projection over a seeded mixed event log yields the same qualified line as the formatter fixtures.
4. The repository validation suite passes.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a build in which every recorded dispatch carried a provider cost, when the whole-feature usage line is composed, then the money figure appears plainly with no added denominator text. | 1 | "A fully cost-metered fixture renders the money figure with nothing between it and the token figures." | diff-local |
| Story 1 happy: Given a build in which fewer dispatches carried a cost than the run recorded, when the whole-feature usage line is composed, then the money figure is immediately followed by the count of cost-metered dispatches it was summed over. | 1 | "A fixture whose cost-metered count is below its recorded dispatch count renders that count immediately after the money figure." | diff-local |
| Story 1 negative: Given a build in which every dispatch reported token usage but none reported a cost, when the whole-feature usage line is composed, then no money figure is rendered while the token figures and the cost-unmetered segment remain. | 2 | "A fixture whose dispatches all report tokens without a cost renders no dollar sign while still rendering the token figures." | diff-local |
| Story 1 negative: Given a build whose unreadable records push the unmetered count above the recorded dispatch count, when the whole-feature usage line is composed, then no money figure is rendered and no negative or invented dispatch count appears. | 2 | "A fixture whose unmetered count exceeds its recorded dispatch count renders no dollar sign and no negative number." | diff-local |
| Story 2 happy: Given a whole-feature usage event whose cost-metered dispatches are fewer than its recorded dispatch count, when the daemon event renderer handles that event, then the logged line carries the money figure with its cost-metered count and leaves the unmetered and cost-unmetered segments unchanged. | 3 | "The daemon event renderer emits one line naming both the money figure and its cost-metered count for a partially cost-metered usage event." | diff-local |
| Story 2 negative: Given a whole-feature usage event in which every recorded dispatch was cost-metered, when the daemon event renderer handles that event, then the logged line carries no denominator clause. | 3 | "The daemon event renderer emits a line with no denominator clause for a usage event whose dispatches were all cost-metered." | diff-local |

## Test dispositions and integration ownership

Every criterion is diff-local: the formatter is a pure function of a value the tests construct, and no commit outside this change can alter whether these lines render as asserted. Task 1 and Task 2 own the unit level, which is the lowest sufficient layer for a pure string composition — Task 1 covers Story 1's happy criteria and Task 2 covers both of its negative criteria, each with its own case rather than one shared assertion. Task 3 is the sole owner of the cross-boundary integration proof: the changed behavior reaches operators through the daemon event renderer, so that renderer is the entry point whose observable output the task asserts, and the rollup projection case proves the same line arises from a real seeded event log rather than only from hand-built values. No third party is contacted at any layer and no aggregate or end-to-end suite is added. No terminal validation task exists; the repository's configured suite and the existing gates validate the completed change.

## Task Dependency Graph

Task 1 -> Task 2 -> Task 3
Task 1 -> Task 3

Small tier: architecture, conflict-check, and coherence artifacts are skipped. No ADR is required and none is amended — the presentation change introduces no channel, no schema change, and no departure from a recorded decision.
