# Implementation Plan: remediate runs a plan-task coverage check before routing to `plan`

**Date:** 2026-08-14
**Stories:** .docs/stories/remediate-routes-buildable-review-gaps-to-plan-hal.md
**Complexity:** `.docs/complexity/remediate-routes-buildable-review-gaps-to-plan-hal.md` (Tier S)
**Track:** `.docs/track/remediate-routes-buildable-review-gaps-to-plan-hal.md` (technical)
**Conflict check:** Skipped — Tier S
**Refs:** jstoup111/ai-conductor#1550

## Summary

Makes the remediation planner prove that no approved plan task admits a `build_review` gap before
it may disposition that gap to `plan`, and stops the dispatch context from priming it toward a
re-plan. 9 tasks.

## Technical Approach

The reported halt has three verified contributing causes; the fix addresses all three and touches
nothing else in the routing machinery.

- **The planner has no `build_review` contract.** `skills/remediate/SKILL.md` §1 lists four
  trigger inputs (`prd-audit`, `architecture-review-as-built`, `test-failures`,
  `build-stall-question`) and §3's disposition table has no `build_review` row;
  `agents/remediation-planner.md` likewise names only prd-audit / as-built / finish. §4's `id`
  rule therefore has no format for a build_review gap, which is why the reported run serialized
  them under the `test:<stem>` format borrowed from the finish-test-failure trigger. Tasks 1 adds
  the trigger entry and its id format to both surfaces.

- **Nothing requires a coverage check before `plan`.** The only guidance is "functionality that
  **is in scope** but the plan simply omitted or missed" (SKILL.md §3, planner §"Calibration"),
  which the planner satisfied with "the approved task must be re-planned rather than sending
  another baseline-passing test to BUILD" — without ever checking whether an existing task's
  RED/GREEN steps already admitted a stronger discriminating test. They did: the operator closed
  both gaps with ordinary commits under existing Tasks 11 and 25. Tasks 2–4 add the coverage
  requirement, the rationale-must-cite-tasks rule, and the fact that `plan` is terminal.

- **The dispatch primes for a re-plan.** `conductor.ts:7457` sends "The plan task **may be
  under-decomposed**" as the planner's `retryReason`, naming re-planning as the hypothesis before
  the planner reads any evidence. The planner also cannot execute a coverage check reliably: a
  daemon worktree's `.docs/plans/` holds every plan merged from main alongside this feature's, and
  `getActivePlanPath()` (`conductor.ts:2646`, returns `string | null`, already fails soft) is only
  called *after* dispatch at `conductor.ts:2455`. Tasks 7–9 fix the wording and hoist the path
  resolution to the call site.

Deliberately **not** changed, and asserted as such:

- `decide-entry-policy.ts` — `UNGRANTABLE_STEP = 'plan'` (line 29) refused autonomous entry
  correctly and is the intended terminal state for a genuine planning gap (operator rule,
  2026-08-09). Desired outcome 2 depends on it staying intact.
- `readRemediationPlan` (`artifacts.ts:3420`) and the `remediation.json` shape — the coverage
  evidence travels in the existing free-text `rationale`, which already reaches the operator via
  `remediationEvidence` (`conductor.ts:2577`) and `renderDecideEntryHalt`'s `Evidence:` line. No
  new field, no new `.pipeline/` file, no new event-union member.
- `buildReviewFailRoute` (`build-review-disposition.ts:275`) — routing a completeness/scope FAIL
  to `remediate` is correct; only what the planner does with it changes.
- The validation-group dispatch context (`conductor.ts:4996`) and every other `planRemediation`
  caller.

Sequencing: the two prompt surfaces first (Tasks 1–4) because they define the contract the tests
assert; then the regression guards that pin what must not move (Tasks 5–6); then the engine call
site (Tasks 7–9). Both prompt surfaces are gated artifacts, so `test/test_harness_integrity.sh`
runs on every task that edits them. Engine tests run with vitest from `src/conductor`, per repo
convention.

## Prerequisites

None. No migration, no new dependency, no schema change. The new contract assertions extend the
existing pattern in `src/conductor/test/acceptance/remediation-authority-routing.acceptance.test.ts`,
which reads both prompt surfaces from disk and regex-asserts their content.

## Tasks

### Task 1: Both planner surfaces carry a `build_review` trigger entry and gap-id format
**Story:** Story 1 (happy path — build_review trigger entry)
**Type:** happy-path

**Steps:**
1. Write failing test in a new acceptance spec: for each of `skills/remediate/SKILL.md` and
   `agents/remediation-planner.md`, assert the text names `build_review` as a dispatching trigger,
   names its evidence input (the build_review verdict artifact), and specifies the gap-id format
   for a build_review gap. Assert the id format is distinct from the finish-test-failure
   `test:<stem>` form.
2. Verify test fails (RED)
3. Implement: add a `build_review` bullet to SKILL.md §1's input list and a matching id rule to
   §4's `id` field rules; add the trigger to the planner agent's "Context Expectations".
4. Verify test passes (GREEN); run `test/test_harness_integrity.sh`
5. Commit with message: "feat(remediate): give build_review gaps a trigger contract and id format"

**Files likely touched:**
- `skills/remediate/SKILL.md` — §1 input list, §4 id rules
- `agents/remediation-planner.md` — Context Expectations
- `src/conductor/test/acceptance/remediate-plan-coverage-check.acceptance.test.ts` — new spec

**Dependencies:** none

### Task 2: Both surfaces require a plan-task coverage check before any `plan` disposition
**Story:** Story 1 (happy path — coverage check precedes `plan`)
**Type:** happy-path

**Steps:**
1. Write failing test: for each surface, assert the text requires examining the approved plan's
   existing tasks before selecting `plan`, and states that a gap whose remedy is admitted by an
   existing task is `build`.
2. Verify test fails (RED)
3. Implement: add the coverage rule to SKILL.md §3's judgment rules and to the planner agent's
   Calibration section, scoped explicitly to the `plan` disposition.
4. Verify test passes (GREEN); run `test/test_harness_integrity.sh`
5. Commit with message: "feat(remediate): require a plan-task coverage check before routing to plan"

**Files likely touched:**
- `skills/remediate/SKILL.md` — §3 judgment rules
- `agents/remediation-planner.md` — Calibration
- `src/conductor/test/acceptance/remediate-plan-coverage-check.acceptance.test.ts` — new assertions

**Dependencies:** Task 1

### Task 3: Both surfaces classify a baseline-passing test needing strengthening as `build`
**Story:** Story 1 (happy path — tautology-shaped gap is build work)
**Type:** happy-path

**Steps:**
1. Write failing test: for each surface, assert the `build` guidance names the concrete shape from
   the reported incident — a changed test that passes against the baseline and must be
   strengthened within an existing task's RED/GREEN steps — and classifies it as `build`, not a
   planning miss.
2. Verify test fails (RED)
3. Implement: add the worked example to SKILL.md §3's `build` row guidance and to the planner
   agent's Calibration, as a positive/negative example pair matching the file's existing style.
4. Verify test passes (GREEN); run `test/test_harness_integrity.sh`
5. Commit with message: "feat(remediate): classify a baseline-passing test gap as build work"

**Files likely touched:**
- `skills/remediate/SKILL.md` — §3 judgment rules
- `agents/remediation-planner.md` — Calibration
- `src/conductor/test/acceptance/remediate-plan-coverage-check.acceptance.test.ts` — new assertions

**Dependencies:** Task 2

### Task 4: A `plan` rationale must cite the examined task ids, and `plan` is declared terminal
**Story:** Story 2 (happy path — coverage evidence recorded, `plan` is a terminal HALT)
**Type:** happy-path

**Steps:**
1. Write failing test: for each surface, assert (a) a `plan` disposition's `rationale` must name
   the specific plan task id(s) examined and why none admits the fix, and (b) the text states that
   in a daemon run a `plan` disposition is a terminal needs-human HALT — the daemon never
   re-plans — so `plan` is a last-resort route chosen on proof.
2. Verify test fails (RED)
3. Implement: extend SKILL.md §4's `rationale` field rule and §3's `plan` row; add the same two
   rules to the planner agent's Calibration and Output Format sections. Add the matching
   Verification checkbox to SKILL.md.
4. Verify test passes (GREEN); run `test/test_harness_integrity.sh`
5. Commit with message: "feat(remediate): require coverage evidence in a plan rationale and mark plan terminal"

**Files likely touched:**
- `skills/remediate/SKILL.md` — §3 plan row, §4 rationale rule, Verification
- `agents/remediation-planner.md` — Calibration, Output Format
- `src/conductor/test/acceptance/remediate-plan-coverage-check.acceptance.test.ts` — new assertions

**Dependencies:** Task 3

### Task 5: The existing planning-omission route and the other triggers survive the rewrite
**Story:** Story 1 (negative path — no regression on the `plan` route or sibling triggers)
**Type:** negative-path

**Steps:**
1. Write failing test: assert the pre-existing contract spec
   `remediation-authority-routing.acceptance.test.ts` still passes unmodified, and add assertions
   that each surface still carries its `prd_audit`, as-built architecture, finish-test-failure and
   `build_stall` guidance with its original disposition rules — the coverage requirement narrows
   only when `plan` is reachable and re-routes no other trigger.
2. Verify test fails (RED) if the new guidance has deleted or broadened any of them
3. Implement: reconcile the Task 1–4 edits so the in-scope-omission rule, the two HALT categories,
   and every non-`build_review` trigger rule remain present and unweakened.
4. Verify test passes (GREEN); run the full `src/conductor` suite and `test/test_harness_integrity.sh`
5. Commit with message: "test(remediate): pin the untouched triggers and the planning-omission route"

**Files likely touched:**
- `src/conductor/test/acceptance/remediate-plan-coverage-check.acceptance.test.ts` — regression assertions
- `skills/remediate/SKILL.md` — reconciliation only
- `agents/remediation-planner.md` — reconciliation only

**Dependencies:** Task 4

### Task 6: `plan` is not collapsed into `halt`, and the HALT categories stay exactly two
**Story:** Story 2 (negative path — HALT semantics and verify-claims calibration preserved)
**Type:** negative-path

**Steps:**
1. Write failing test: assert each surface still names exactly `architectural-clarity` and
   `product-scope` as the HALT categories (plus `unanswerable` for stall-questions in SKILL.md),
   still lists `plan` as a routed disposition distinct from `halt`, and still carries the
   verify-claims rule that low confidence about a gap's *nature* is a HALT signal — so a coverage
   claim cannot launder an uncertain gap into `build`. Assert `src/conductor/src/engine/decide-entry-policy.ts`
   contains `UNGRANTABLE_STEP` bound to `plan`.
2. Verify test fails (RED)
3. Implement: adjust the Task 4 wording if it blurred the `plan`/`halt` boundary; make no change to
   `decide-entry-policy.ts`.
4. Verify test passes (GREEN); run the full `src/conductor` suite
5. Commit with message: "test(remediate): pin HALT categories and the autonomous-DECIDE refusal"

**Files likely touched:**
- `src/conductor/test/acceptance/remediate-plan-coverage-check.acceptance.test.ts` — regression assertions
- `skills/remediate/SKILL.md` — wording reconciliation only
- `agents/remediation-planner.md` — wording reconciliation only

**Dependencies:** Task 5

### Task 7: The build_review dispatch stops asserting the plan task is under-decomposed
**Story:** Story 3 (happy path — no re-plan priming)
**Type:** happy-path

**Steps:**
1. Write failing test in a new engine spec: build the `build_review` remediate dispatch context and
   assert it contains no "under-decomposed" claim about the plan task, and that it directs the
   planner to check the approved plan's existing tasks before proposing any plan-level change.
2. Verify test fails (RED)
3. Implement: replace the dispatch string at `conductor.ts:7457-7459` with the coverage-check
   direction. Leave `buildReviewFailRoute` and the surrounding kickback accounting untouched.
4. Verify test passes (GREEN)
5. Commit with message: "fix(conductor): stop priming build_review remediation toward a re-plan"

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — build_review remediate dispatch context
- `src/conductor/test/engine/build-review-remediate-dispatch.test.ts` — new spec

**Dependencies:** Task 4

### Task 8: The build_review dispatch names the active plan path
**Story:** Story 3 (happy path — planner can identify this feature's plan)
**Type:** happy-path

**Steps:**
1. Write failing test: with an `.pipeline/engine-state.json` carrying an `activePlanPath`, assert
   the `build_review` remediate dispatch context includes that path so the planner can identify
   this feature's plan among the merged plans in `.docs/plans/`.
2. Verify test fails (RED)
3. Implement: resolve `getActivePlanPath()` at the `build_review` call site and interpolate the
   path into the dispatch context before `planRemediation` is called.
4. Verify test passes (GREEN)
5. Commit with message: "fix(conductor): name the active plan in the build_review remediation dispatch"

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — build_review remediate dispatch context
- `src/conductor/test/engine/build-review-remediate-dispatch.test.ts` — new assertions

**Dependencies:** Task 7

### Task 9: A missing plan path degrades cleanly and no sibling dispatch is disturbed
**Story:** Story 3 (negative path — null plan path, sibling call sites unchanged)
**Type:** negative-path

**Steps:**
1. Write failing test: with no `.pipeline/engine-state.json` (so `getActivePlanPath()` returns
   `null`), assert the dispatch context is still built, still carries the coverage-check
   direction, omits the path, and neither throws nor blocks the remediation dispatch. Add a second
   assertion that the validation-group dispatch context (`conductor.ts:4996`) is unchanged.
2. Verify test fails (RED)
3. Implement: guard the interpolation on a non-null path; confirm no edit reached the
   validation-group call site.
4. Verify test passes (GREEN); run the full `src/conductor` suite and `test/test_harness_integrity.sh`
5. Commit with message: "fix(conductor): degrade the build_review remediation dispatch on a missing plan path"

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — build_review remediate dispatch context
- `src/conductor/test/engine/build-review-remediate-dispatch.test.ts` — negative-path assertions

**Dependencies:** Task 8

## Task Dependency Graph

```text
Task 1 ── Task 2 ── Task 3 ── Task 4 ─┬─ Task 5 ── Task 6
                                      └─ Task 7 ── Task 8 ── Task 9
```

## Integration Points

- After Task 4: both machine-consumed planner surfaces carry the complete new contract — a
  build_review gap has an id format, a `plan` disposition requires proven coverage, and `plan` is
  declared terminal. The reported misrouting is closed at the prompt layer.
- After Task 6: the guards that keep the fix from over-reaching are in place — the untouched
  triggers, the two HALT categories, and the autonomous-DECIDE refusal are all pinned by tests.
- After Task 9: the dispatch the planner actually receives matches the contract it is held to, and
  degrades cleanly when the plan path cannot be resolved.

## Coverage Mapping

| Story | Acceptance criteria | Tasks |
|---|---|---|
| Story 1 | happy: coverage check precedes `plan`, covered gap → `build` | 2 |
| Story 1 | happy: baseline-passing test is `build` work | 3 |
| Story 1 | happy: `build_review` trigger entry + gap-id format | 1 |
| Story 1 | negative: in-scope-omission route survives; other triggers unchanged | 5 |
| Story 2 | happy: `plan` rationale cites examined task ids | 4 |
| Story 2 | happy: `plan` is a terminal needs-human HALT | 4 |
| Story 2 | happy: evidence travels the existing halt path, no new channel | 4, 6 |
| Story 2 | negative: `plan` not collapsed into `halt`; HALT categories unchanged | 6 |
| Story 2 | negative: verify-claims calibration still governs an uncertain gap | 6 |
| Story 3 | happy: dispatch drops the under-decomposed priming | 7 |
| Story 3 | happy: dispatch carries the active plan path | 8 |
| Story 3 | negative: null plan path degrades cleanly | 9 |
| Story 3 | negative: validation-group dispatch context unchanged | 9 |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task (each is an explicit task)
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies are explicit and acyclic
- [ ] No terminal catch-all validation task
- [ ] `decide-entry-policy.ts` is not in any task's Files set
