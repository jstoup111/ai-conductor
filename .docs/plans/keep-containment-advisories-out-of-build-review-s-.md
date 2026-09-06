# Implementation Plan: Keep containment advisories out of build_review's failure reason

**Date:** 2026-09-06
**Stories:** .docs/stories/keep-containment-advisories-out-of-build-review-s-.md
**Track:** technical
**Complexity:** S
**Conflict check:** Small-tier formal check skipped; the scoped intent conforms to the existing containment contract — the floor stays advisory, fail-soft, and verdict-free, and the graded aggregate is still read from its published artifact rather than from step output.

## Summary

Three bounded tasks deliver #1651. A pure ordering helper decides where the containment floor's advisory lines sit inside the `build_review` step output, the runner's existing advisory closure delegates to it, and the gate documentation records the rule. Retry budget policy, the floor's own checks, per-lap deduplication of the advisory recording, and any future enforcing containment mode are outside this slice.

## Technical Approach

The defect is placement, not classification. The advisory block in the `build_review` runner is wrapped in a catch-all and never assigns `success`, so it cannot itself cause a retry; what it does is prepend its rendered lines to every string output, including a failed one. The conductor then assigns that whole output to the step's last-error text and to the next attempt's retry hint, and the daemon renders it — raw on the failure line, and collapsed and truncated to a single 120-character line on the retry line. The result is that an operator reading a failed lap sees an advisory where the review's own reason belongs, and the retried attempt is told the advisory was the previous failure.

Add one exported pure function beside the existing advisory renderer that takes the review output, the rendered advisory lines, and whether the review outcome passed or failed, and returns the composed text: advisory lines first for a passing outcome, preserving today's visibility on a lap an operator is not triaging; the review output first and the advisory lines after a blank line for a failing outcome, so the first line and the truncated single-line reason both name the real cause while the advisory stays in the persisted record and the retry hint. An empty advisory list returns the review output unchanged in both directions. The helper takes and returns plain strings so it stays free of any step-result type and cannot introduce an import cycle into the floor module.

Change the runner's advisory closure to call that helper with the result's own success flag instead of concatenating inline. Keep the existing non-string-output guard exactly as it is, keep the closure's success value untouched, and keep the warning-log loop that already writes each rendered line ahead of the review dispatch. Nothing else in the runner moves: the floor still runs once per invocation under the same configuration opt-in, still writes its report artifact, and still fails soft.

Prove the operator-visible half at the formatter that produces it. The single-line reason formatter is already an exported pure function with its own test file, so a fixture built from a composed failing output asserts the visible text under both the short and the truncated case without touching the daemon renderer.

Tests follow the repository's test-authoring rules. The ordering helper is a table-driven unit case set. The runner behavior uses the existing injectable review-coordinator seam in the step-runner test file with a temporary directory, an injected log sink, and containment enforcement switched on in the injected configuration; because the temporary directory is not a Git work tree the floor takes its own fail-soft path and yields a skip-note advisory, so no repository fixture, no provider call, and no network access is required. Tests may vary fixture builders and assertion grouping; they must preserve the observable boundary proof. No exact-copy pattern declaration applies.

Documentation upkeep: the gate explanation page already describes the containment floor at this gate and is the canonical page for this behavior, so it gains the placement rule in the same change.

## Preconditions and claim ledger

- Operator approved Small scope, the append-on-failure choice, the technical track, and both stories on 2026-09-06 (delegated).
- Verified: `src/conductor/src/engine/step-runners.ts:2641-2735` renders the floor report, logs each line as a warning, and applies a closure that prepends the lines to any string output regardless of success.
- Verified: `src/conductor/src/engine/per-task-commit-floor.ts:291-302` exports the report renderer, and `:139-147` returns a skip-note advisory whenever the floor cannot run, which is the reachable advisory in a non-Git temporary directory.
- Verified: `src/conductor/src/engine/conductor.ts:9021-9042` assigns the runner output to the step's last-error text and to the retry hint.
- Verified: `src/conductor/src/daemon-cli.ts:2565` prints the failure line from that text raw, and `:2581` prints the retry line through the formatter in `src/conductor/src/engine/format-retry-line.ts`, which collapses newlines and truncates at 120 characters.
- Verified: the graded aggregate consumed at `src/conductor/src/engine/conductor.ts:8971-8982` is read from the published verdict artifact, not from step output, so output ordering cannot move a verdict.
- Verified: `src/conductor/src/engine/resolved-config.ts:818-820` resolves the containment opt-in from the `build_review` configuration block, and `src/conductor/test/engine/step-runners.test.ts:3749-3780` already injects a review coordinator and a configuration block through the same runner options.
- Verified: `src/conductor/test/engine/per-task-commit-floor.test.ts` and `src/conductor/test/engine/format-retry-line.test.ts` both exist and own their subjects.
- Scope check: harness-repo-only engine diagnostics; no skill addition; provider-agnostic. Event spine: no channel added, existing step result text only.
- Verify-claims verdict: CLEAR. The one claim the issue makes that the code does not support — that the advisory consumes retry budget — is recorded as a misattribution in the track marker and is deliberately not implemented as a retry-policy change.

## Tasks

### Task 1: Order the advisory lines around the review output
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/src/engine/per-task-commit-floor.ts, src/conductor/test/engine/per-task-commit-floor.test.ts
**Dependencies:** none

**Steps:**
1. Write table-driven unit cases beside the existing report-renderer cases for a passing outcome with advisories, a failing outcome with advisories, an empty advisory list under each outcome, a multi-line review output, and an empty review output.
2. Establish RED, then implement the exported pure composer described in the technical approach: advisory lines then a blank line then the review output for a passing outcome, the review output then a blank line then the advisory lines for a failing outcome, and the review output returned unchanged when the advisory list is empty.
3. Assert in the failing-outcome cases that the composed text starts with the review output's first line, and in the passing-outcome cases that it starts with the first advisory line.
4. Run the scoped test file and the repository typecheck target that covers test files, then commit the focused change.

**Done when:**
1. Unit cases prove a failing outcome composes the review output ahead of every advisory line and a passing outcome composes them in the opposite order.
2. Unit cases prove an empty advisory list returns the review output byte-for-byte under both outcomes.
3. The composer takes and returns plain strings and imports no step-result type.

### Task 2: Apply the ordering in the build_review runner
**Story:** Story 1
**Story:** Story 2
**Type:** happy-path
**Files:** src/conductor/src/engine/step-runners.ts, src/conductor/test/engine/step-runners.test.ts
**Dependencies:** 1

**Steps:**
1. Extend the existing build_review dispatch fixtures with a case that switches the containment opt-in on in the injected configuration, injects a log sink, and injects a review coordinator returning a failing result whose output is a recognizable review reason. Establish RED on the composed output order.
2. Add a companion fixture with the same configuration and a passing injected coordinator, and a third with the opt-in off, to pin the passing order and the untouched-output case.
3. Change the runner's advisory closure to delegate to the Task 1 composer, passing the result's own success flag. Preserve the existing non-string-output guard, the untouched success value, and the warning-log loop.
4. Assert the captured warning log still contains every rendered advisory line, and assert the returned success value equals the injected coordinator's success value in both directions.
5. Run the scoped test file and the repository typecheck target that covers test files, then commit the focused change.

**Done when:**
1. The failing-coordinator fixture observes the injected review reason at the head of the returned output with the advisory text present after it.
2. The passing-coordinator fixture observes the advisory text ahead of the injected review output.
3. The opt-in-off fixture observes the injected output returned unchanged, and a result with a non-string output is returned without an output field being synthesized.
4. The captured warning log contains each rendered advisory line, and the returned success value equals the injected result's success value in both fixtures.

### Task 3: Prove and document the operator-visible reason
**Story:** Story 2
**Type:** negative-path
**Files:** src/conductor/test/engine/format-retry-line.test.ts, docs/explanation/gates.md
**Dependencies:** 1

**Steps:**
1. Add reason-formatter cases built from a composed failing output: one whose review reason fits the single-line budget, and one whose review reason alone exceeds it so the visible text is truncated.
2. Establish RED against a composed output that leads with an advisory, then confirm GREEN once the Task 1 composer supplies the failing order.
3. Assert in both cases that the formatted text begins with the review reason and contains no advisory prefix.
4. Add the placement rule to the containment paragraph of the gate explanation page: the advisory is recorded in the warning log and in the step output on every lap, and on a failing lap it follows the step's own reason so the failure and retry lines name the real cause.
5. Run the scoped test file and the repository typecheck target that covers test files, then commit the focused change.

**Done when:**
1. A formatter case built from a composed failing output whose reason fits the budget returns text beginning with the review reason.
2. A formatter case whose review reason alone exceeds the budget returns truncated text that still begins with the review reason and carries no advisory prefix.
3. The gate explanation page states that an advisory follows the step's own reason on a failing lap and precedes the output on a passing one.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given the containment floor produced advisory lines and the review result succeeded, when the build_review step returns, then the advisory lines precede the review output so a passing lap still reports them. | 1, 2 | "The passing-coordinator fixture observes the advisory text ahead of the injected review output." | diff-local |
| Story 1 happy: Given the containment floor produced advisory lines and the review result failed, when the build_review step returns, then the review's own failure reason opens the output and the advisory lines follow it. | 1, 2 | "The failing-coordinator fixture observes the injected review reason at the head of the returned output with the advisory text present after it." | diff-local |
| Story 1 negative: Given the containment floor produced no advisory lines, when the build_review step returns a passing or a failing review result, then the output is that review result's output unchanged. | 1, 2 | "Unit cases prove an empty advisory list returns the review output byte-for-byte under both outcomes." | diff-local |
| Story 1 negative: Given advisory lines are attached to a review result, when the build_review step returns, then the returned success value is exactly the review result's success value. | 2 | "The captured warning log contains each rendered advisory line, and the returned success value equals the injected result's success value in both fixtures." | diff-local |
| Story 1 negative: Given a review result carries no string output, when advisory lines exist, then the step returns that result without synthesizing an output field. | 2 | "The opt-in-off fixture observes the injected output returned unchanged, and a result with a non-string output is returned without an output field being synthesized." | diff-local |
| Story 2 happy: Given a failed build_review output carrying advisory lines, when the daemon formats its single-line retry reason, then the visible text names the review's own failure rather than an advisory. | 3 | "A formatter case built from a composed failing output whose reason fits the budget returns text beginning with the review reason." | diff-local |
| Story 2 happy: Given the containment floor produced advisory lines, when the build_review step runs, then every advisory line is still written to the runner's warning log. | 2 | "The captured warning log contains each rendered advisory line, and the returned success value equals the injected result's success value in both fixtures." | diff-local |
| Story 2 negative: Given a failed build_review output whose own reason is longer than the single-line reason budget, when the daemon formats the retry reason, then the truncated text still begins with the review reason and never with an advisory. | 3 | "A formatter case whose review reason alone exceeds the budget returns truncated text that still begins with the review reason and carries no advisory prefix." | diff-local |

## Test dispositions and integration ownership

All criteria are diff-local against controlled fixtures. Task 1 owns the pure ordering unit cases. Task 2 owns the runner-level integration through the existing injectable review-coordinator seam, including warning-log capture and success preservation. Task 3 owns the operator-visible reason at the exported formatter and the documentation sentence. No fixture reaches a provider, a network service, or a real repository clone, and no aggregate suite run is added as a task. No terminal validation task is added.

## Task Dependency Graph

Task 1 -> Task 2
Task 1 -> Task 3
