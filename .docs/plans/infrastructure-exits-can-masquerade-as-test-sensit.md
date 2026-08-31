# Implementation Plan: Infrastructure exits can masquerade as test sensitivity (#2051)

**Date:** 2026-08-30
**Design:** .docs/decisions/adr-2026-08-30-counterfactual-sensitivity-judged-not-exit-coded.md
**Stories:** .docs/stories/infrastructure-exits-can-masquerade-as-test-sensit.md
**Conflict check:** Clean as of 2026-08-30

## Summary

Nine tasks: make the counterfactual preflight's completed nonzero exit a neutral recorded fact,
add the optional engine-validated `counterfactualSensitivity` field to the testQuality result
under contract v3, and teach the reviewer skill the three-state evidence rule.

## Technical Approach

Two seams, both existing. (1) In `build-review-test-quality-preflight.ts`, the completed-run
classification `'red' | 'stayed-green'` becomes `'nonzero-exit' | 'stayed-green'` — a rename with
semantics: `nonzero-exit` asserts only that the process exited nonzero. The mechanical-fault lane
(`infrastructure-failure` with its closed reasons) is untouched. (2) In `build-review-domain.ts`,
the v3 result contract gains an optional top-level `counterfactualSensitivity` field with the
closed vocabulary `supports | indeterminate | not-applicable`, following the `relocationAudit`
pattern exactly: passed through `stampBuildReviewDispatchedCandidate`
(`build-review-coordinator.ts:186`), allowed in the key sets of `build-review-artifacts.ts:58` and
`build-review-aggregate.ts:84`, validated in `finding`-adjacent contract code, excluded from
finding identity, and malformed → envelope reject → `absent` rerun (the same predicate path that
rejects a bad `concernKind` today). No contract version bump, no cache or disposition migration;
the `skills/build-review-test-quality/SKILL.md` edit changes `skillDigest` and re-judges caches
automatically. The vocabulary constant lives beside `BUILD_REVIEW_FINDING_VOCABULARIES` in
`build-review-domain.ts` and is drift-bound to the skill text by extending integrity check 25
(`test/test_harness_integrity.sh:1633`).

Local pattern basis: the `relocationAudit` field (optional provider-owned evidence, engine
pass-through + validation, absent-tolerated) is the binding precedent. Search hints:
`relocationAudit` in `build-review-coordinator.ts`, `build-review-artifacts.ts`,
`build-review-aggregate.ts`; `boundTo` in `build-review-domain.ts` for identity-exclusion traits.
Allowed variation: the new field is result-level (not per-finding), so identity exclusion is
structural rather than a filtered hash input.

## Prerequisites

None — no migrations, no new dependencies.

## Tasks

### Task 1: Rename the completed nonzero classification to a neutral value
**Story:** Story 1 (happy: exit 0 stays `stayed-green`; nonzero recorded descriptively)
**Type:** refactor

**Steps:**
1. Write failing test: a completed nonzero scoped run materializes `classification: 'nonzero-exit'` carrying exit code and bounded excerpt; exit 0 still materializes `stayed-green` with empty excerpt.
2. Verify test fails (RED) — current code produces `'red'`.
3. Implement: in `build-review-test-quality-preflight.ts`, change the completed union member `'red'` to `'nonzero-exit'` (type, ternary at the materialize site, cache-eligibility checks) and update the explanatory comment to cite adr-2026-08-30.
4. Verify test passes (GREEN); fix compile errors in direct consumers by mechanical rename only.
5. Commit: "refactor(build-review): neutral nonzero-exit counterfactual classification".

**Done when:**
- A unit test asserts a completed nonzero run yields `classification: 'nonzero-exit'` with `exitCode` and non-empty `failureExcerpt`, and passes.
- A unit test asserts exit 0 yields `stayed-green` with empty excerpt, and passes.
- The string literal `'red'` no longer appears as a completed-preflight classification value in `src/conductor/src/engine/build-review-test-quality-preflight.ts`.

**Files likely touched:**
- src/conductor/src/engine/build-review-test-quality-preflight.ts — union rename + materialize site
- src/conductor/src/engine/build-review-test-quality-preflight.test.ts — new assertions

**Dependencies:** none

### Task 2: Propagate the neutral value through projection and consumers unchanged
**Story:** Story 1 (negative: projection implies no sensitivity verdict; infra lane byte-identical; stale cache re-judges)
**Type:** negative-path

**Steps:**
1. Write failing tests: `preflightProjection` (build-review-coordinator.ts) forwards the `nonzero-exit` evidence with exit code and excerpt and adds no field implying a verdict; each infrastructure reason (launch/timeout/signal) still maps to `infrastructure-failure` with its existing closed reason.
2. Verify RED where the rename has not yet reached the consumer types.
3. Implement: mechanical type updates in `build-review-coordinator.ts`, `step-runners.ts`, and projection types; no semantic additions.
4. Verify GREEN; run the existing preflight/coordinator suites to prove the mechanical-fault lane behavior is unchanged.
5. Commit: "refactor(build-review): thread neutral classification through projection".

**Done when:**
- Projection tests assert the forwarded evidence carries only descriptive fields (exit code, run kind, selectors, excerpt) for the nonzero case, and pass.
- All pre-existing infrastructure-failure tests pass unmodified.
- `tsc` builds clean with no remaining `'red'` completed-classification references outside historical fixtures.

**Files likely touched:**
- src/conductor/src/engine/build-review-coordinator.ts — projection mapping types
- src/conductor/src/engine/step-runners.ts — cache map type
- src/conductor/src/engine/build-review-projections.ts — evidence type naming

**Dependencies:** 1

### Task 3: Add the counterfactualSensitivity vocabulary and contract validation
**Story:** Story 2 (happy: each member accepted; negative: out-of-vocabulary rejected)
**Type:** happy-path

**Steps:**
1. Write failing tests in the domain contract suite: a v3 testQuality result with `counterfactualSensitivity` of each of `supports`, `indeterminate`, `not-applicable` validates; a result with any other value or a non-string is rejected with a named problem naming the field; a result omitting the field validates.
2. Verify RED.
3. Implement: add a frozen `COUNTERFACTUAL_SENSITIVITY_VOCABULARY` constant beside `BUILD_REVIEW_FINDING_VOCABULARIES` in `build-review-domain.ts`; validate the optional field in the testQuality result parser with normalize-then-validate (trim/lowercase, at-most-one-member match per adr-2026-08-16 D2).
4. Verify GREEN.
5. Commit: "feat(build-review): counterfactualSensitivity closed vocabulary under v3".

**Done when:**
- Contract tests cover all three accepted members, one out-of-vocabulary rejection with a problem message naming `counterfactualSensitivity`, and field-absent acceptance; all pass.
- `CURRENT_BUILD_REVIEW_RUBRIC_CONTRACT_VERSION` remains `'v3'` in the diff.
- The vocabulary constant is exported from `src/conductor/src/engine/build-review-domain.ts` as the single engine-side source.

**Files likely touched:**
- src/conductor/src/engine/build-review-domain.ts — vocabulary + parser
- src/conductor/src/engine/build-review-domain.test.ts — contract tests

**Dependencies:** none

### Task 4: Carry the field through envelope stamping, artifacts, and aggregate
**Story:** Story 2 (happy: accepted result persisted with field unchanged)
**Type:** happy-path

**Steps:**
1. Write failing tests: `stampBuildReviewDispatchedCandidate` passes a provider-supplied `counterfactualSensitivity` through (as it does `relocationAudit`); the artifact and aggregate key allow-lists accept the field so a persisted verdict and the aggregate carry it verbatim; a result without the field persists exactly as today.
2. Verify RED.
3. Implement: extend the pass-through in `build-review-coordinator.ts:186` and the key sets in `build-review-artifacts.ts:58` and `build-review-aggregate.ts:84`, mirroring `relocationAudit`.
4. Verify GREEN.
5. Commit: "feat(build-review): persist counterfactualSensitivity through envelope and aggregate".

**Done when:**
- A round-trip test stamps, validates, persists, and re-reads a result with `counterfactualSensitivity: 'indeterminate'` and finds the field intact; it passes.
- A round-trip test without the field produces byte-identical artifact keys to today's shape; it passes.

**Files likely touched:**
- src/conductor/src/engine/build-review-coordinator.ts — stamp pass-through
- src/conductor/src/engine/build-review-artifacts.ts — key allow-list
- src/conductor/src/engine/build-review-aggregate.ts — key allow-list

**Dependencies:** 3

### Task 5: Malformed field rejects to absent rerun without a cap tick
**Story:** Story 2 (negative: out-of-vocabulary → absent rerun, no kickback, no convergence tick)
**Type:** negative-path

**Steps:**
1. Write failing test at the dispatch/validate-and-repair layer: a candidate whose `counterfactualSensitivity` is out-of-vocabulary is rejected by `validateBuildReviewDispatchedResult`, the branch settles as `absent` (rerun), no kickback route is produced, and the cumulative convergence counter does not increment.
2. Verify RED (or prove the existing envelope-reject path already yields this once Task 3's parser rejects — then this test binds that behavior).
3. Implement: only what the test demands; the existing malformed-result path is expected to carry it.
4. Verify GREEN.
5. Commit: "test(build-review): malformed counterfactualSensitivity reruns as absent".

**Done when:**
- The test asserts rejection → `absent` with no route and an unchanged `rubricFailures` count, and passes.
- No new routing branch exists in the diff — the existing malformed-envelope predicate carries the case.

**Files likely touched:**
- src/conductor/src/engine/build-review-coordinator.test.ts — reject-path test

**Verify-only:** no
**Dependencies:** 3

### Task 6: Finding identity ignores the field; stored dispositions survive
**Story:** Story 2 (negative: disposition still matches; identity unchanged with/without field)
**Type:** negative-path

**Steps:**
1. Write failing-or-binding test: canonical finding ids computed from two otherwise-identical results — one with `counterfactualSensitivity`, one without — are equal; a stored disposition keyed on the old id still matches a finding from a field-bearing result.
2. Verify the assertion is meaningful (mutate the field, ids stay equal).
3. Implement: nothing expected — the field is result-level, outside the finding objects; the test locks the invariant.
4. Verify GREEN.
5. Commit: "test(build-review): counterfactualSensitivity excluded from finding identity".

**Done when:**
- The identity-equality test across field-present/absent/varied results passes.
- The disposition-match test against a pre-change id passes.

**Files likely touched:**
- src/conductor/src/engine/build-review-domain.test.ts — identity tests

**Verify-only:** yes
**Dependencies:** 3

### Task 7: Indeterminate weighs as nothing in the verdict path
**Story:** Story 3 (happy: indeterminate + no findings passes; indeterminate + evidenced finding stands; negative: no plan-task append, convergence unchanged)
**Type:** happy-path

**Steps:**
1. Write failing-or-binding tests at the branch-settle layer: a valid result with `counterfactualSensitivity: 'indeterminate'` and empty findings settles PASS exactly as an empty-findings result does today; the same value with a well-formed `test-insensitive` finding settles FAIL with that finding intact; repeated indeterminate FAIL laps increment the cumulative bound exactly as today.
2. Verify the assertions bind real behavior (flip the finding presence, verdict flips).
3. Implement: nothing expected — the engine never branches on the field's value; tests lock that neutrality.
4. Verify GREEN.
5. Commit: "test(build-review): indeterminate counterfactual is verdict-neutral".

**Done when:**
- The three settle-layer tests (pass, finding-stands, convergence-increments) pass.
- `grep -r "counterfactualSensitivity" src/conductor/src/engine` shows no engine code path branching on the value `'indeterminate'` outside validation.

**Files likely touched:**
- src/conductor/src/engine/build-review-coordinator.test.ts — settle-layer tests

**Verify-only:** yes
**Dependencies:** 4

### Task 8: Update the reviewer skill contract with the three-state evidence rule
**Story:** Story 4 (both supports shapes and the indeterminate exemplar named; the rule text also serves the third story)
**Type:** happy-path

**Steps:**
1. Edit `skills/build-review-test-quality/SKILL.md`: replace the `red`-supports-sensitivity sentence with the three-state rule — the result includes `counterfactualSensitivity` (`supports | indeterminate | not-applicable`); `supports` covers (a) executed-example failures on the reverted tree and (b) collection/load failures caused by reverted production; `indeterminate` covers environment failure before intended tests bear on behavior (name the #1915 database-auth/boot shapes as the exemplar); `indeterminate` contributes neither sensitivity support nor a finding; a `test-insensitive` finding still requires a concrete stub-passable assertion.
2. Update the result-contract section to show the optional field in the returned JSON object and its closed vocabulary; keep contract v3 and the findings-only-plus-field envelope statement accurate.
3. Update the Verification checklist accordingly.
4. Run `test/test_harness_integrity.sh` frontmatter/vocabulary checks locally.
5. Commit: "docs(skill): three-state counterfactualSensitivity judgement contract".

**Done when:**
- The skill text names both `supports` shapes, the `indeterminate` environment shape with the #1915 exemplar, and the neither-support-nor-finding rule, each in a single locatable sentence.
- The rendered result shape in the skill matches `renderBuildReviewJudgedResultShape` plus the optional field.
- `bash test/test_harness_integrity.sh` passes.

**Files likely touched:**
- skills/build-review-test-quality/SKILL.md — judgement + contract text

**Dependencies:** 3

### Task 9: Bind the vocabulary to the skill text in integrity check 25
**Story:** Story 3 (Done when: engine-side vocabulary drift-checked against skill text)
**Type:** infrastructure

**Steps:**
1. Extend integrity check 25 (`test/test_harness_integrity.sh:1633`) the same way the finding vocabulary is checked: extract the three `counterfactualSensitivity` members from `skills/build-review-test-quality/SKILL.md` and from the exported constant in `build-review-domain.ts`, and fail on any asymmetric difference.
2. Prove the check RED by temporarily perturbing one side locally; restore.
3. Verify `bash test/test_harness_integrity.sh` passes on the real tree.
4. Commit: "test(integrity): bind counterfactualSensitivity vocabulary to skill text".

**Done when:**
- Check 25 fails when either side of the vocabulary is perturbed (demonstrated during authoring) and passes on the committed tree.
- The check compares both directions (member missing from skill; member missing from engine).

**Files likely touched:**
- test/test_harness_integrity.sh — check 25 extension

**Dependencies:** 3, 8

## Task Dependency Graph

```
Task 1 ──▶ Task 2
Task 3 ──▶ Task 4 ──▶ Task 7
Task 3 ──▶ Task 5
Task 3 ──▶ Task 6
Task 3 ──▶ Task 8 ──▶ Task 9
```

## Integration Points

- After Task 4: a full stamped→validated→persisted result round-trip with the new field is testable end-to-end.
- After Task 8: a real testQuality lap exercises the complete judgement contract.

## Coverage

- Story 1 happy → Task 1; Story 1 negatives → Tasks 1 (infra reasons), 2 (projection neutrality, mechanical lane, `tsc`/cache via skillDigest — no migration by design).
- Story 2 happy → Tasks 3, 4; Story 2 negatives → Tasks 3 (out-of-vocabulary), 5 (absent rerun/no tick), 6 (identity/disposition).
- Story 3 happy + negatives → Task 7 (verdict neutrality, convergence), Task 8 (rule text), Task 9 (drift binding).
- Story 4 happy + negatives → Task 8 (both supports shapes, indeterminate shape), Task 7 (supports never itself blocks — settle tests use finding presence, not field value).

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic
