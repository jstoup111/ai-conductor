# Implementation Plan: Preservation-Anchored Completeness Exception (#1580)

**Date:** 2026-08-16
**Stories:** .docs/stories/plan-over-prescription-drives-completeness-finding.md
**Conflict check:** Clean as of 2026-08-16

## Summary

Gives the Completeness rubric its first closed exception — preservation maintenance — anchored to the
engine's existing removal evidence and a new behavior-level plan clause, so relocated coverage with
equivalent assertions stops reading as a gap while genuinely lost coverage still FAILs. 16 tasks.

## Technical Approach

Three surfaces, in dependency order.

**1. A plan-side clause.** `skills/plan/SKILL.md` gains an optional `**Preserves:** <behavior>` task
header. Its value names a behavior or contract, never a test case — that boundary is the whole point,
since naming cases is what made the incident's coverage reorganization read as five gaps.

**2. A deterministic engine parse.** `parsePlanTaskPreserves` lands in
`src/conductor/src/engine/plan-task-parse.ts`, the module's declared stable home for shared plan
grammar. It must recognize task headers under the **same** grammar `parsePlanTaskVerifyOnly`
(`autoheal.ts:638`) already uses — share or derive from `TASK_ID_PATTERN` rather than introducing a
narrower ad hoc regex, which is the divergence that module comment exists to prevent. Results travel
as `preservationContext` on `BuildReviewSourceSnapshot`, inside the frozen snapshot and its digest.

**3. A rubric contract change.** The exception is stated in
`skills/build-review-completeness/SKILL.md`. That file — not `build-review-prompt.ts` — is the live
contract: the rubric fan-out (`build-review-registry.ts`) dispatches each rubric to its own skill
against a versioned projection, and `buildGraderPrompt` is referenced only from tests and two
comments. `adr-2026-08-15`'s sibling diagram still points at the prompt module; do not follow it.

**Projection scope.** `preservationContext` is consumed by Completeness alone, so it is added to the
Completeness projection **only** — per the "all and only" rule in
`adr-2026-08-13-engine-managed-build-review-rubric-branches` §2. PR #1618 added `verifyOnlyContext`
to all four projections; copying that four-way pattern here would over-broaden. The exact key list of
each projection is pinned at `src/conductor/test/engine/build-review-projections.test.ts:316`.

**Versioning.** `contractVersion` stays `v1` and `projectionVersion` stays `v2`. Verified precedent:
commit `4bf3858a5` added the fourth Tautology exception plus a new projection field and bumped
neither.

**Sequencing rationale.** Parser before snapshot before projection, because each consumes the last.
The authoring form is independent and can land in parallel. The rubric contract depends on the
projection carrying the evidence. Acceptance specs come last, once there is a judged path to drive.

## Prerequisites

- None outstanding. `deriveBuildReviewRemovals` already computes `removalContext` and the Completeness
  projection already receives it (`build-review-projections.ts:262`).

## Tasks

### Task 1: Parse a single preserved-behavior clause per task
**Story:** Story 2
**Type:** happy-path

**Steps:**
1. Write failing test: a plan whose Task 9 block carries `**Preserves:** the ungated TokenMeter
   wrapper transparency` parses to one entry pairing task id `9` with that behavior string.
2. Verify test fails (RED).
3. Implement `parsePlanTaskPreserves`, recognizing task headers under the same grammar
   `parsePlanTaskVerifyOnly` uses rather than a new regex.
4. Verify test passes (GREEN).
5. Commit: "feat(plan-parse): parse preserved-behavior clauses from plan tasks"

**Files:**
- `src/conductor/src/engine/plan-task-parse.ts` — new parser
- `src/conductor/test/engine/plan-task-parse.test.ts` — parser coverage

**Dependencies:** none

### Task 2: A task may declare more than one preserved behavior
**Story:** Story 2
**Type:** happy-path

**Steps:**
1. Write failing test: a task declaring two `**Preserves:**` lines parses to two separate entries for
   that task id, not one merged entry.
2. Verify test fails (RED).
3. Implement multi-clause accumulation per task.
4. Verify test passes (GREEN).
5. Commit: "feat(plan-parse): accumulate multiple preserved behaviors per task"

**Files:** same as Task 1

**Dependencies:** Task 1

### Task 3: The parser fails closed on absent, empty, and unparseable input
**Story:** Story 2
**Type:** negative-path

**Steps:**
1. Write failing tests: a plan with no clause yields an empty result; a clause with an empty or
   whitespace-only value yields no entry for that task; a plan matching no task headers yields an
   empty result without throwing.
2. Verify tests fail (RED).
3. Implement fail-closed handling — absence of an entry is the only way a clause grants nothing.
4. Verify tests pass (GREEN).
5. Commit: "feat(plan-parse): fail closed on absent or empty preservation clauses"

**Files:** same as Task 1

**Dependencies:** Task 1

### Task 4: The source snapshot carries preservation evidence
**Story:** Story 2
**Type:** infrastructure

**Steps:**
1. Write failing test: an assembled `BuildReviewSourceSnapshot` exposes `preservationContext`
   alongside `removalContext`, frozen with the rest of the snapshot.
2. Verify test fails (RED).
3. Implement: populate `preservationContext` where the snapshot is assembled, from the parsed plan.
4. Verify test passes (GREEN).
5. Commit: "feat(build-review): carry preservation evidence in the source snapshot"

**Files:**
- `src/conductor/src/engine/build-review-inputs.ts` — snapshot field and population
- `src/conductor/test/engine/build-review-inputs.test.ts` — snapshot coverage

**Dependencies:** Task 1

### Task 5: Preservation evidence reaches the Completeness projection and nothing else
**Story:** Story 2
**Type:** infrastructure

**Steps:**
1. Write failing test: the Completeness projection's key set gains `preservationContext`, while the
   tautology, scope, and rootCause key sets are unchanged.
2. Verify test fails (RED).
3. Implement: copy the field into the Completeness projection only; leave `projectionVersion` at
   `'v2'`.
4. Verify test passes (GREEN).
5. Commit: "feat(build-review): project preservation evidence to Completeness only"

**Files:**
- `src/conductor/src/engine/build-review-projections.ts` — Completeness projection field
- `src/conductor/test/engine/build-review-projections.test.ts` — per-rubric key-set assertions

**Dependencies:** Task 4

### Task 6: A preservation clause participates in cache identity
**Story:** Story 2
**Type:** happy-path

**Steps:**
1. Write failing test: two assemblies differing only in the presence of a `**Preserves:**` line
   produce different Completeness projection digests.
2. Verify test fails (RED).
3. Implement whatever the digest path needs so the field is digested rather than excluded.
4. Verify test passes (GREEN).
5. Commit: "test(build-review): pin preservation evidence into projection identity"

**Files:** same as Task 5

**Dependencies:** Task 5

### Task 7: The plan skill documents the preserved-behavior form
**Story:** Story 1
**Type:** infrastructure

**Steps:**
1. Write the `**Preserves:** <behavior>` task header form into the task-block format, beside
   `**Verify-only:**` and `**Dependencies:**`.
2. State the boundary: the value names a behavior or contract, never a test case, file, or `it(...)`
   title; an absent or empty value grants nothing.
3. Include the incident's clause (`confirm the file's existing ungated self-check cases pass
   unchanged`) as the rejected form.
4. Commit: "docs(plan): add the behavior-level Preserves task header form"

**Files:**
- `skills/plan/SKILL.md` — task header form and authoring boundary

**Dependencies:** none

### Task 8: Harness integrity passes with the edited plan skill
**Story:** Story 1
**Type:** negative-path

**Steps:**
1. Run `test/test_harness_integrity.sh` and observe section numbering, frontmatter, and cross-skill
   reference checks against the edited skill.
2. Repair any check the edit broke.
3. Commit: "fix(plan): keep harness integrity green after the Preserves form"

**Files:**
- `skills/plan/SKILL.md` — repairs if any

**Dependencies:** Task 7

### Task 9: The Completeness contract states the three-condition predicate
**Story:** Story 3
**Type:** infrastructure

**Steps:**
1. State the preservation-maintenance exception: it applies only when the projection names the
   clause, removal evidence shows this diff deleted or moved the carrier, and no equivalent
   assertion of that behavior survives anywhere post-diff.
2. State that the third condition is what produces a finding — relocation alone never exempts.
3. Commit: "feat(build-review): add the preservation-maintenance Completeness exception"

**Files:**
- `skills/build-review-completeness/SKILL.md` — the closed exception and its predicate

**Dependencies:** Task 5

### Task 10: The contract narrows the removal doctrine and states per-clause evaluation
**Story:** Story 6
**Type:** infrastructure

**Steps:**
1. Narrow the existing "never an exemption" sentence in place so removal evidence anchors exactly
   this one exception and remains never an exemption for any other Completeness concern.
2. State that the predicate is evaluated per preserved-behavior clause, never per diff.
3. Confirm the prohibition on per-task SHA, commit-reachability, and trailer-corroboration reasoning
   is still present and unweakened.
4. Commit: "feat(build-review): narrow the removal doctrine to the preservation exception"

**Files:** same as Task 9

**Dependencies:** Task 9

### Task 11: Relocated coverage with equivalent assertions produces no finding
**Story:** Story 3
**Type:** happy-path

**Steps:**
1. Write failing acceptance spec: a task declaring `**Preserves:** X`, with a diff deleting X's
   carrier and adding an equivalent assertion of X elsewhere, yields no Completeness finding for X.
2. Verify it fails (RED).
3. Implement whatever the judged path needs to reach GREEN.
4. Verify it passes (GREEN).
5. Commit: "test(build-review): relocated coverage with equivalence yields no finding"

**Files:**
- `src/conductor/test/acceptance/preservation-anchored-completeness-exception.acceptance.test.ts` — new spec

**Dependencies:** Task 10

### Task 12: A weakened relocation still produces a finding
**Story:** Story 3
**Type:** negative-path

**Steps:**
1. Write failing acceptance spec: a diff that moves X's carrier but weakens the assertion so X is no
   longer distinguished yields a finding.
2. Verify it fails (RED).
3. Implement to GREEN.
4. Verify it passes (GREEN).
5. Commit: "test(build-review): weakened relocation is not exempted"

**Files:** same as Task 11

**Dependencies:** Task 11

### Task 13: Coverage deleted with no surviving equivalent still FAILs
**Story:** Story 4
**Type:** negative-path

**Steps:**
1. Write failing acceptance spec: a task declaring `**Preserves:** X`, with a diff deleting X's
   carrier and no equivalent assertion of X anywhere post-diff, yields a Completeness finding naming
   the preserved behavior as the missing outcome.
2. Assert the finding's nested `anchor` carries `rubric`, `planTask`, and `missingOutcome` as plain
   strings, unflattened.
3. Verify it fails (RED), implement to GREEN, verify it passes.
4. Commit: "test(build-review): lost preserved coverage still fails Completeness"

**Files:** same as Task 11

**Dependencies:** Task 11

### Task 14: A surviving test name without a surviving assertion still FAILs
**Story:** Story 4
**Type:** negative-path

**Steps:**
1. Write failing acceptance spec: a diff deleting X's carrier and adding a same-named test that
   asserts nothing about X yields a finding — a surviving name is not a surviving assertion.
2. Cover the sibling shapes in the same spec: a replacement asserting a different behavior Y, and a
   replacement that is only commented-out or skipped. Each still yields a finding for X.
3. Verify it fails (RED), implement to GREEN, verify it passes.
4. Commit: "test(build-review): a surviving name is not a surviving assertion"

**Files:** same as Task 11

**Dependencies:** Task 13

### Task 15: A mixed diff produces exactly one finding, for the lost behavior
**Story:** Story 5
**Type:** negative-path

**Steps:**
1. Write failing acceptance spec: one task declaring `**Preserves:** X` and `**Preserves:** Y`, with
   a diff relocating X's coverage intact and deleting Y's with no equivalent, yields exactly one
   finding, naming Y and not X.
2. Assert the two behaviors would carry distinct finding anchors, so a disposition accepted for one
   cannot alias the other.
3. Extend the same spec to three preserved behaviors on one task — two relocating cleanly, one lost —
   and assert exactly one finding.
4. Verify it fails (RED), implement to GREEN, verify it passes.
5. Commit: "test(build-review): the preservation predicate is per clause, not per diff"

**Files:** same as Task 11

**Dependencies:** Task 13

### Task 16: Neither half of the anchor grants an exemption on its own
**Story:** Story 6
**Type:** negative-path

**Steps:**
1. Write failing acceptance spec: a diff deleting a carrier for which no `**Preserves:**` clause
   exists is judged by the rubric's ordinary holistic reading, with removal evidence granting no
   exemption.
2. Cover the mirror case in the same spec: a `**Preserves:**` clause naming a behavior that had no
   coverage at merge base leaves condition 2 unsatisfied — no carrier was removed — so the clause
   grants no exemption either.
3. Verify it fails (RED), implement to GREEN, verify it passes.
4. Commit: "test(build-review): removal evidence and a clause each grant nothing alone"

**Files:** same as Task 11

**Dependencies:** Task 10

## Task Dependency Graph

```text
Task 1 ─┬─ Task 2
        ├─ Task 3
        └─ Task 4 ── Task 5 ─┬─ Task 6
                             └─ Task 9 ── Task 10 ─┬─ Task 11 ─┬─ Task 12
                                                   │           └─ Task 13 ─┬─ Task 14
                                                   │                       └─ Task 15
                                                   └─ Task 16

Task 7 ── Task 8            (independent of the engine chain)
```

## Integration Points

- **After Task 6:** the full evidence path is end-to-end testable — a plan clause reaches the
  Completeness projection and changes its identity.
- **After Task 10:** the rubric contract is complete and the judged path can be driven by acceptance
  specs.

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies are explicit and acyclic
- [ ] `preservationContext` reaches the Completeness projection only
- [ ] `contractVersion` remains `v1`; `projectionVersion` remains `v2`
- [ ] The contract lands in `skills/build-review-completeness/SKILL.md`, not `build-review-prompt.ts`
