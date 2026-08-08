# Implementation Plan: FINISH refusal reaches the operator with its reason

**Date:** 2026-08-08
**Stories:** .docs/stories/finish-s-stop-gate-does-not-stop-a-correct-refusal.md
**Design:** .docs/decisions/adr-2026-08-08-finish-human-required-halt-rendering.md
**Conflict check:** Clean as of 2026-08-08

## Summary

Fifteen tasks that turn a FINISH `human_required` halt from a bare enum token into operator-facing
prose carrying the blocker's own words, and make the `refused` verdict reachable by publishing the
PR-prose verdict contract to the provider. All work lands in two engine modules and one SKILL.md;
`conductor.ts` is deliberately untouched.

## Technical Approach

**The defect.** `PublicationDisposition`'s `human_required` arm carries `reason: string`, a token
such as `judgment_refused`. `routeFinishPublicationDisposition` passes it through as
`{ kind: 'halt', reason }`, and the conductor writes it verbatim via
`writeHaltMarker(route.reason, 'needs-human')`. The operator reads an identifier. Separately, the
`refused` verdict is unreachable: `/finish` is dispatched with zero arguments, so `SKILL.md` is the
provider's entire instruction set and it never states the `{"kind": ...}` contract — a refusing
provider writes prose, the parser finds no JSON, and post-#1372 it fails closed to
`malformed_response`, which routes to a judgment retry rather than a halt — so the refusal is
spent by the progress allowance and never reaches the operator.

**The seam.** Rendering happens **inside** `routeFinishPublicationDisposition`'s `human_required`
arm, not in a new export the conductor calls. `route.reason` therefore arrives at the existing
`writeHaltMarker` site already in prose form. This is why the plan touches no conductor code and
adds no production entry point: every surface terminates at a caller that exists today.

**Shape of the data.** Three coordinated changes, in dependency order:

1. **Type layer (Tasks 1-2).** `human_required.reason` narrows from `string` to the closed
   ten-token union, so a future token cannot be added without a rendering. `isExactDisposition`'s
   `human_required` arm widens from `hasOnly('kind','reason')` to also accept
   `hasOnly('kind','reason','detail')`, requiring `detail` to be a non-empty string when present.
   The guard stays exact-key — this is a widening of one arm, not a relaxation of the discipline.
2. **Rendering layer (Tasks 3-7).** `HUMAN_REQUIRED_REASONS` mirrors the resident
   `PUBLICATION_CONDITIONS` shape: a `Record` keyed by the reason union yielding
   `{ message, nextAction }`. A `satisfies` annotation makes a missing key a compile error. The
   router composes `message + nextAction + detail`, with a fail-closed generic rendering for a token
   that crosses the `unknown` boundary unresolved.
3. **Provider layer (Tasks 8-13).** `PrProseJudgmentResult`'s `refused` and `revision_required` arms
   gain an optional `detail`; `isPrProseJudgmentResult` validates it; `mapPrProseJudgmentResult`
   forwards it. `SKILL.md` publishes the contract, and a test pins the documented vocabulary to the
   validator so they cannot drift.

**Sequencing rationale.** The type layer is first because every later task compiles against it.
Rendering precedes the provider work because the halt text must be correct for a `detail`-less
disposition before `detail` is introduced — that ordering makes Task 5's output independently
verifiable. The end-to-end marker assertion (Task 14) is last because it is the only task that
observes all three layers at once; it is scoped to one named integration point, not a catch-all
re-validation of the feature.

**Contention note.** `finish-publication.ts` is declared by roughly 29 unmerged spec branches
(conflict check: textual, not semantic). Prefer additive edits and keep hunks tight. Splitting
`HUMAN_REQUIRED_REASONS` into a sibling module is permitted at build discretion but not required.

**Documentation.** Per `/plan`'s documentation boundary this plan carries no documentation task.
The architecture review's Condition 3 was amended in DECIDE: doc upkeep for
`docs/runbooks/stalled-or-stuck-feature.md` and `docs/reference/steps.md` is owned by this
repository's `maintain-documentation` custom step within the same PR.

**Release metadata.** This branch must not write `CHANGELOG.md` or `VERSION`. The release
disposition travels in the PR body per this repository's Release & Update Gates.

## Prerequisites

- No migration, no config key, no new dependency.
- `test/test_harness_integrity.sh` must pass before every commit (repository validation rule).

## Tasks

### Task 1: Narrow the human-required reason to a closed union
**Story:** 1
**Type:** infrastructure

**Steps:**
1. Write failing test: a type-level assertion (or `expectTypeOf`-style check) that
   `{ kind: 'human_required', reason: 'not_a_real_token' }` is not assignable to
   `PublicationDisposition`.
2. Verify test fails (RED) — currently assignable because `reason` is `string`.
3. Implement: introduce a `HumanRequiredReason` union of exactly the ten tokens and change the
   `human_required` arm at the `PublicationDisposition` declaration to use it. Adjust any of the
   fifteen construction sites the compiler now rejects.
4. Verify test passes and `npm run typecheck` is clean (GREEN).
5. Commit with message: "types: close the FINISH human-required reason union"

**Files likely touched:**
- src/conductor/src/engine/finish-publication.ts — `HumanRequiredReason` union; `human_required` arm
- src/conductor/test/engine/finish-publication.test.ts — type-level assertion

**Wired-into:** none (no new production surface)
**Dependencies:** none

---

### Task 2: Admit an optional non-empty detail through the exact-key guard
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing test: `isExactDisposition({ kind: 'human_required', reason: 'judgment_refused',
   detail: 'x' })` returns true.
2. Verify test fails (RED) — `hasOnly('kind','reason')` rejects the third key.
3. Implement: add the `hasOnly('kind','reason','detail')` branch requiring `typeof detail ===
   'string' && detail.trim().length > 0`, keeping the existing two-key branch intact.
4. Verify test passes (GREEN).
5. Commit with message: "guard: accept an optional non-empty detail on human_required"

**Files likely touched:**
- src/conductor/src/engine/finish-publication.ts — `isExactDisposition` `human_required` arm
- src/conductor/test/engine/finish-publication.test.ts

**Wired-into:** same as Task 1
**Dependencies:** Task 1

---

### Task 3: Reject every malformed detail shape at the guard
**Story:** 1
**Type:** negative-path

**Steps:**
1. Write failing tests, one assertion each: `detail: ''`, `detail: '   '`, `detail: 42`,
   `detail: {}`, an extra `extra: 'x'` key, and a missing `reason` — all return false.
2. Verify tests fail (RED) for the cases the Task 2 branch admits too loosely.
3. Implement: tighten the branch until every listed shape is rejected while Task 2's valid shape
   still passes.
4. Verify tests pass (GREEN).
5. Commit with message: "guard: reject blank, non-string, and extra-key human_required details"

**Files likely touched:**
- src/conductor/src/engine/finish-publication.ts — `isExactDisposition`
- src/conductor/test/engine/finish-publication.test.ts

**Wired-into:** same as Task 1
**Dependencies:** Task 2

---

### Task 4: Add the reason-to-guidance map with compile-time exhaustiveness
**Story:** 2
**Type:** infrastructure

**Steps:**
1. Write failing test: importing `HUMAN_REQUIRED_REASONS` and reading each of the ten tokens
   yields an object with `message` and `nextAction`.
2. Verify test fails (RED) — the map does not exist.
3. Implement: add `HUMAN_REQUIRED_REASONS` beside `PUBLICATION_CONDITIONS`, annotated `satisfies
   Record<HumanRequiredReason, { message: string; nextAction: string }>` so a missing key is a
   compile error. Author reader-facing messages and verb-led next actions for all ten.
4. Verify test passes and typecheck is clean (GREEN).
5. Commit with message: "feat: map each FINISH human-required reason to guidance"

**Files likely touched:**
- src/conductor/src/engine/finish-publication.ts — `HUMAN_REQUIRED_REASONS`
- src/conductor/test/engine/finish-publication.test.ts

**Wired-into:** src/conductor/src/engine/finish-publication.ts#routeFinishPublicationDisposition
**Dependencies:** Task 1

---

### Task 5: Prove the map entries are non-empty and mutually distinct
**Story:** 2
**Type:** negative-path

**Steps:**
1. Write failing test: iterate the map asserting each `message` and `nextAction` is non-blank, and
   that the ten `message` values are all distinct.
2. Verify test fails (RED) if any authored entry is blank or duplicated.
3. Implement: correct any offending entry from Task 4.
4. Verify test passes (GREEN).
5. Commit with message: "test: forbid blank or duplicate human-required guidance"

**Files likely touched:**
- src/conductor/test/engine/finish-publication.test.ts
- src/conductor/src/engine/finish-publication.ts — corrections only

**Wired-into:** same as Task 4
**Dependencies:** Task 4

---

### Task 6: Render message and next action into the halt reason
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing test: `routeFinishPublicationDisposition({ kind: 'human_required', reason:
   'ambiguous_pr_identity' })` returns `{ kind: 'halt', reason }` whose text contains that token's
   message and next action and is not the bare token.
2. Verify test fails (RED) — the arm returns `disposition.reason` unchanged.
3. Implement: add a module-private rendering helper and call it from the `human_required` arm.
4. Verify test passes (GREEN).
5. Commit with message: "feat: render FINISH human-required halts as operator prose"

**Files likely touched:**
- src/conductor/src/engine/finish-publication.ts — rendering helper; `human_required` route arm
- src/conductor/test/engine/finish-publication.test.ts

**Wired-into:** same as Task 4
**Dependencies:** Task 5

---

### Task 7: Append the provider detail when one is present, cleanly when absent
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing tests: with `detail` present the rendered text contains message, next action, and
   the detail sentence; with `detail` absent the text is well-formed with no dangling separator and
   no literal `undefined`.
2. Verify tests fail (RED).
3. Implement: conditional detail composition in the rendering helper.
4. Verify tests pass (GREEN).
5. Commit with message: "feat: compose the provider detail into the halt reason"

**Files likely touched:**
- src/conductor/src/engine/finish-publication.ts — rendering helper
- src/conductor/test/engine/finish-publication.test.ts

**Wired-into:** same as Task 4
**Dependencies:** Task 6

---

### Task 8: Fail closed when a reason token resolves to no guidance
**Story:** 3
**Type:** negative-path

**Steps:**
1. Write failing test: route a disposition cast through `unknown` whose reason is an unlisted token;
   assert the returned halt text is non-empty, names the token verbatim, states that no guidance is
   registered, and that no exception is thrown.
2. Verify test fails (RED).
3. Implement: a fallback branch in the rendering helper for an unresolved lookup.
4. Verify test passes (GREEN).
5. Commit with message: "fix: fail closed when a human-required reason has no guidance"

**Files likely touched:**
- src/conductor/src/engine/finish-publication.ts — rendering helper fallback
- src/conductor/test/engine/finish-publication.test.ts

**Wired-into:** same as Task 4
**Dependencies:** Task 7

---

### Task 9: Prove the other route arms and the conductor are untouched
**Story:** 3
**Type:** negative-path

**Steps:**
1. Write failing test: assert `complete`, `publication_progress`, both `publication_retry` forms,
   `implementation_invalid`, and the contradictory-disposition early return each produce values
   identical to the documented current behavior.
2. Verify tests fail (RED) only if rendering leaked outside the `human_required` arm.
3. Implement: correct any leak; confirm `git diff --stat` reports no hunk in
   `src/conductor/src/engine/conductor.ts`.
4. Verify tests pass (GREEN).
5. Commit with message: "test: confine halt rendering to the human_required arm"

**Files likely touched:**
- src/conductor/test/engine/finish-publication.test.ts
- src/conductor/src/engine/finish-publication.ts — corrections only

**Wired-into:** none (no new production surface)
**Dependencies:** Task 8

---

### Task 10: Accept an optional detail on the provider verdict
**Story:** 4
**Type:** happy-path

**Steps:**
1. Write failing test: `isPrProseJudgmentResult({ kind: 'refused', detail: 'blocker' })` and the
   `revision_required` equivalent both return true.
2. Verify tests fail (RED).
3. Implement: add `detail?: string` to the `refused` and `revision_required` arms of
   `PrProseJudgmentResult` and validate it as an optional string in `isPrProseJudgmentResult`.
4. Verify tests pass (GREEN).
5. Commit with message: "feat: accept an optional detail on the PR-prose verdict"

**Files likely touched:**
- src/conductor/src/engine/finish-publication.ts — `PrProseJudgmentResult`
- src/conductor/src/engine/finish-pr-prose-judgment.ts — `isPrProseJudgmentResult`
- src/conductor/test/engine/finish-pr-prose-judgment.test.ts

**Wired-into:** src/conductor/src/engine/finish-publication.ts#mapPrProseJudgmentResult
**Dependencies:** Task 3

---

### Task 11: Drop a blank or non-string detail rather than carrying it
**Story:** 4
**Type:** negative-path

**Steps:**
1. Write failing tests: verdicts with `detail: ''`, `detail: '  '`, `detail: 7`, `detail: []`, and
   `detail: {}` all decode with `detail` absent, and the verdict `kind` still decodes correctly.
2. Verify tests fail (RED).
3. Implement: normalize `detail` at the decode boundary — trim, then drop when empty or non-string.
4. Verify tests pass (GREEN).
5. Commit with message: "fix: drop blank and non-string verdict details at decode"

**Files likely touched:**
- src/conductor/src/engine/finish-pr-prose-judgment.ts — `decodePrProseJudgment`,
  `isPrProseJudgmentResult`
- src/conductor/test/engine/finish-pr-prose-judgment.test.ts

**Wired-into:** same as Task 10
**Dependencies:** Task 10

---

### Task 12: Bound the detail length at a named constant
**Story:** 4
**Type:** negative-path

**Steps:**
1. Write failing test: a verdict whose `detail` exceeds the bound decodes to a `detail` of exactly
   the bound's length carrying a visible truncation marker; one at the bound is untouched.
2. Verify test fails (RED).
3. Implement: export a named constant for the bound and truncate at the decode boundary.
4. Verify test passes (GREEN).
5. Commit with message: "fix: bound the provider-supplied halt detail"

**Files likely touched:**
- src/conductor/src/engine/finish-pr-prose-judgment.ts — bound constant, truncation
- src/conductor/test/engine/finish-pr-prose-judgment.test.ts

**Wired-into:** same as Task 10
**Dependencies:** Task 11

---

### Task 13: Forward the detail into the disposition without reclassifying retryable verdicts
**Story:** 4
**Type:** happy-path

**Steps:**
1. Write failing tests: `refused` with a detail maps to `human_required`/`judgment_refused` carrying
   it; each `revision_required` reason maps to its token carrying it; `timed_out` and
   `provider_unavailable` still map to `publication_retry` and gain no detail.
2. Verify tests fail (RED).
3. Implement: forward `detail` in `mapPrProseJudgmentResult`'s refusal arms only.
4. Verify tests pass (GREEN).
5. Commit with message: "feat: carry the provider blocker into the human-required disposition"

**Files likely touched:**
- src/conductor/src/engine/finish-publication.ts — `mapPrProseJudgmentResult`
- src/conductor/test/engine/finish-publication.test.ts

**Wired-into:** same as Task 10
**Dependencies:** Task 12

---

### Task 14: Publish the verdict contract to the provider and pin it to the validator
**Story:** 5
**Type:** happy-path

**Steps:**
1. Write failing test: parse the verdict vocabulary out of `skills/finish/SKILL.md` and assert every
   documented `kind` and `revision_required` reason is accepted by `isPrProseJudgmentResult`, and
   that an unstructured prose reply still decodes to `malformed_response` and routes to
   `publication_retry`.
2. Verify test fails (RED) — `SKILL.md` documents no contract.
3. Implement: add a verdict-contract section to `skills/finish/SKILL.md` giving the exact JSON
   object, all three kinds, the three `revision_required` reasons, and the optional bounded
   `detail`. Run `test/test_harness_integrity.sh`.
4. Verify test and the integrity suite pass (GREEN).
5. Commit with message: "feat: publish the FINISH PR-prose verdict contract to the provider"

**Files likely touched:**
- skills/finish/SKILL.md — verdict-contract section
- src/conductor/test/engine/finish-pr-prose-judgment.test.ts — docs-to-validator agreement test

**Wired-into:** src/conductor/src/engine/skill-invocation.ts#STEP_SKILL_INVOCATIONS
**Dependencies:** Task 13

---

### Task 15: Assert the written halt marker carries the rendered blocker
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing test: drive a refusal through the coordinator with a faked provider verdict and
   assert the written `.pipeline/HALT` body contains the message, the next action, and the detail,
   and that `.pipeline/HALT.class` is exactly `needs-human`.
2. Verify test fails (RED).
3. Implement: any wiring correction the assertion exposes at the coordinator-to-marker seam.
4. Verify test passes (GREEN).
5. Commit with message: "test: assert the FINISH halt marker carries the rendered blocker"

**Files likely touched:**
- src/conductor/test/engine/finish-publication.test.ts

**Wired-into:** none (no new production surface)
**Dependencies:** Task 14

## Task Dependency Graph

```
Task 1 (closed union)
  ├── Task 2 (guard admits detail)
  │     └── Task 3 (guard rejects malformed detail)
  │           └── Task 10 (verdict accepts detail)
  │                 └── Task 11 (drop blank/non-string)
  │                       └── Task 12 (bound the length)
  │                             └── Task 13 (forward into disposition)
  │                                   └── Task 14 (publish contract to provider)
  │                                         └── Task 15 (halt marker end-to-end)
  └── Task 4 (guidance map)
        └── Task 5 (non-empty, distinct)
              └── Task 6 (render message + next action)
                    └── Task 7 (compose detail)
                          └── Task 8 (fail closed on unresolved token)
                                └── Task 9 (other arms + conductor untouched)
```

Two independent chains descend from Task 1 and rejoin at Task 10, which requires the guard chain
(Task 3) complete. Acyclic.

## Integration Points

- **After Task 9:** the halt text is fully correct for every `detail`-less disposition. The
  rendering layer is independently verifiable before any provider plumbing exists.
- **After Task 13:** a refusal carrying a blocker sentence flows end-to-end through the engine, with
  the provider contract still unpublished — proving the engine half in isolation.
- **After Task 15:** the full path from provider verdict to `.pipeline/HALT` is observable.

## Coverage Mapping

| Story | Acceptance criteria | Covering tasks |
|---|---|---|
| 1 | Happy (guard accepts both shapes; union closed) | 1, 2 |
| 1 | Negative (blank, non-string, extra key, missing reason, unknown token) | 1, 3 |
| 2 | Happy (each token resolves to guidance) | 4 |
| 2 | Negative (compile error on missing key; blank; duplicate) | 4, 5 |
| 3 | Happy (message + next action; with detail; conductor call unchanged) | 6, 7, 9 |
| 3 | Negative (unresolved token; absent detail; concurrency; other arms; no conductor diff) | 7, 8, 9 |
| 3 | Halt marker body and class | 15 |
| 4 | Happy (refused and revision_required carry detail) | 10, 13 |
| 4 | Negative (absent, blank, non-string, over-length, control chars, retryable kinds) | 11, 12, 13 |
| 5 | Happy (contract documented; a compliant refusal decodes) | 14 |
| 5 | Negative (prose fails closed; unknown kind; provider_unavailable; integrity suite; docs-validator agreement) | 14 |

Every happy-path and negative-path criterion in all five stories maps to at least one task.

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies are explicit and acyclic
- [ ] Every task carries a `**Wired-into:**` line
- [ ] No terminal catch-all validation task (Task 15 owns one named integration point)
- [ ] No documentation task (owned by the `maintain-documentation` custom step)
- [ ] `conductor.ts` carries no hunk in the delivered diff
- [ ] `CHANGELOG.md` and `VERSION` are not written by this branch
- [ ] `test/test_harness_integrity.sh` passes before every commit
