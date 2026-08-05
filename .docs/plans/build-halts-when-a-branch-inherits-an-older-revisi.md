# Implementation Plan: Inherited-revision tolerance in the protected-artifact seal (#1315)

**Date:** 2026-08-05
**Stem:** build-halts-when-a-branch-inherits-an-older-revisi
**Track:** technical (no PRD)
**Tier:** M
**Stories:** .docs/stories/build-halts-when-a-branch-inherits-an-older-revisi.md
**Conflict check:** Clean as of 2026-08-05 — 0 blocking, 1 degrading resolved

## Summary

Widen the protected-artifact seal's base-inheritance tolerance from "byte-identical to the base tip"
to "byte-identical to the base tip **or** demonstrably untouched by this branch", and give every
remaining refusal a named cause and recovery. 15 tasks, all inside one engine module plus its tests.

## Technical Approach

**One predicate, one file.** `inheritedFromBase` (`protected-artifact-seal.ts:580-583`) is already
the single lazily-invoked gate consulted by both refusal branches (`:610` for `added`, `:623` for
`changed`). Everything behavioral in this plan happens inside that predicate and the two `return`
statements that follow it. No call site, option, schema, or halt class changes.

**Union, never replacement (review condition C-1).** `matchesBaseTip` (`:551-563`) stays exactly as
it is and is tried first — it is one `git show` and it accepts content the new probe would not
(a workspace copy differing from `HEAD` but equal to the base tip). The new probe runs only when the
tip test declines. This ordering is what makes the change strictly widening.

**The new probe asks about the branch, not the revision.** Untouched inheritance is two read-only
git facts: `git diff --name-only <baseRef>...HEAD -- <path>` is empty (the branch's own commits,
against its merge-base, contain no change to that path), and the workspace copy equals `HEAD:<path>`
(no uncommitted edit). The `A...B` form resolves the merge-base itself, so no separate
`git merge-base` call is needed. Verified against the real repository on the branch named in #1315:
the probe returns empty for an inherited untouched path, and the amended plan's own history on main
is two commits — this is cheap on real data.

**Fail closed on every probe failure (C-4).** Non-zero exit, unresolvable base ref, or absent
merge-base all deny tolerance and produce the `undeterminable` cause. `resolveBaseTipRef`
(`:525-537`) already returns `undefined` rather than throwing, and stays no-fetch.

**Cause replaces a bare string (C-3).** The two refusal `return`s become a small internal result
carrying which check declined, rendered into a multi-line reason whose **first** line is the terse
classification — the daemon dashboard surfaces only the first non-empty line
(`halt-marker.ts:38-39`) and the BUILD path writes the reason verbatim with no recovery note
appended (`conductor.ts:4896`). No production code parses this text; the machine-readable
discriminator remains `.pipeline/HALT.class`, unchanged at `protected-artifact`.

**The fixture is the first task, not an afterthought (C-2).** `advanceBase`
(`protected-artifact-seal.test.ts:545`) commits base advances onto the checked-out branch, so base
tip and HEAD are always the same commit and #1315's shape is unreachable. Until the fixture can
advance the base *without* moving HEAD, every test written for this feature would pass against both
old and new code and prove nothing. Task 1 exists so Task 2's RED is a real RED.

## Prerequisites

- No new dependency, no new configuration key, no operator action.
- Node toolchain per `src/conductor/.tool-versions`.

**Documentation note.** This repository routes human-facing documentation through its
`maintain-documentation` custom step, so review condition C-5
(`docs/runbooks/stalled-or-stuck-feature.md:403`, `docs/guides/running-the-daemon.md:112`, and the
`docs/reference/artifacts.md` seal entries) carries no plan task here. It remains required before
the PR is complete.

## Task Dependency Graph

```text
Task 1 (fixture)
  └─ Task 2 (probe + union, changed branch)
       ├─ Task 3 (added branch)
       ├─ Task 4 (C-1 tip-acceptance guard)
       ├─ Task 5 (laziness guard)
       ├─ Task 6 ─ Task 7 ─ Task 8 ─ Task 9   (Story 2 refusals)
       └─ Task 10 (cause type + rendering)
            ├─ Task 11 (halt class pin)
            └─ Task 12 ─ Task 13 ─ Task 14    (Story 4 undeterminable causes)
                 └─ Task 15 (acceptance)
```

## Tasks

### Task 1: Give the seal fixture a base advance that does not move HEAD
**Story:** Story 1
**Type:** test-infrastructure
**Dependencies:** none
**Wired-into:** none (test helper; no production surface)

**Steps:**
1. Read `advanceBase` (`protected-artifact-seal.test.ts:545`) and the file-level `makeRepo` (`:34`).
2. Add a sibling helper that commits files onto the base branch while leaving the feature branch's
   `HEAD` where it is — e.g. by committing on a detached base checkout or via `git update-ref` on the
   base branch — so base tip and merge-base can differ.
3. Assert in a self-test that after the helper runs, `git rev-parse HEAD` is unchanged and
   `git merge-base HEAD <base>` is strictly behind the base tip.
4. Verify the self-test passes.
5. Commit: "test(seal): let the base advance without moving the feature HEAD"

**Files:**
- `src/conductor/test/engine/protected-artifact-seal.test.ts` — new helper + self-test

---

### Task 2: Tolerate an inherited artifact the branch never modified
**Story:** Story 1
**Type:** feature
**Dependencies:** Task 1
**Wired-into:** none (module-private predicate consumed by `inspectSeal` in the same file)

**Steps:**
1. Write a failing test using Task 1's helper: seal a workspace, advance the base branch with an
   amendment to another feature's protected artifact, leave the branch untouched and behind, verify
   the seal. Expect `ok: true`.
2. Verify the test fails against current code with `Protected artifact changed: <path>` — the exact
   #1315 symptom, not an unrelated error (RED).
3. Add a module-private `branchUntouchedInheritance(projectRoot, baseRef, path)` running
   `git diff --name-only <baseRef>...HEAD -- <path>` and comparing the workspace copy to
   `HEAD:<path>`; return an accept/decline result carrying the declining reason.
4. Make `inheritedFromBase` return true when `matchesBaseTip` accepts **or** the new probe accepts,
   preserving the existing call order and laziness.
5. Verify the test passes (GREEN).
6. Commit: "fix(seal): tolerate a protected artifact this branch never modified"

**Files:**
- `src/conductor/src/engine/protected-artifact-seal.ts` — new probe + widened `inheritedFromBase`
- `src/conductor/test/engine/protected-artifact-seal.test.ts` — RED test

---

### Task 3: Apply the same tolerance to a newly-inherited artifact
**Story:** Story 1
**Type:** feature
**Dependencies:** Task 2
**Wired-into:** none

**Steps:**
1. Write a failing test where the artifact is absent from the seal entirely (baseline predates its
   arrival on the base branch) and the branch never touched it. Expect `ok: true`.
2. Verify it fails with `Protected artifact added: <path>` (RED).
3. Confirm the `added` branch (`:610`) consults the widened predicate; adjust if it bypasses it.
4. Verify the test passes (GREEN).
5. Commit: "fix(seal): inherit-tolerate an artifact absent from the seal baseline"

**Files:**
- `src/conductor/src/engine/protected-artifact-seal.ts`
- `src/conductor/test/engine/protected-artifact-seal.test.ts`

---

### Task 4: Pin that base-tip acceptance survives the widening
**Story:** Story 1
**Type:** test
**Dependencies:** Task 2
**Wired-into:** none

**Steps:**
1. Write a test where the workspace copy is byte-identical to the base tip but differs from
   `HEAD:<path>` — the case the new probe declines and the tip test accepts.
2. Assert `ok: true`, proving the tolerance is a union and not a replacement (C-1).
3. Verify it passes.
4. Commit: "test(seal): pin base-tip acceptance as an independent accepting case"

**Files:**
- `src/conductor/test/engine/protected-artifact-seal.test.ts`

---

### Task 5: Keep the clean path free of git invocations
**Story:** Story 1
**Type:** test
**Dependencies:** Task 2
**Wired-into:** none

**Steps:**
1. Write a test over a fully clean workspace (no unexpected path, no fingerprint mismatch) that
   counts git invocations and asserts zero.
2. Verify it passes, confirming `baseRef()`'s lazy resolution is intact.
3. Commit: "test(seal): assert the clean workspace shells out to git zero times"

**Files:**
- `src/conductor/test/engine/protected-artifact-seal.test.ts`

---

### Task 6: A committed modification still refuses
**Story:** Story 2
**Type:** test
**Dependencies:** Task 2
**Wired-into:** none

**Steps:**
1. Write a test where the branch commits an edit to another feature's protected artifact while also
   being behind the base tip on it.
2. Assert `ok: false` — being behind does not excuse a modification.
3. Verify it passes.
4. Commit: "test(seal): a committed edit to another feature's artifact still halts"

**Files:**
- `src/conductor/test/engine/protected-artifact-seal.test.ts`

---

### Task 7: An uncommitted worktree edit still refuses
**Story:** Story 2
**Type:** test
**Dependencies:** Task 6
**Wired-into:** none

**Steps:**
1. Write a test where the branch's commits contain no change to the path but the working-tree copy
   differs from `HEAD:<path>`.
2. Assert `ok: false`.
3. Verify it passes.
4. Commit: "test(seal): an uncommitted edit is not inheritance"

**Files:**
- `src/conductor/test/engine/protected-artifact-seal.test.ts`

---

### Task 8: A revert to a historical base revision still refuses
**Story:** Story 2
**Type:** test
**Dependencies:** Task 7
**Wired-into:** none

**Steps:**
1. Write a test where the branch commits a revert of another feature's artifact to an older revision
   that genuinely existed on the base branch.
2. Assert `ok: false` — the accepted provenance is "this branch did not change it", never "this
   content existed once".
3. Verify it passes.
4. Commit: "test(seal): a historical revision is not an accepted provenance"

**Files:**
- `src/conductor/test/engine/protected-artifact-seal.test.ts`

---

### Task 9: Deletion and self-amendment paths are untouched
**Story:** Story 2
**Type:** test
**Dependencies:** Task 8
**Wired-into:** none

**Steps:**
1. Write a test asserting a deleted expected artifact still refuses with the `deleted` branch and
   never reaches the inheritance predicate.
2. Run the existing `own-feature self-amendment durable reporting behavior` block
   (`protected-artifact-seal.test.ts:415`) unmodified and confirm it passes.
3. Verify both.
4. Commit: "test(seal): deletion and self-amendment behavior unchanged by the widening"

**Files:**
- `src/conductor/test/engine/protected-artifact-seal.test.ts`

---

### Task 10: Give each refusal a cause and a recovery
**Story:** Story 3
**Type:** feature
**Dependencies:** Task 2
**Wired-into:** none (internal result type consumed by `inspectSeal` in the same file)

**Steps:**
1. Write failing tests asserting: a committed modification's reason starts with
   `Protected artifact changed: <path>` and later names reverting to the committed DECIDE content;
   an uncommitted edit's first line distinguishes it and later names restoring from `HEAD`.
2. Verify they fail (RED).
3. Introduce an internal cause result on the inheritance probe and render it into a multi-line
   reason, classification first (C-3).
4. Update the existing assertions in `protected-artifact-seal.test.ts` and
   `protected-artifact-seal-rebaseline-976.acceptance.test.ts` that match the old single-line text.
5. Verify the tests pass (GREEN).
6. Commit: "feat(seal): name the cause and recovery in a protected-artifact refusal"

**Files:**
- `src/conductor/src/engine/protected-artifact-seal.ts`
- `src/conductor/test/engine/protected-artifact-seal.test.ts`
- `src/conductor/test/acceptance/protected-artifact-seal-rebaseline-976.acceptance.test.ts`

---

### Task 11: Pin the halt class across the wording change
**Story:** Story 3
**Type:** test
**Dependencies:** Task 10
**Wired-into:** none

**Steps:**
1. Extend the conductor-seam test (`conductor-protected-artifact-advisory.test.ts`) to assert the
   written `HALT.class` is still `protected-artifact` and that the halt body's first line is the
   classification.
2. Verify it passes.
3. Commit: "test(seal): pin the halt class and first-line contract"

**Files:**
- `src/conductor/test/engine/conductor-protected-artifact-advisory.test.ts`

---

### Task 12: An unresolvable base ref reports undeterminable
**Story:** Story 4
**Type:** feature
**Dependencies:** Task 10
**Wired-into:** none

**Steps:**
1. Write a failing test verifying a seal with no `baseBranch` supplied (the interactive `conduct`
   shape, `index.ts:1167-1185`) against a fingerprint mismatch; expect `ok: false` with a reason
   naming undeterminable provenance and the missing base ref.
2. Verify it fails (RED).
3. Map `resolveBaseTipRef`'s `undefined` to the undeterminable cause instead of a silent decline.
4. Verify the test passes (GREEN).
5. Commit: "feat(seal): report an unresolvable base ref as undeterminable provenance"

**Files:**
- `src/conductor/src/engine/protected-artifact-seal.ts`
- `src/conductor/test/engine/protected-artifact-seal.test.ts`

---

### Task 13: An absent merge-base names rebasing as the recovery
**Story:** Story 4
**Type:** feature
**Dependencies:** Task 12
**Wired-into:** none

**Steps:**
1. Write a failing test where the branch and base share no merge-base (unrelated histories); expect
   a reason naming the absent merge-base and identifying a rebase onto the base branch as the fix.
2. Verify it fails (RED).
3. Distinguish the absent-merge-base probe failure from other non-zero exits in the cause.
4. Verify the test passes (GREEN).
5. Commit: "feat(seal): name the rebase recovery when no merge-base exists"

**Files:**
- `src/conductor/src/engine/protected-artifact-seal.ts`
- `src/conductor/test/engine/protected-artifact-seal.test.ts`

---

### Task 14: Any other probe failure denies tolerance
**Story:** Story 4
**Type:** test
**Dependencies:** Task 13
**Wired-into:** none

**Steps:**
1. Write a test forcing a non-zero git exit from the diff probe; assert `ok: false` with the failed
   probe named and no accepting verdict (C-4).
2. Assert the undeterminable wording is *not* used when probes succeed and a real modification is
   present.
3. Verify both pass.
4. Commit: "test(seal): every probe failure fails closed and names the probe"

**Files:**
- `src/conductor/test/engine/protected-artifact-seal.test.ts`

---

### Task 15: Acceptance — reproduce #1315 end to end
**Story:** Story 1
**Type:** acceptance
**Dependencies:** Task 14
**Wired-into:** none

**Steps:**
1. Add an acceptance case building the #1315 shape at the conductor seam: a feature branch mid-BUILD
   whose base advanced with another feature's plan amendment after its merge-base.
2. Assert the BUILD step proceeds and no `.pipeline/HALT` is written.
3. Assert the tampering counterpart on the same fixture still halts with `HALT.class`
   `protected-artifact`.
4. Verify the acceptance case passes.
5. Commit: "test(seal): acceptance coverage for the #1315 inherited-revision halt"

**Files:**
- `src/conductor/test/acceptance/protected-artifact-seal-rebaseline-976.acceptance.test.ts` — new
  story-tagged cases alongside the existing ST-976 set
