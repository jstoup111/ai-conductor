# Implementation Plan: Finish fence rejects a fresh PASS for a gate the last rebase preserved

**Date:** 2026-09-23
**Stories:** .docs/stories/finish-fence-rejects-a-fresh-pass-for-a-gate-the-l.md
**Conflict check:** Not required (Tier S)

## Summary

Make `rebaseOperationPublicationBlocker` accept a preserved gate whose verdict is a fresh satisfied
re-judgement, anchored to a new `appliedAt` stamp on the rebase operation record. Seven tasks.

## Technical Approach

- `RebaseOperationRecord` (`src/conductor/src/engine/gate-verdicts.ts`) gains an optional
  `appliedAt?: number` (epoch ms). `validRebaseOperationRecord` tolerates it absent or a finite
  positive number. The transition writer in `src/conductor/src/engine/rebase-transition.ts` sets it
  when it builds the `applied` record; the `writeVerdict` retention rule already carries the whole
  `rebaseOperation` object through later rebase-verdict rewrites, so the stamp survives restarts.
- `rebaseOperationPublicationBlocker` (`src/conductor/src/engine/gate-code-validity.ts`) computes
  `appliedAtTime = operation.appliedAt ?? rebaseVerdict.checkedAt` and, per preserved gate, passes
  when EITHER the verdict carries a preservation stamp with `gate === gate` and
  `operationId === operation.id` (unchanged authority), OR the verdict is satisfied, has no
  `kickback`, has no `preservation`, and `verdict.checkedAt > appliedAtTime` (fresh re-judgement).
  The unsatisfied/missing branch and both blocker strings are unchanged.
- Nothing else changes: the finish completion predicate in `artifacts.ts` already consults the
  fence, and the `retainReplayPreservation` writer flag is untouched.
- Test pattern: `src/conductor/test/engine/gate-code-validity.test.ts` already has a
  `describe('gateVerdictStillValid')` block with `makeRepo()`, `commit()`, and an `applied`
  rebase-operation fixture (`replay` with `expectedTree`) driving
  `rebaseOperationPublicationBlocker`. Reuse that fixture shape (search hint:
  `rebase-verified-build`); vary only the transition, the preserved-gate verdict, and `checkedAt`
  values. Writer tests live in `src/conductor/test/engine/rebase-transition.test.ts`.

## Prerequisites

- None.

## Tasks

### Task 1: Stamp `appliedAt` on the applied rebase operation record
**Story:** Story 1 — happy path 3 (writer stamps `appliedAt`; record still validates)
**Type:** infrastructure

**Steps:**
1. Write failing test in `src/conductor/test/engine/rebase-transition.test.ts`: after a transition applies, the persisted `rebase` verdict's `rebaseOperation.appliedAt` is a finite number ≥ the test's start time, and `validRebaseOperationRecord` returns `true` for that record.
2. Verify test fails (RED — `appliedAt` is `undefined`).
3. Implement: add `appliedAt?: number` to `RebaseOperationRecord` in `gate-verdicts.ts`; in `validRebaseOperationRecord` return `false` when `appliedAt` is present but not a finite positive number; in `rebase-transition.ts` build the applied record as `{ ...operation, status: 'applied', appliedAt: Date.now() }`.
4. Verify test passes (GREEN).
5. Commit with message: "feat(rebase-transition): stamp appliedAt on the applied rebase operation record"

**Done when:**
- The transition writer's applied `rebaseOperation` carries `appliedAt` as an epoch-millisecond number, asserted by the new rebase-transition test reading the persisted rebase verdict.
- `validRebaseOperationRecord` returns `true` for an applied record with a numeric `appliedAt` and `false` for one whose `appliedAt` is a non-finite or non-number value, asserted by unit tests in the gate-verdicts test file.

**Files likely touched:**
- `src/conductor/src/engine/gate-verdicts.ts` — `appliedAt` field + validation
- `src/conductor/src/engine/rebase-transition.ts` — stamp on applied record
- `src/conductor/test/engine/rebase-transition.test.ts` — stamp assertion
- `src/conductor/test/engine/gate-verdicts.test.ts` — validation assertions

**Dependencies:** none

### Task 2: Fence accepts a fresh satisfied re-judgement of a preserved gate
**Story:** Story 1 — happy paths 1 and 2; Story 3 — happy path 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/gate-code-validity.test.ts` (reuse the `rebase-verified-build` fixture shape; see Technical Approach): (a) applied operation with `appliedAt: 100` preserving `prd_audit`, and `prd_audit.json` `{ satisfied: true, checkedAt: 200 }` with no `preservation`/`kickback` → blocker resolves `null`; (b) operation preserving `build_review` and `prd_audit`, `build_review` stamped `{ gate: 'build_review', operationId: <op id>, … }`, `prd_audit` as in (a) → `null`; (c) only `build_review`, correctly stamped → `null` (unchanged authority).
2. Verify (a) and (b) fail (RED) with `without its replay-bound authority`; (c) passes already.
3. Implement in `rebaseOperationPublicationBlocker`: compute `appliedAtTime = operation.appliedAt ?? rebase.checkedAt`; replace the stamp-only check with `stamped || freshRejudgement`, where `stamped` is the existing `preservation.gate === gate && preservation.operationId === operation.id` test and `freshRejudgement` is `verdict.satisfied && !verdict.kickback && !verdict.preservation && verdict.checkedAt > appliedAtTime`.
4. Verify tests pass (GREEN).
5. Commit with message: "fix(gate-code-validity): accept a fresh satisfied re-judgement for a rebase-preserved gate"

**Done when:**
- `rebaseOperationPublicationBlocker` returns `null` when the only preserved gate's verdict is satisfied, unstamped, kickback-free, and has `checkedAt` greater than the operation's `appliedAt`, asserted by test (a).
- `rebaseOperationPublicationBlocker` returns `null` when one preserved gate carries its operation-bound preservation stamp and a sibling preserved gate is a fresh re-judgement, asserted by test (b).
- `rebaseOperationPublicationBlocker` returns `null` for a preserved gate whose preservation stamp names that gate and the applied operation id, asserted by test (c).

**Files likely touched:**
- `src/conductor/src/engine/gate-code-validity.ts` — fence predicate
- `src/conductor/test/engine/gate-code-validity.test.ts` — tests (a)–(c)

**Dependencies:** 1

### Task 3: Fresh re-judgement survives a later rebase-verdict rewrite; legacy records fall back
**Story:** Story 1 — happy paths 4 and 5
**Type:** happy-path

**Steps:**
1. Write failing tests in `gate-code-validity.test.ts`: (d) operation with `appliedAt: 100` preserving `prd_audit`, `prd_audit.json` `checkedAt: 200` fresh, then `writeVerdict(repo, 'rebase', { satisfied: true, checkedAt: 300, reason: 'branch already current with base' })` (no `rebaseOperation`, so the operation is retained) → blocker resolves `null`; (e) operation with NO `appliedAt` written under a rebase verdict `checkedAt: 100`, `prd_audit.json` `checkedAt: 200` fresh → `null`.
2. Verify (d) fails (RED) only if Task 2 compared against the rebase verdict's `checkedAt`; with Task 2's `appliedAt ?? checkedAt` both should pass — if both pass on first run, record that in the commit body and keep the tests as regression guards.
3. Implement: none expected beyond Task 2; adjust only if RED.
4. Verify tests pass (GREEN).
5. Commit with message: "test(gate-code-validity): fresh re-judgement anchors to appliedAt and falls back for legacy records"

**Done when:**
- `rebaseOperationPublicationBlocker` returns `null` after the rebase gate verdict is rewritten with a `checkedAt` newer than the fresh re-judgement while `rebaseOperation.appliedAt` is older, asserted by test (d).
- `rebaseOperationPublicationBlocker` returns `null` for an operation lacking `appliedAt` when the fresh verdict's `checkedAt` exceeds the rebase gate verdict's `checkedAt`, asserted by test (e).

**Files likely touched:**
- `src/conductor/test/engine/gate-code-validity.test.ts` — tests (d)–(e)
- `src/conductor/src/engine/gate-code-validity.ts` — only if RED

**Dependencies:** 2

### Task 4: Unstamped verdicts that are not newer, or carry a kickback, still block
**Story:** Story 1 — negative paths 1 and 2
**Type:** negative-path

**Steps:**
1. Write failing-or-guarding tests in `gate-code-validity.test.ts`: (f) `appliedAt: 200`, `prd_audit.json` `{ satisfied: true, checkedAt: 200 }` unstamped → blocker equals `rebase transition preserved prd_audit without its replay-bound authority`; (f2) same with `checkedAt: 150` → same string; (g) `appliedAt: 100`, `prd_audit.json` `{ satisfied: true, checkedAt: 200, kickback: { from: 'rebase', evidence: 'x' } }` unstamped → same string.
2. Verify against Task 2's implementation (expected GREEN — these bound the new acceptance); if any passes the fence, tighten the predicate.
3. Implement: none expected.
4. Verify tests pass (GREEN).
5. Commit with message: "test(gate-code-validity): unstamped stale or kicked-back preserved verdicts still block finish"

**Done when:**
- `rebaseOperationPublicationBlocker` returns exactly `rebase transition preserved prd_audit without its replay-bound authority` for an unstamped satisfied verdict whose `checkedAt` equals or precedes the applied-at time, asserted by tests (f) and (f2).
- `rebaseOperationPublicationBlocker` returns exactly `rebase transition preserved prd_audit without its replay-bound authority` for an unstamped satisfied verdict newer than the applied-at time that carries a `kickback` record, asserted by test (g).

**Files likely touched:**
- `src/conductor/test/engine/gate-code-validity.test.ts` — tests (f), (f2), (g)

**Dependencies:** 2

### Task 5: Unsatisfied, missing, or wrongly-bound preserved verdicts still block
**Story:** Story 2 — happy paths 1 and 2; negative paths 1 and 2
**Type:** negative-path

**Steps:**
1. Write tests in `gate-code-validity.test.ts`, each with an applied operation preserving `build_review`: (h) `build_review.json` `{ satisfied: false, checkedAt: 200 }` → `rebase transition still has an outstanding build_review repair or re-verification`; (i) no `build_review.json` file → same string; (j) satisfied, `checkedAt: 200`, `preservation.operationId: 'other-op'`, `preservation.gate: 'build_review'` → `rebase transition preserved build_review without its replay-bound authority`; (k) satisfied, `checkedAt: 200` (newer than `appliedAt: 100`), `preservation.gate: 'prd_audit'`, `preservation.operationId: <op id>` → same `without its replay-bound authority` string.
2. Run the existing `still applying` and malformed-record tests alongside; all must pass.
3. Implement: none expected — (j)/(k) exercise the rule that a verdict *with* a preservation stamp is never treated as a fresh re-judgement; tighten if any passes the fence.
4. Verify tests pass (GREEN).
5. Commit with message: "test(gate-code-validity): unsatisfied, missing, and wrongly-bound preserved verdicts keep blocking finish"

**Done when:**
- `rebaseOperationPublicationBlocker` returns exactly `rebase transition still has an outstanding build_review repair or re-verification` for an unsatisfied `build_review` verdict and for a missing `build_review` verdict file, asserted by tests (h) and (i).
- `rebaseOperationPublicationBlocker` returns exactly `rebase transition preserved build_review without its replay-bound authority` for a satisfied verdict stamped with another operation id, and for a newer satisfied verdict stamped for a different gate, asserted by tests (j) and (k).
- The existing `still applying` and malformed-record fence tests in the same file pass unchanged.

**Files likely touched:**
- `src/conductor/test/engine/gate-code-validity.test.ts` — tests (h)–(k)

**Dependencies:** 2

### Task 6: Stamped preserved verdicts pass regardless of age, and the retaining recheck keeps the stamp
**Story:** Story 3 — happy path 2; negative path 1
**Type:** happy-path

**Steps:**
1. Write tests in `gate-code-validity.test.ts`: (l) `appliedAt: 200`, `build_review.json` satisfied, `checkedAt: 100`, stamped `{ gate: 'build_review', operationId: <op id>, … }` → blocker `null`; (m) with the same stamped verdict on disk, call `computeAndWriteVerdict(repo, 'build_review', ctx, { retainReplayPreservation: true })` under a `ctx` whose `build_review` predicate is satisfied (mirror how the existing file satisfies `build_review` — search hint: `writeBuildReviewIdentity`), then assert `readVerdict(...).preservation` deep-equals the original stamp and the blocker still resolves `null`.
2. Verify (expected GREEN; these are regression guards for unchanged behaviour).
3. Implement: none expected.
4. Verify tests pass (GREEN).
5. Commit with message: "test(gate-code-validity): stamped preserved verdicts keep replay-bound authority regardless of checkedAt"

**Done when:**
- `rebaseOperationPublicationBlocker` returns `null` for a preserved gate whose verdict is stamped for the applied operation even though its `checkedAt` precedes `appliedAt`, asserted by test (l).
- `computeAndWriteVerdict` with `retainReplayPreservation: true` on a satisfied stamped prior persists a verdict whose `preservation` deep-equals the prior stamp, and `rebaseOperationPublicationBlocker` then returns `null`, asserted by test (m).

**Files likely touched:**
- `src/conductor/test/engine/gate-code-validity.test.ts` — tests (l)–(m)

**Dependencies:** 2

### Task 7: Finish completion predicate no longer reports the fence for a fresh re-judgement
**Story:** Story 1 — Done When item 2 (finish predicate through the production entry point)
**Type:** happy-path

**Steps:**
1. Write test in `gate-code-validity.test.ts` (or `artifacts.test.ts` if its fixtures fit better): with the Task 2 (a) fixture on disk, call `checkGateCompletion(repo, 'finish', {})` from `src/conductor/src/engine/artifacts.ts` and assert `result.reason` does not contain `replay-bound authority` and does not contain `outstanding prd_audit`; add a sibling assertion that with the Task 4 (f) fixture the reason equals the `without its replay-bound authority` string and `done` is `false`.
2. Verify the first assertion fails (RED) against the pre-Task-2 predicate by temporarily checking out the merge-base `gate-code-validity.ts` via `git show`, then restore; verify the second passes.
3. Implement: none expected — the finish predicate already consults `rebaseOperationPublicationBlocker` first.
4. Verify tests pass (GREEN).
5. Commit with message: "test(artifacts): finish predicate accepts a fresh re-judgement of a rebase-preserved gate"

**Done when:**
- `checkGateCompletion(dir, 'finish')` returns a result whose `reason` contains neither `replay-bound authority` nor `outstanding prd_audit` when the only preserved gate is a fresh re-judgement, asserted by the new finish-predicate test.
- `checkGateCompletion(dir, 'finish')` returns `done: false` with `reason` equal to `rebase transition preserved prd_audit without its replay-bound authority` when the unstamped verdict is not newer than the applied-at time, asserted by the sibling assertion.

**Files likely touched:**
- `src/conductor/test/engine/gate-code-validity.test.ts` — finish predicate assertions

**Dependencies:** 2, 4

## Task Dependency Graph

```
1 → 2 → 3
    2 → 4 → 7
    2 → 5
    2 → 6
```

## Integration Points

- After Task 2: the halted-feature scenario from #2680 (preserved `prd_audit`, later fresh PASS) resolves `null` from the fence.
- After Task 7: the finish completion predicate is proven to consult the relaxed fence through `checkGateCompletion`.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given an applied rebase record preserving `prd_audit`, and a `prd_audit` verdict that is satisfied, has no kickback, has no preservation stamp, and has `checkedAt` newer than the applied-at time, when the finish publication fence is evaluated, then it returns no blocker | 2 | "returns `null` when the only preserved gate's verdict is satisfied, unstamped, kickback-free, and has `checkedAt` greater than the operation's `appliedAt`" | diff-local |
| Story 1 happy: Given an applied rebase record preserving `build_review` and `prd_audit`, where `build_review` still carries its replay-bound preservation stamp for that operation and `prd_audit` is a fresh re-judgement, when the finish publication fence is evaluated, then it returns no blocker | 2 | "returns `null` when one preserved gate carries its operation-bound preservation stamp and a sibling preserved gate is a fresh re-judgement" | diff-local |
| Story 1 happy: Given a rebase transition being committed by the transition writer, when the operation is marked `applied`, then the persisted `rebaseOperation` carries an `appliedAt` epoch-millisecond stamp and the operation still validates as a well-formed record | 1 | "applied `rebaseOperation` carries `appliedAt` as an epoch-millisecond number" | diff-local |
| Story 1 happy: Given an applied rebase record with an `appliedAt` stamp preserving `prd_audit`, and a fresh re-judgement of `prd_audit`, when the rebase gate verdict is later rewritten with a newer `checkedAt` that retains the operation and the finish publication fence is evaluated, then it returns no blocker | 3 | "returns `null` after the rebase gate verdict is rewritten with a `checkedAt` newer than the fresh re-judgement while `rebaseOperation.appliedAt` is older" | diff-local |
| Story 1 happy: Given an applied rebase record with no `appliedAt` stamp preserving `prd_audit`, and a `prd_audit` verdict that is satisfied, unstamped, has no kickback, and has `checkedAt` newer than the rebase gate verdict's `checkedAt`, when the finish publication fence is evaluated, then it returns no blocker | 3 | "returns `null` for an operation lacking `appliedAt` when the fresh verdict's `checkedAt` exceeds the rebase gate verdict's `checkedAt`" | diff-local |
| Story 1 negative: Given an applied rebase record preserving `prd_audit`, and a `prd_audit` verdict that is satisfied with no preservation stamp but whose `checkedAt` is older than or equal to the applied-at time, when the finish publication fence is evaluated, then it returns the blocker `rebase transition preserved prd_audit without its replay-bound authority` | 4 | "for an unstamped satisfied verdict whose `checkedAt` equals or precedes the applied-at time" | diff-local |
| Story 1 negative: Given an applied rebase record preserving `prd_audit`, and a `prd_audit` verdict that is satisfied, newer than the applied-at time, has no preservation stamp, but carries a `kickback` record, when the finish publication fence is evaluated, then it returns the blocker `rebase transition preserved prd_audit without its replay-bound authority` | 4 | "for an unstamped satisfied verdict newer than the applied-at time that carries a `kickback` record" | diff-local |
| Story 2 happy: Given an applied rebase record preserving `build_review`, and a `build_review` verdict that is unsatisfied, when the finish publication fence is evaluated, then it returns the blocker `rebase transition still has an outstanding build_review repair or re-verification` | 5 | "for an unsatisfied `build_review` verdict and for a missing `build_review` verdict file" | diff-local |
| Story 2 happy: Given an applied rebase record preserving `build_review`, and a `build_review` verdict that is satisfied and stamped with a preservation record bound to a different operation id, when the finish publication fence is evaluated, then it returns the blocker `rebase transition preserved build_review without its replay-bound authority` | 5 | "for a satisfied verdict stamped with another operation id" | diff-local |
| Story 2 negative: Given an applied rebase record preserving `build_review`, and no persisted `build_review` verdict file at all, when the finish publication fence is evaluated, then it returns the blocker `rebase transition still has an outstanding build_review repair or re-verification` | 5 | "for a missing `build_review` verdict file" | diff-local |
| Story 2 negative: Given an applied rebase record preserving `build_review`, and a `build_review` verdict that is satisfied, newer than the applied-at time, and stamped with a preservation record whose `gate` names a different step, when the finish publication fence is evaluated, then it returns the blocker `rebase transition preserved build_review without its replay-bound authority` | 5 | "for a newer satisfied verdict stamped for a different gate" | diff-local |
| Story 3 happy: Given an applied rebase record preserving `build_review`, and a `build_review` verdict that is satisfied and stamped with a preservation record whose `gate` is `build_review` and whose `operationId` equals the applied operation's id, when the finish publication fence is evaluated, then it returns no blocker | 2 | "returns `null` for a preserved gate whose preservation stamp names that gate and the applied operation id" | diff-local |
| Story 3 happy: Given that same stamped `build_review` verdict, when the finish-time validation-group recheck rewrites the verdict with replay preservation retained, then the rewritten verdict still carries the same preservation stamp and the finish publication fence still returns no blocker | 6 | "persists a verdict whose `preservation` deep-equals the prior stamp, and `rebaseOperationPublicationBlocker` then returns `null`" | diff-local |
| Story 3 negative: Given an applied rebase record preserving `build_review`, and a stamped `build_review` verdict whose `checkedAt` is older than the applied-at time, when the finish publication fence is evaluated, then it returns no blocker, because the stamp alone is sufficient authority | 6 | "returns `null` for a preserved gate whose verdict is stamped for the applied operation even though its `checkedAt` precedes `appliedAt`" | diff-local |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic
