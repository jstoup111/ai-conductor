# Implementation Plan: declared pattern replication for Nth-of-a-kind BUILD work

**Date:** 2026-08-09
**Stories:** `.docs/stories/build-dispatches-every-plan-task-through-a-full-ge.md`
**Conflict check:** Clean as of 2026-08-09

## Summary

Adds a declared replication relationship to the plan header and consumes it at two BUILD points, so
that Nth-of-a-kind work copies its source pattern mechanically and spends TDD only on the deltas.
19 tasks.

## Technical Approach

**One new parsed relationship, two consumers, one new gate.**

The declaration is two plan-**header** lines, `**Pattern-source:**` and `**Rename-map:**`. They are
parsed by a new module, `src/conductor/src/engine/plan-pattern-source.ts`, deliberately built as a
sibling of `plan-stories-reference.ts` — the only existing plan-header parser — reusing its
fail-closed resolution posture (traversal refused, non-`.docs/` refused, absent line tolerated). The
result is a discriminated union: `resolved`, `absent`, `malformed`. `absent` and `malformed` are
distinct **types**, not an empty value, because a half-declaration must never read as no
declaration.

The malformed branch follows `wired-into.ts` (`:19`, `:100`, `:167`): its message enumerates the
accepted forms rather than merely reporting a parse failure.

**The `**Type:**` channel in `autoheal.ts:613-676` is not reused, and must not be.** It returns
`Map<string, boolean>`, lowercases its input, and splits on `+` — all three would corrupt a real
path. This is architecture-review Condition 4.

**The equivalence check is the one piece of net-new machinery.** The engine has no content
comparison today: no diff, no similarity, no edit distance. It is invoked from `runBuildReview`
(`step-runners.ts:1667`), the same method that already runs the per-task floors — but unlike those
floors, which are fail-soft and never change `success` (`:1742-1783`), a mismatch here **fails the
step**. That contrast is architecture-review Condition 1 and gets its own pinning test, because
advisory is this repository's default shape for per-task checks and is the likely accidental
outcome.

**Sequencing.** Parser first (Tasks 1–4), then the check and its wiring (5–8), then the five skill
contracts that consume the declaration (9–15, including 12b), then the invariant pin (16), then two
verify-only obligations carried from the review and the conflict check (17–18).

**Documentation is deliberately absent from this plan.** The `plan` skill's documentation boundary
forbids doc tasks, and this repository routes human-facing documentation through its own
`maintain-documentation` custom step. Splitting it into plan tasks would violate the former; ignoring
it would violate the latter. The custom step owns it.

**Test isolation.** Unit tests inject mocked adapters. The acceptance coverage runs the real internal
flow with faithful fakes at every third-party boundary. No default-suite test calls a real external
service.

## Prerequisites

- None. No migration, no new dependency, no infrastructure change.

## Tasks

### Task 1: Parse the Pattern-source header line
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing test: a plan header containing `**Pattern-source:** src/conductor/src/engine/wired-into.ts` parses to a `resolved` result whose source path is that exact string, case preserved.
2. Verify test fails (RED)
3. Implement: new module with module-local header regexes and an exported resolver returning a discriminated union with a `resolved` variant.
4. Verify test passes (GREEN)
5. Commit with message: "feat(plan): parse Pattern-source plan-header line"

**Files:**
- `src/conductor/src/engine/plan-pattern-source.ts` — new module
- `src/conductor/src/engine/__tests__/plan-pattern-source.test.ts` — new unit test

**Wired-into:** `src/conductor/src/engine/step-runners.ts#runBuildReview`

**Dependencies:** none

---

### Task 2: Accept inline-code and Markdown-link path forms
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing test: the same path wrapped in inline code, and as a Markdown link, both resolve identically to the bare form.
2. Verify test fails (RED)
3. Implement: strip inline-code delimiters and resolve link targets before path resolution, matching `plan-stories-reference.ts`'s handling.
4. Verify test passes (GREEN)
5. Commit with message: "feat(plan): accept inline-code and link forms for Pattern-source"

**Files:** same as Task 1

**Wired-into:** `src/conductor/src/engine/step-runners.ts#runBuildReview`

**Dependencies:** 1

---

### Task 3: Parse the Rename-map line into an ordered pair list
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing test: a `**Rename-map:**` line declaring two pairs parses to both pairs in declaration order, with case preserved on both sides.
2. Verify test fails (RED)
3. Implement: rename-map parsing inside the same module, returning an ordered pair list on the `resolved` variant. Do not split on `+` and do not lowercase.
4. Verify test passes (GREEN)
5. Commit with message: "feat(plan): parse Rename-map into an ordered pair list"

**Files:** same as Task 1

**Wired-into:** `src/conductor/src/engine/step-runners.ts#runBuildReview`

**Dependencies:** 1

---

### Task 4: Fail closed on every malformed and unresolvable declaration
**Story:** 1
**Type:** negative-path

**Steps:**
1. Write failing tests, one assertion each: nonexistent path yields `malformed` naming the path; a `../`-escaping path yields `malformed` with a traversal message and never reads the file; a malformed rename-map line yields `malformed` whose message enumerates the accepted forms; an empty left-hand side in a pair yields `malformed` naming the pair; both lines absent yields `absent` with no diagnostic; `**Pattern-source:**` present with no `**Rename-map:**` yields `malformed` naming the missing line.
2. Verify tests fail (RED)
3. Implement: the `malformed` and `absent` variants and their guards; assert by type that `absent` is not reachable from a half-declaration.
4. Verify tests pass (GREEN)
5. Commit with message: "feat(plan): fail closed on malformed or unresolvable declarations"

**Files:** same as Task 1

**Wired-into:** `src/conductor/src/engine/step-runners.ts#runBuildReview`

**Dependencies:** 3

---

### Task 5: Compare a copied file against its source modulo the rename map
**Story:** 4
**Type:** happy-path

**Steps:**
1. Write failing test: given a source file and a target whose content is the source with the rename map applied, the equivalence check reports a pass naming the verified pair.
2. Verify test fails (RED)
3. Implement: new equivalence module performing the content comparison. This is the engine's first content-comparison primitive.
4. Verify test passes (GREEN)
5. Commit with message: "feat(build): add copy-equivalence comparison"

**Files:**
- `src/conductor/src/engine/copy-equivalence.ts` — new module
- `src/conductor/src/engine/__tests__/copy-equivalence.test.ts` — new unit test

**Wired-into:** `src/conductor/src/engine/step-runners.ts#runBuildReview`

**Dependencies:** 4

---

### Task 6: Report every mismatch shape distinctly
**Story:** 4
**Type:** negative-path

**Steps:**
1. Write failing tests, one assertion each: content differing beyond the rename map reports the file and the first differing region; a source with no target reports the missing target; a target with no source reports the unexpected target; a rename map mapping two sources onto one target reports the collision; an unreadable source makes the check fail closed rather than report a pass.
2. Verify tests fail (RED)
3. Implement: the four distinct verdict messages and the fail-closed guard.
4. Verify tests pass (GREEN)
5. Commit with message: "feat(build): distinct verdicts for every copy-equivalence mismatch"

**Files:** same as Task 5

**Wired-into:** `src/conductor/src/engine/step-runners.ts#runBuildReview`

**Dependencies:** 5

---

### Task 7: A mismatch fails the step, unlike the advisory floors
**Story:** 4
**Type:** negative-path

**Steps:**
1. Write failing test: with a mismatch present, the step result's success state is false — asserted on the outcome, not on the presence of a diagnostic string. In the same test file, assert that `runPerTaskCommitFloor` still leaves success unchanged on a gap, pinning the contrast.
2. Verify test fails (RED)
3. Implement: make the equivalence verdict blocking where the floors are fail-soft.
4. Verify test passes (GREEN)
5. Commit with message: "feat(build): copy-equivalence mismatch blocks rather than warns"

**Files:**
- `src/conductor/src/engine/copy-equivalence.ts` — blocking verdict
- `src/conductor/src/engine/__tests__/copy-equivalence-blocking.test.ts` — new test pinning the contrast with the advisory floor

**Wired-into:** `src/conductor/src/engine/step-runners.ts#runBuildReview`

**Dependencies:** 6

---

### Task 8: Invoke the equivalence check from the build-review gate sequence
**Story:** 4
**Type:** infrastructure

**Steps:**
1. Write failing test: on a plan with a resolved declaration, the equivalence check runs during the build-review gate sequence and its failure propagates to the step result; on a plan with no declaration it does not run at all.
2. Verify test fails (RED)
3. Implement: call the equivalence check from `runBuildReview`, alongside the existing floor calls, reading the resolved declaration from the parser. Guard: it must not run at `acceptance_specs`, and no RED evidence may be derived from its result.
4. Verify test passes (GREEN)
5. Commit with message: "feat(build): wire copy-equivalence into the build-review gate sequence"

**Files:**
- `src/conductor/src/engine/step-runners.ts` — invoke the check in `runBuildReview`
- `src/conductor/src/engine/__tests__/step-runners-copy-equivalence.test.ts` — new integration test

**Wired-into:** `src/conductor/src/engine/step-runners.ts#runBuildReview`

**Dependencies:** 7

---

### Task 9: Document the header grammar in the plan authoring contract
**Story:** 1
**Type:** infrastructure

**Steps:**
1. Write failing test: the harness integrity suite asserts `skills/plan/SKILL.md` documents both header lines and their accepted forms.
2. Verify test fails (RED)
3. Implement: add the `**Pattern-source:**` / `**Rename-map:**` header contract to `skills/plan/SKILL.md`, in the same shape as the existing `**Stories:**` reference-forms section. Provider-neutral prose.
4. Verify test passes (GREEN)
5. Commit with message: "docs(plan-skill): declare the Pattern-source header contract"

**Files:**
- `skills/plan/SKILL.md` — new header-grammar section
- `test/test_harness_integrity.sh` — new assertion

**Wired-into:** none (no new production surface)

**Dependencies:** 4

---

### Task 10: Copy and rename the source feature's acceptance specs
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing acceptance coverage: with a resolved declaration, the source feature's specs are copied to rename-map-derived paths with the map applied to their contents, and the recorded RED evidence reports non-zero failures with zero errors and zero skips.
2. Verify it fails (RED)
3. Implement: the copy-and-rename path in `skills/writing-system-tests/SKILL.md`, replacing derivation when a declaration resolves.
4. Verify it passes (GREEN)
5. Commit with message: "feat(acceptance-specs): copy and rename source specs on a declared replication"

**Files:**
- `skills/writing-system-tests/SKILL.md` — copy-and-rename path

**Wired-into:** none (no new production surface)

**Dependencies:** 4

---

### Task 11: Fail closed on the three spec-copy failure shapes
**Story:** 2
**Type:** negative-path

**Steps:**
1. Write failing coverage, one assertion each: an empty source spec set fails closed naming the source and the glob, never falling back to derivation; a target-path collision fails closed rather than overwriting; an all-passing copied spec set fails with a diagnostic naming the passing specs.
2. Verify it fails (RED)
3. Implement: the three fail-closed branches in `skills/writing-system-tests/SKILL.md`.
4. Verify it passes (GREEN)
5. Commit with message: "feat(acceptance-specs): fail closed on empty source, collision, and all-passing copies"

**Files:** same as Task 10

**Wired-into:** same as Task 10

**Dependencies:** 10

---

### Task 12: Define the declared copy task's shape
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing coverage: a replication plan carries exactly one copy task whose `**Files:**` declaration lists every rename-map-implied target; every declared target exists post-task with the rename map applied; no file outside the declaration is written; the copy itself consumes no LLM turns.
2. Verify it fails (RED)
3. Implement: the copy-task contract in `skills/pipeline/SKILL.md`, including its zero-LLM requirement.
4. Verify it passes (GREEN)
5. Commit with message: "feat(pipeline): define the declared copy task"

**Files:**
- `skills/pipeline/SKILL.md` — copy-task contract

**Wired-into:** none (no new production surface)

**Dependencies:** 4

---

### Task 12b: Fail the copy task on each declaration and source fault
**Story:** 3
**Type:** negative-path

**Steps:**
1. Write failing coverage, one assertion each: a `**Files:**` declaration omitting a rename-map-implied target fails the task naming the undeclared path rather than writing outside the declaration; an unreadable source at copy time fails closed naming the file and leaves no partially-copied target set; a copy task on a plan with no declaration fails naming the absent declaration.
2. Verify it fails (RED)
3. Implement: the three failure branches in the copy-task contract.
4. Verify it passes (GREEN)
5. Commit with message: "feat(pipeline): fail the copy task on declaration and source faults"

**Files:** same as Task 12

**Wired-into:** same as Task 12

**Dependencies:** 12

---

### Task 13: Delta-only execution honoring whole-task satisfaction
**Story:** 5
**Type:** happy-path

**Steps:**
1. Write failing coverage: a task the copy fully satisfies closes via the existing `Evidence: satisfied-by` form; a task the copy satisfies only partly runs the full cycle and is never split; a nonexistent sha and a non-ancestor sha both fail to derive completion.
2. Verify it fails (RED)
3. Implement: the delta-only execution rule and the whole-task-satisfaction tie-break in `skills/pipeline/SKILL.md`. Introduce no new evidence form and relax no existing derivation check.
4. Verify it passes (GREEN)
5. Commit with message: "feat(pipeline): delta-only execution with whole-task satisfaction tie-break"

**Files:** same as Task 12

**Wired-into:** same as Task 12

**Dependencies:** 12

---

### Task 14: Delta tasks run the unmodified cycle
**Story:** 6
**Type:** happy-path

**Steps:**
1. Write failing coverage: a task introducing behavior the source lacks runs the identical cycle on a replication build and a non-replication build; a new-behavior task cannot close by citing the copy commit; a delta task whose first test passes immediately does not advance to implementation.
2. Verify it fails (RED)
3. Implement: the delta-task contract in `skills/tdd/SKILL.md`, stating that satisfied-by closure requires whole-task satisfaction and that ambiguity resolves toward the full cycle.
4. Verify it passes (GREEN)
5. Commit with message: "feat(tdd): delta tasks run the unmodified cycle"

**Files:**
- `skills/tdd/SKILL.md` — delta-task contract

**Wired-into:** none (no new production surface)

**Dependencies:** 13

---

### Task 15: Scope duplication-review suppression to the declared pairs
**Story:** 7
**Type:** happy-path

**Steps:**
1. Write failing coverage: a declared replication is not reported as an extract-with-parameters finding on similarity to its source alone; undeclared duplication in the same diff is still flagged; duplication resembling the source but outside the declared target set is still flagged; the review may still propose extraction on a declared replication with a stated rationale; behavior with no declaration is unchanged.
2. Verify it fails (RED)
3. Implement: narrow the copy-paste row in `skills/simplify/SKILL.md` to undeclared duplication, retaining extraction authority explicitly.
4. Verify it passes (GREEN)
5. Commit with message: "feat(simplify): scope suppression to declared replication pairs"

**Files:**
- `skills/simplify/SKILL.md` — narrowed copy-paste row

**Wired-into:** none (no new production surface)

**Dependencies:** 12

---

### Task 16: Pin that a declaration changes no skip set and disables no gate
**Story:** 6
**Type:** negative-path

**Steps:**
1. Write failing test: with a resolved declaration present, the computed skip set and the enabled-gate set are identical to the same computation with no declaration, at every tier.
2. Verify test fails (RED)
3. Implement: the pinning test only. No production change — the test locks the invariant on the declaration axis, which the existing tier-axis pins do not cover.
4. Verify test passes (GREEN)
5. Commit with message: "test(steps): pin skip and gate sets invariant to a replication declaration"

**Files:**
- `src/conductor/src/engine/__tests__/steps-declaration-invariance.test.ts` — new test

**Wired-into:** none (no new production surface)

**Dependencies:** 8

---

### Task 17: Confirm the harness plan-tasks-own-their-tests rule needs no amendment
**Story:** 6
**Type:** verification
**Verify-only:** yes

**Steps:**
1. Read `HARNESS.md`'s sentence stating that plan tasks own implementation behavior and their scoped RED/GREEN tests, in the context of the copy task and the delta tasks.
2. Confirm the design satisfies it: the copy task owns the equivalence check, and each delta task owns its own scoped tests.
3. If it does not hold, stop and escalate rather than amending the rule inside this task.
4. Record the finding in the commit body.
5. Commit with message: "chore: confirm HARNESS plan-task test-ownership rule holds"

**Files:** none

**Wired-into:** none (no new production surface)

**Dependencies:** 14

---

### Task 18: Confirm no turns are spent re-deriving covered behavior
**Story:** 5
**Type:** verification
**Verify-only:** yes

**Steps:**
1. From `.pipeline/events.jsonl` for a replication build, confirm that every task closed via `Evidence: satisfied-by` consumed zero test-authoring dispatches — the guarantee story 5's closure path exists to produce.
2. In the same pass, take the turn and duration breakdown separating test authoring from scoped test execution, and compare it against architecture-review Assumption 1 (derivation dominates, ~70% confidence).
3. If any satisfied-by-closed task consumed an authoring dispatch, escalate — the closure path is not delivering its guarantee. If Assumption 1 is falsified, record that the documented fallback is exemplar priming and escalate; do not compensate by weakening the cycle.
4. Record both findings in the commit body.
5. Commit with message: "chore: confirm zero re-derivation on satisfied-by closures"

**Files:** none

**Wired-into:** none (no new production surface)

**Dependencies:** 16

## Task Dependency Graph

```
1 ──┬── 2
    ├── 3 ── 4 ──┬── 5 ── 6 ── 7 ── 8 ── 16
                 ├── 9
                 ├── 10 ── 11
                 └── 12 ──┬── 12b
                          ├── 13 ── 14 ── 17
                          ├── 13 ── 18
                          └── 15
```

## Integration Points

- **After Task 8:** the parser and the blocking equivalence check are wired end to end; a declared replication can be verified mechanically even before any skill consumes the declaration.
- **After Task 11:** `acceptance_specs` produces RED evidence from copied specs.
- **After Task 15:** the full BUILD path is in place — copy task, delta-only execution, unmodified delta cycle, and scoped duplication review.

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies are explicit and acyclic
- [ ] No task names another feature's sealed artifact
- [ ] No terminal catch-all validation task
