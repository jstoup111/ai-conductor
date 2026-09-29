# Implementation Plan: Prompt operator review on non-clean as-built verdicts

**Date:** 2026-09-28
**Stories:** .docs/stories/prompt-operator-review-on-non-clean-as-built-verdi.md
**Track:** technical
**Complexity:** S
**Conflict check:** Small-tier formal check skipped; the change narrows one step's conditional review signal source and leaves the typed as-built verdict contract, remediation routing, validation-group join, and every other step's marker contract intact.

## Summary

Three bounded tasks deliver #2698 under the operator's option A decision (2026-09-28): a typed-verdict review decision beside the verdict reader, the conditional review gate branching onto it for the as-built step, and corrected reference text for the review mode. BLOCKED and undelivered PLAN_GAP verdicts never reach the gate and are out of scope; auto mode is unchanged.

## Technical Approach

Add two exports to `src/conductor/src/engine/as-built-verdict-store.ts`. `asBuiltVerdictRequiresReview(verdict)` is a pure function returning false only for verdict `APPROVED` and true for `APPROVED WITH DRIFT NOTES`, `PLAN_GAP`, and `BLOCKED` (the last is unreachable at the gate but kept total over the verdict union). `asBuiltReviewRequired(worktree)` calls `readAsBuiltVerdict` and returns true for `absent` and `unreadable` results and `asBuiltVerdictRequiresReview(value.verdict)` for `present`. Failing toward review is the conventional default for a conditional gate that cannot read its evidence.

In `src/conductor/src/engine/conductor.ts`, inside the existing success-path artifact review gate (entered only when `this.mode !== 'auto'`), the `conditional` branch sets `shouldPrompt` from `asBuiltReviewRequired(this.projectRoot)` when `step.name === 'architecture_review_as_built'`, and keeps the `.pipeline/review-required-<step>` existence check for every other step. The as-built step writes and reads no marker file. Approval recording, rejection re-run, and marker cleanup stay as they are. Auto mode never enters the gate, so the daemon path is untouched without any new mode check.

Update the review-mode descriptions that name the marker as the only conditional signal: the `DEFAULT_STEP_REVIEW` comment in `resolved-config.ts`, the `ReviewMode` doc comment in `types/config.ts`, the `conditional` row in `docs/reference/models.md`, and the `review-required-<step>` row in `docs/reference/artifacts.md` (drop the as-built step from the marker's observed list).

Tests: the decision is unit-tested with real temporary directories and the real `persistAsBuiltVerdict` writer, no mocks. Gate behavior is proven in the existing `as-built-typed-verdict-audit-gaps.acceptance.test.ts` harness, which runs the real Conductor serial walk with a faithful fake StepRunner and a spy `onReviewArtifacts`; its `seedSerial` fixture already dispatches only the as-built step. The S6.6 case there currently pins never-prompting and is rewritten to the approved behavior while keeping its no-marker-file assertion. No real LLM, network, or GitHub call is made.

## Preconditions and claim ledger

- Operator approved option A, the Small tier, the technical track, and both stories on 2026-09-28.
- Verified: `conductor.ts` line 13543 gates artifact review on `this.mode !== 'auto'`; its conditional branch checks only the `review-required-${step.name}` marker.
- Verified: `resolved-config.ts` line 92 sets `architecture_review_as_built: 'conditional'`.
- Verified: `conductor.ts` line 8021 engages the validation group only in auto mode, so the non-auto as-built step runs on the serial walk.
- Verified: the `architecture_review_as_built` predicate in `artifacts.ts` line 3425 returns done only for outcomes `approved` and `plan-gap-delivered`; BLOCKED and undelivered PLAN_GAP never reach the success-path gate.
- Verified: `as-built-verdict-store.ts` exports `readAsBuiltVerdict` (absent, unreadable, present), `persistAsBuiltVerdict`, and `asBuiltOutcome`; the PLAN_GAP variant carries `outcomeDelivered` and `affectedOutcome`.
- Verified: `as-built-typed-verdict-audit-gaps.acceptance.test.ts` provides `seedFixture`, `seedSerial`, `persist`, and `conductorFor` (auto by default, overridable to mode default), and its S6.6 case asserts no review callback for a drift-notes verdict.
- Verified: `conductor.test.ts` contains the conflict_check marker prompt, no-prompt, and cleanup cases that pin the unchanged marker contract.
- Verified: `types/config.ts`, `docs/reference/models.md`, and `docs/reference/artifacts.md` describe the conditional mode as marker-only.
- Scope check: repository-only engine mechanism; no skill addition; provider-agnostic. Event-spine: no new event or channel.
- Verify-claims verdict: CLEAR.

## Tasks

### Task 1: Derive the as-built review decision from the typed verdict
**Story:** Story 1 (negative path)
**Type:** negative-path
**Files:** src/conductor/src/engine/as-built-verdict-store.ts, src/conductor/test/engine/as-built-review-required.test.ts (new)
**Dependencies:** none

**Steps:**
1. Write the new unit test file. Using mkdtemp worktrees and the real persistAsBuiltVerdict writer, assert asBuiltReviewRequired returns false for APPROVED and true for APPROVED WITH DRIFT NOTES, delivered PLAN_GAP, undelivered PLAN_GAP, and BLOCKED; returns true when no verdict file exists; and returns true when the verdict file holds invalid JSON. Assert asBuiltVerdictRequiresReview directly over the same verdict kinds.
2. Verify RED.
3. Implement both exports as described in Technical Approach, reusing readAsBuiltVerdict.
4. Verify GREEN with the scoped run for this file and commit.

**Done when:**
1. The unit test shows asBuiltReviewRequired returns false for a persisted APPROVED verdict and true for persisted APPROVED WITH DRIFT NOTES, PLAN_GAP (delivered and undelivered), and BLOCKED verdicts.
2. The unit test shows asBuiltReviewRequired reports review required for an absent verdict file and for an unreadable verdict file.

### Task 2: Prompt from the typed verdict at the as-built conditional review gate
**Story:** Story 1
**Story:** Story 2
**Type:** happy-path
**Files:** src/conductor/src/engine/conductor.ts, src/conductor/test/acceptance/as-built-typed-verdict-audit-gaps.acceptance.test.ts
**Dependencies:** 1

**Steps:**
1. In the acceptance test, rewrite the S6.6 case and add sibling cases using seedFixture, seedSerial, persist, and conductorFor with mode default and daemon false, a spy onReviewArtifacts returning approved, and fromStep architecture_review_as_built: drift-notes verdict, delivered PLAN_GAP verdict, clean APPROVED verdict. Add one auto-mode case (conductorFor defaults) with a drift-notes verdict and the same spy.
2. Verify RED for the drift-notes and delivered PLAN_GAP non-auto cases.
3. In the conditional branch of the success-path artifact review gate, use asBuiltReviewRequired for the as-built step and keep the marker-file check for every other step.
4. Verify GREEN for the acceptance file and the conflict_check marker cases in conductor.test.ts through scoped runs, then commit.

**Done when:**
1. Non-auto acceptance: a drift-notes verdict invokes onReviewArtifacts exactly once for architecture_review_as_built and no review-required-architecture_review_as_built file exists afterward.
2. Non-auto acceptance: a delivered PLAN_GAP verdict invokes onReviewArtifacts exactly once for architecture_review_as_built.
3. Non-auto acceptance: a clean APPROVED verdict never invokes onReviewArtifacts for architecture_review_as_built and state records architecture_review_as_built as done.
4. Auto-mode acceptance: a drift-notes verdict never invokes onReviewArtifacts and state records architecture_review_as_built as done.
5. The existing conflict_check marker prompt, no-prompt, and cleanup cases in conductor.test.ts pass unchanged, so other conditional steps still prompt on their marker file.

### Task 3: Describe the typed-verdict signal in review-mode references
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/src/engine/resolved-config.ts, src/conductor/src/types/config.ts, docs/reference/models.md, docs/reference/artifacts.md
**Dependencies:** 2

**Steps:**
1. Replace the DEFAULT_STEP_REVIEW comment for architecture_review_as_built with one stating the prompt is derived from the typed verdict for non-clean verdicts.
2. Extend the ReviewMode conditional description and the models.md conditional row to name the as-built exception.
3. Remove the as-built step from the observed list of the review-required marker row in artifacts.md and note that the as-built step uses its typed verdict instead.
4. Commit.

**Done when:**
1. No text in resolved-config.ts, types/config.ts, docs/reference/models.md, or docs/reference/artifacts.md says the as-built step signals review with a review-required marker file.
2. types/config.ts and docs/reference/models.md each state that the as-built step's conditional review is derived from its typed verdict.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a non-auto run with the as-built step's review mode conditional, when the as-built step completes with an APPROVED WITH DRIFT NOTES verdict, then the operator review callback is invoked once for the as-built step and no review-required marker file is written. | 2 | "Non-auto acceptance: a drift-notes verdict invokes onReviewArtifacts exactly once for architecture_review_as_built and no review-required-architecture_review_as_built file exists afterward." | diff-local |
| Story 1 happy: Given a non-auto run with the as-built step's review mode conditional, when the as-built step completes with a PLAN_GAP verdict whose outcome is delivered, then the operator review callback is invoked once for the as-built step. | 2 | "Non-auto acceptance: a delivered PLAN_GAP verdict invokes onReviewArtifacts exactly once for architecture_review_as_built." | diff-local |
| Story 1 negative: Given a non-auto run with the as-built step's review mode conditional, when the as-built step completes with a clean APPROVED verdict, then the operator review callback is not invoked for the as-built step and the step is recorded done. | 2 | "Non-auto acceptance: a clean APPROVED verdict never invokes onReviewArtifacts for architecture_review_as_built and state records architecture_review_as_built as done." | diff-local |
| Story 1 negative: Given the typed as-built verdict is absent or unreadable, when the as-built review decision is evaluated, then it reports that review is required. | 1 | "The unit test shows asBuiltReviewRequired reports review required for an absent verdict file and for an unreadable verdict file." | diff-local |
| Story 2 happy: Given an auto-mode run, when the as-built step completes with an APPROVED WITH DRIFT NOTES verdict, then the operator review callback is not invoked and the step is recorded done. | 2 | "Auto-mode acceptance: a drift-notes verdict never invokes onReviewArtifacts and state records architecture_review_as_built as done." | diff-local |
| Story 2 negative: Given a non-auto run and a conditional step other than the as-built step, when that step completes, then the review prompt still follows the presence of its review-required marker file. | 2 | "The existing conflict_check marker prompt, no-prompt, and cleanup cases in conductor.test.ts pass unchanged, so other conditional steps still prompt on their marker file." | diff-local |

## Test dispositions and integration ownership

All criteria are diff-local against controlled fixtures. Task 1 owns the unit decision, including the absent and unreadable negative path. Task 2 owns the production boundary: the real Conductor serial walk through the success-path artifact review gate to the injected onReviewArtifacts callback, in both non-auto and auto modes, with a faithful fake StepRunner. Existing conductor.test.ts conflict_check cases supply the unchanged marker-contract proof. Task 3 is reference text only. No terminal validation task is added.

## Task Dependency Graph

Task 1 -> Task 2 -> Task 3

Small tier: architecture and coherence artifacts are skipped. No new ADR or amendment is required; this resolves open decision OD-4 of the as-built typed-verdict architecture review.
