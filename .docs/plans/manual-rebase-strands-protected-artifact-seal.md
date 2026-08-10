# Implementation Plan: Provenance-based protected-artifact seal rotation (#1229)

**Date:** 2026-08-09
**Stories:** .docs/stories/manual-rebase-strands-protected-artifact-seal.md
**Conflict check:** Clean as of 2026-08-09

## Summary

Corrects the protected-artifact seal rotation verdict from a symmetric byte-equality test to an
authorship test, and narrows what a rotation refusal means, so a feature that is merely behind its
base branch is no longer falsely halted as a protected-artifact violator. 17 tasks.

## Technical Approach

`evaluateProtectedArtifactSealRotation` refuses rotation whenever a diverging path's HEAD blob
differs from the base tip's. That answers "is HEAD level with base?", not "did this feature author
the difference?" — so a feature behind base fails it having authored nothing, gets stamped
`feature-authored:` by `emitRotationRefusal`, and is converted to a halt by
`rotationRefusalVerdict` even when `inspectSeal` passed.

The fix has three parts, sequenced so the safety-relevant one is proven first.

**Part 1 (Tasks 1-5), the pure decision table.** The evaluator stays pure per
`adr-2026-08-09-rotation-provenance-outside-the-pure-evaluator`: it gains a per-path authorship
input carrying three states — authored, not-authored, indeterminate — mirroring the existing
`baselineAncestry` parameter's shape. Authored and indeterminate both refuse; not-authored paths are
*excluded from the blocking set* rather than refused, so the `feature-authored` classification
becomes true by construction. Task 1 pins current behavior before anything moves, and Task 2 lands
the fail-closed default before Task 3 opens the permitting branch — the loosening never exists in
the tree without its guard.

**Part 2 (Tasks 6-8), resolution.** `evaluateProtectedArtifactSealRotationInRepository` resolves
authorship with the merge-base probe `branchUntouchedInheritance` already uses, so the module keeps
one definition of provenance. Resolution is scoped to diverging paths, and the ancestor
short-circuit keeps performing zero probes.

**Part 3 (Tasks 9-14), verdict composition and telemetry.** `rotationRefusalPreservesInspection`
already implements non-escalation for two conditions; it widens to the environmental set only.
`workspace-differs-from-head` and provenance-confirmed feature-authored refusals keep escalating —
Task 10 is what proves that. Telemetry adds fields to the two existing `ConductorEvent` variants;
no new variant, no new ledger, no sidecar.

**Part 4 (Tasks 15-17).** Task 15 fixes the pre-existing gap where `translateAfterRebase` omits
`.docs/decisions` from the directory list it diffs to build the `rebaselines[]` audit entry — that
audit trail becomes load-bearing for triage under this change. Tasks 16-17 reproduce the reported
incident against real git fixtures, with negative variants proving genuine violations still halt.

No task introduces a new production surface. Every changed export already has a production caller
rooted at `conductor.ts`'s BUILD/SHIP step guard, enumerated in the architecture review's
`## Wiring Surface` section, so every task carries the no-new-surface waiver form honestly.

Per the plan skill's documentation boundary, no task here writes documentation. The runbook update
(`docs/runbooks/stalled-or-stuck-feature.md`'s protected-artifact recovery section) is delivered by
this repository's `maintain-documentation` custom step in the same PR.

## Prerequisites

- None. No migration, no dependency, no external setup. The seal file format is unchanged.
- Sequencing (advisory, from conflict-check): #1281 `conduct reseal` lands first and this rebases
  onto it. Disjoint functions in a shared file; not a precondition for authoring these tasks.

## Tasks

### Task 1: Pin the rotation decision table before changing it
**Story:** 2
**Type:** infrastructure

**Steps:**
1. Write a characterization test asserting the current verdict for each existing branch of
   `evaluateProtectedArtifactSealRotation`: `baseline-unresolvable`, `same-history-ancestor`,
   `base-tip-unresolved`, `workspace-differs-from-head`, and `head-differs-from-base`.
2. Verify it passes against the current implementation (green from the start by design).
3. Commit with message: "test(seal): pin the rotation decision table before the predicate change"

**Files likely touched:**
- `src/conductor/test/engine/protected-artifact-seal.test.ts` — characterization test

**Wired-into:** none (no new production surface)

**Dependencies:** none

---

### Task 2: Refuse a diverging path whose authorship is indeterminate
**Story:** 3
**Type:** negative-path

**Steps:**
1. Write a failing test: given a diverging path whose supplied authorship is indeterminate, the
   verdict is `{ permitted: false, condition: 'head-differs-from-base', path }`.
2. Add a second failing case asserting an omitted authorship entry for a diverging path is treated
   as indeterminate, never as not-authored.
3. Verify tests fail (RED).
4. Add the per-path authorship input to the evaluator's input type and implement the fail-closed
   branch. Do not add a permitting branch yet.
5. Verify tests pass (GREEN) and Task 1's characterization test still passes.
6. Commit with message: "feat(seal): fail closed on indeterminate rotation provenance"

**Files likely touched:**
- `src/conductor/src/engine/protected-artifact-seal.ts` — authorship input, fail-closed branch
- `src/conductor/test/engine/protected-artifact-seal.test.ts` — indeterminate and omitted cases

**Wired-into:** none (no new production surface)

**Dependencies:** Task 1

---

### Task 3: Exclude a base-ahead path from the blocking set
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write a failing test: given a protected artifact present at the base tip and absent from HEAD,
   with authorship not-authored, the verdict is permitted and the path is absent from the returned
   `paths`.
2. Add a second failing case: a path present at both HEAD and base with differing content, authorship
   not-authored, is likewise permitted.
3. Verify tests fail (RED).
4. Implement the exclusion — a not-authored diverging path is removed from the blocking set rather
   than producing a refusal condition.
5. Verify tests pass (GREEN).
6. Commit with message: "feat(seal): a base-ahead protected artifact no longer blocks rotation"

**Files likely touched:**
- `src/conductor/src/engine/protected-artifact-seal.ts` — base-ahead exclusion
- `src/conductor/test/engine/protected-artifact-seal.test.ts` — base-ahead happy paths

**Wired-into:** none (no new production surface)

**Dependencies:** Task 2

---

### Task 4: Update the one existing assertion the corrected predicate re-scopes
**Story:** 2
**Type:** refactor

**Steps:**
1. Update the existing decision-table assertion at
   `src/conductor/test/engine/protected-artifact-seal.test.ts` that pins
   `head-differs-from-base` for an input supplying no authorship, so it supplies an explicit
   authorship value and asserts the verdict for that value.
2. Add a sibling assertion covering the opposite authorship value on the same input shape.
3. Verify both pass, and confirm by diff review that no other existing assertion was relaxed,
   removed, or re-scoped.
4. Commit with message: "test(seal): supply explicit authorship to the re-scoped rotation case"

**Files likely touched:**
- `src/conductor/test/engine/protected-artifact-seal.test.ts` — the single re-scoped assertion

**Wired-into:** none (no new production surface)

**Dependencies:** Task 3

---

### Task 5: Keep refusing a path this feature authored
**Story:** 2
**Type:** negative-path

**Steps:**
1. Write failing tests: a diverging path with authorship authored refuses naming that path,
   regardless of blob contents; a path this feature committed a deletion of refuses; a mixed set
   containing one authored and one base-ahead path refuses naming only the authored path.
2. Verify tests fail (RED).
3. Implement so the authored branch is decided by the authorship value rather than by blob
   comparison, and the returned `path` names the authored path.
4. Verify tests pass (GREEN), and assert the seal file is byte-identical after a refused rotation.
5. Commit with message: "feat(seal): refuse rotation only for feature-authored divergence"

**Files likely touched:**
- `src/conductor/src/engine/protected-artifact-seal.ts` — authored refusal branch
- `src/conductor/test/engine/protected-artifact-seal.test.ts` — authored, deletion, mixed-set cases

**Wired-into:** none (no new production surface)

**Dependencies:** Task 4

---

### Task 6: Resolve authorship in the repository wrapper
**Story:** 4
**Type:** happy-path

**Steps:**
1. Write a failing test against a real git fixture: the repository-level evaluator resolves
   authorship for a diverging path and returns the verdict the supplied value implies.
2. Verify test fails (RED).
3. Implement resolution in `evaluateProtectedArtifactSealRotationInRepository` using the same
   merge-base probe the inspection path uses; do not duplicate the probe logic.
4. Verify test passes (GREEN), and assert the pure evaluator remains synchronous with no `execa`
   call and no git helper import.
5. Commit with message: "feat(seal): resolve rotation authorship in the repository wrapper"

**Files likely touched:**
- `src/conductor/src/engine/protected-artifact-seal.ts` — wrapper-side authorship resolution
- `src/conductor/test/engine/protected-artifact-seal.test.ts` — wrapper resolution against a fixture

**Wired-into:** none (no new production surface)

**Dependencies:** Task 5

---

### Task 7: Resolve a degraded probe to indeterminate
**Story:** 3
**Type:** negative-path

**Steps:**
1. Write failing tests: no merge-base between HEAD and the base branch resolves to indeterminate and
   refuses; a `git diff` invocation exiting non-zero resolves to indeterminate and refuses.
2. Verify tests fail (RED).
3. Implement the mapping from each degraded probe outcome to the indeterminate authorship value.
4. Verify tests pass (GREEN), and assert neither case can yield a permitted verdict.
5. Commit with message: "feat(seal): map a degraded provenance probe to indeterminate"

**Files likely touched:**
- `src/conductor/src/engine/protected-artifact-seal.ts` — degraded-probe mapping
- `src/conductor/test/engine/protected-artifact-seal.test.ts` — no-merge-base and failed-diff cases

**Wired-into:** none (no new production surface)

**Dependencies:** Task 6

---

### Task 8: Perform no authorship probe on the common ancestor path
**Story:** 4
**Type:** negative-path

**Steps:**
1. Write a failing test asserting that when the seal baseline is an ancestor of HEAD, the
   repository-level evaluator returns `same-history-ancestor` having performed zero authorship
   probes, counted through an injected or observed git seam.
2. Add a case asserting a protected path that does not diverge is never probed.
3. Verify tests fail (RED).
4. Implement the scoping so resolution runs only for diverging paths and only after the ancestry
   short-circuit.
5. Verify tests pass (GREEN).
6. Commit with message: "perf(seal): probe authorship only for diverging paths"

**Files likely touched:**
- `src/conductor/src/engine/protected-artifact-seal.ts` — probe scoping
- `src/conductor/test/engine/protected-artifact-seal.test.ts` — zero-probe assertions

**Wired-into:** none (no new production surface)

**Dependencies:** Task 7

---

### Task 9: Stop an environmental refusal from failing a passing inspection
**Story:** 5
**Type:** happy-path

**Steps:**
1. Write failing tests: with `inspectSeal` passing, a rotation refused as `base-tip-unresolved`,
   as `head-unresolvable`, and as `same-history-ancestor` each compose to the passing inspection
   verdict.
2. Verify tests fail (RED).
3. Widen `rotationRefusalPreservesInspection` to the environmental refusal set.
4. Verify tests pass (GREEN), and assert no `rebaselines[]` entry is appended in these cases.
5. Commit with message: "fix(seal): an environmental rotation refusal no longer halts a clean seal"

**Files likely touched:**
- `src/conductor/src/engine/protected-artifact-seal.ts` — non-escalation set
- `src/conductor/test/engine/protected-artifact-seal.test.ts` — per-class non-escalation cases

**Wired-into:** none (no new production surface)

**Dependencies:** Task 8

---

### Task 10: Keep escalating the refusal classes that evidence tampering
**Story:** 5
**Type:** negative-path

**Steps:**
1. Write failing tests: with `inspectSeal` passing, a refusal of `workspace-differs-from-head`
   composes to a failure naming the path and instructing restoration from HEAD; a
   provenance-confirmed feature-authored refusal composes to a failure naming the path.
2. Add a case asserting that when `inspectSeal` fails, the composed verdict reports the inspection's
   own reason rather than a rotation reason.
3. Verify tests fail (RED).
4. Implement so the non-escalation set excludes both tamper-evidencing classes.
5. Verify tests pass (GREEN).
6. Commit with message: "test(seal): prove the escalation boundary is unweakened"

**Files likely touched:**
- `src/conductor/src/engine/protected-artifact-seal.ts` — escalation boundary
- `src/conductor/test/engine/protected-artifact-seal.test.ts` — escalating-class cases

**Wired-into:** none (no new production surface)

**Dependencies:** Task 9

---

### Task 11: Carry classifying evidence on the refusal event
**Story:** 6
**Type:** happy-path

**Steps:**
1. Write a failing test asserting a refused rotation emits an event carrying the merge-base commit
   used and whether HEAD changed the named path since it.
2. Add a case asserting an indeterminate provenance is recorded as indeterminate rather than as HEAD
   having touched the path.
3. Verify tests fail (RED).
4. Add the fields to the existing `protected_artifact_rebaseline_refused` variant and populate them
   from the resolved provenance; derive the classification from provenance, not from the refusal
   condition alone.
5. Verify tests pass (GREEN).
6. Commit with message: "feat(events): carry provenance evidence on a rotation refusal"

**Files likely touched:**
- `src/conductor/src/types/events.ts` — additive fields on the existing refused variant
- `src/conductor/src/engine/protected-artifact-seal.ts` — populate the evidence
- `src/conductor/test/engine/protected-artifact-seal.test.ts` — refusal evidence assertions

**Wired-into:** none (no new production surface)

**Dependencies:** Task 10

---

### Task 12: Record the excluded base-ahead paths on the rebaseline event
**Story:** 6
**Type:** happy-path

**Steps:**
1. Write a failing test asserting a permitted rotation that excluded base-ahead paths emits a
   rebaseline event carrying those paths.
2. Verify test fails (RED).
3. Add the field to the existing `protected_artifact_rebaseline` variant and populate it.
4. Verify test passes (GREEN).
5. Commit with message: "feat(events): record base-ahead paths on a permitted rebaseline"

**Files likely touched:**
- `src/conductor/src/types/events.ts` — additive field on the existing rebaseline variant
- `src/conductor/src/engine/protected-artifact-seal.ts` — populate the path list
- `src/conductor/test/engine/protected-artifact-seal.test.ts` — rebaseline evidence assertion

**Wired-into:** none (no new production surface)

**Dependencies:** Task 11

---

### Task 13: Render the new evidence in the daemon event output
**Story:** 6
**Type:** happy-path

**Steps:**
1. Write a failing test asserting each rotation variant renders a human-readable line including the
   new evidence rather than dropping it.
2. Verify test fails (RED).
3. Extend the existing rotation render cases beside their current implementations.
4. Verify test passes (GREEN).
5. Commit with message: "feat(daemon): render rotation provenance evidence"

**Files likely touched:**
- `src/conductor/src/daemon-cli.ts` — extend the existing rotation render cases

**Wired-into:** none (no new production surface)

**Dependencies:** Task 12

---

### Task 14: Prove telemetry never alters policy and adds no channel
**Story:** 6
**Type:** negative-path

**Steps:**
1. Write failing tests: an observer that throws leaves both the rotation verdict and the composed
   seal verdict unchanged; a consumer reading the prior event shape still functions against an event
   carrying the new fields.
2. Add an assertion that this change introduced no new `ConductorEvent` variant, no new `.pipeline`
   ledger file, and no sidecar file.
3. Verify tests fail (RED).
4. Implement whatever the assertions require; the throwing-observer tolerance already exists and
   must be preserved rather than reimplemented.
5. Verify tests pass (GREEN).
6. Commit with message: "test(events): prove rotation telemetry stays on the existing spine"

**Files likely touched:**
- `src/conductor/test/engine/protected-artifact-seal.test.ts` — observer and spine assertions

**Wired-into:** none (no new production surface)

**Dependencies:** Task 13

---

### Task 15: Cover every protected directory in the rotation audit paths
**Story:** 7
**Type:** happy-path

**Steps:**
1. Write failing tests: a rebase advancing a file under `.docs/decisions` records that file in the
   `rebaselines[]` entry's `paths`; an unprotected path never appears; a rebase changing no protected
   artifact records an empty `paths` and still rotates.
2. Add a test that fails if the directory list used for the path diff drifts from
   `PROTECTED_ARTIFACT_DIRECTORIES`.
3. Verify tests fail (RED).
4. Replace the hardcoded directory list in `translateAfterRebase` with the exported constant.
5. Verify tests pass (GREEN), including that a failed path-diff invocation yields empty `paths`
   rather than throwing.
6. Commit with message: "fix(rebase): cover every protected directory in the rotation audit paths"

**Files likely touched:**
- `src/conductor/src/engine/rebase-translate.ts` — use the exported protected-directory constant
- `src/conductor/test/engine/rebase-translate.test.ts` — audit path coverage and drift guard

**Wired-into:** none (no new production surface)

**Dependencies:** Task 14

---

### Task 16: Reproduce the reported incident sequence end to end
**Story:** 8
**Type:** happy-path

**Steps:**
1. Write a failing integration test building a real git fixture: a feature branch rebased onto a
   base commit, the base branch then advancing with a new protected artifact the feature never
   authored, and a seal stranded on the pre-rebase baseline.
2. Assert seal verification passes, the seal's `baselineCommit` advanced to the post-rebase HEAD,
   no `HALT` or `HALT.class` marker exists, and no emitted event carries a feature-authored
   classification.
3. Verify test fails (RED).
4. Confirm the implemented behavior satisfies it, adjusting only within the already-approved design.
5. Verify test passes (GREEN), with the test editing no JSON by hand and invoking no reseal command.
6. Commit with message: "test(seal): reproduce the stranded post-rebase seal recovery"

**Files likely touched:**
- `src/conductor/test/engine/protected-artifact-seal.test.ts` — incident reproduction fixture

**Wired-into:** none (no new production surface)

**Dependencies:** Task 15

---

### Task 17: Prove the fixture still halts on genuine violations
**Story:** 8
**Type:** negative-path

**Steps:**
1. Write failing tests over two variants of Task 16's fixture: one where the feature itself committed
   an edit to another feature's protected artifact, and one with an uncommitted workspace edit to a
   protected artifact.
2. Assert each fails verification naming the path and the halt still occurs.
3. Add a third variant with no remote and no resolvable base ref, asserting the seal is not rotated
   and an otherwise-clean workspace is not halted.
4. Verify tests fail (RED).
5. Confirm the implemented behavior satisfies them.
6. Verify tests pass (GREEN).
7. Commit with message: "test(seal): genuine violations still halt in the reproduction fixture"

**Files likely touched:**
- `src/conductor/test/engine/protected-artifact-seal.test.ts` — negative fixture variants

**Wired-into:** none (no new production surface)

**Dependencies:** Task 16

---

## Task Dependency Graph

```
Task 1 ─▶ Task 2 ─▶ Task 3 ─▶ Task 4 ─▶ Task 5   (pure decision table)
                                          │
                                          ▼
                    Task 6 ─▶ Task 7 ─▶ Task 8   (provenance resolution)
                                          │
                                          ▼
                              Task 9 ─▶ Task 10   (verdict composition)
                                          │
                                          ▼
          Task 11 ─▶ Task 12 ─▶ Task 13 ─▶ Task 14   (telemetry)
                                          │
                                          ▼
                                      Task 15       (audit path coverage)
                                          │
                                          ▼
                              Task 16 ─▶ Task 17   (incident reproduction)
```

The chain is strictly linear by design. The predicate being changed is a tamper-detection boundary,
so each stage is proven before the next widens anything: the fail-closed default (Task 2) lands
before the permitting branch (Task 3), and the escalation boundary is re-proven (Task 10) before
telemetry or the audit trail are touched.

## Integration Points

- **After Task 5:** the corrected decision table is exercisable in full at the pure level, with no
  git fixture required.
- **After Task 8:** rotation runs end to end against a real repository with authorship resolved.
- **After Task 10:** the seal verdict composition is complete and the escalation boundary is proven.
- **After Task 14:** a rotation decision is fully observable through the existing event spine.
- **After Task 17:** the reported incident and its genuine-violation counterparts are covered.

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies are explicit and acyclic
- [ ] `conduct-ts plan-protected-targets` reports no violations
- [ ] `conduct-ts validate-wired-into` reports zero FAIL rows
