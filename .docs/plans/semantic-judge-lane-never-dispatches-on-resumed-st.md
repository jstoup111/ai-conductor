# Implementation Plan: Judge lane dispatches on resumed/stalled build-gate residue (#570)

**Date:** 2026-07-19
**Design:** technical track (no PRD) — `.docs/track/semantic-judge-lane-never-dispatches-on-resumed-st.md`
**Stories:** `.docs/stories/semantic-judge-lane-never-dispatches-on-resumed-st.md`
**Complexity:** `.docs/complexity/semantic-judge-lane-never-dispatches-on-resumed-st.md` (Tier S)
**Conflict check:** Skipped (Small tier)
**Source:** `jstoup111/ai-conductor#570`

## Summary
Remove the `!isZeroWork` clause from the #520 attribution-judge dispatch predicate so the judge
fires on inherited build-gate residue (prior-run commits) even when the current attempt added no new
commits. 6 tasks: 3 test-first behavior tasks, 1 minimal production edit, 1 invariant-guard test,
1 docs/changelog task.

## Technical Approach
The judge lane block lives at `src/conductor/src/engine/conductor.ts:3037-3132`, inside the
auto-heal/completion-check region. Its dispatch predicate (`:3057-3062`) currently requires
`residueIds.length > 0 && planPathOrNull && headShaAfterBuild && !isZeroWork`, where
`isZeroWork = detectZeroWorkProduct({ headBefore: headShaBeforeBuild, headAfter: headShaAfterBuild })`
(`:3048`). `headShaBeforeBuild` is captured once at build-step entry (`:2626`), so on a resumed run it
already contains the prior run's commits; an attempt that adds nothing yields
`headBefore === headAfter` → `isZeroWork === true` → the verifier is never dispatched.

**Fix (Approach A):** delete `!isZeroWork` from the predicate and delete the now-unused `isZeroWork`
computation (`:3048-3053`) inside the judge block. `headShaAfterBuild` is retained (still used by the
`headShaAfterBuild &&` guard and as the `headSha` passed to `runAttributionLane`). The lane already
receives `isZeroWorkProduct: false` hardcoded (`:3072`), so its internal zero-work guard
(`attribution-lane.ts:442`) was already inert for this caller — the conductor predicate was the sole
suppressor. Both existing no-op paths are untouched: cutover gating at `:3037-3039`
(`isAttributionJudgeCutoverActive`) and the empty-residue guard (`residueIds.length > 0` in the
predicate + `attribution-lane.ts:447`).

**Do NOT touch** the separate, correct zero-work use at `conductor.ts:3236-3299` (the retry/stall
kickback path: `zero_work_product` event, corrective retry-hint preamble, no-evidence ledger tag).
There "this attempt made no progress" is exactly the right signal — that block is a different scope
with its own `const isZeroWork` (`:3244`) and must remain byte-for-byte unchanged.

**Test strategy:** drive behavior at the conductor level using the existing harness in
`src/conductor/test/engine/attribution-conductor-wiring.test.ts` (real `Conductor` + a
`DefaultStepRunner`/stub `stepRunner` whose `dispatchVerifier` is a `vi.fn()` spy). Seed `.pipeline`
task-status/derived-completion so a build gate-miss produces residue, arm/disarm
`attribution_judge_cutover` in `HarnessConfig`, and control commits so `headShaBeforeBuild ===
headShaAfterBuild` (inherited-residue shape). Assert the spy call count.

## Prerequisites
- None. Single-file production change plus tests within the existing `src/conductor` package. Run the
  engine test suite (`vitest`) from `src/conductor`.

## Tasks

### Task 1: RED — judge dispatches on inherited residue (no new commits)
**Story:** "Judge lane dispatches on inherited residue when the current attempt added no new commits" — happy path.
**Type:** happy-path

**Steps:**
1. Write failing test in `attribution-conductor-wiring.test.ts`: construct a `Conductor` in `auto`
   mode with `attribution_judge_cutover` set to a PAST timestamp; seed `.pipeline` state so the build
   step's derived completion yields a non-empty residue set; make `dispatchVerifier` a `vi.fn()` spy;
   arrange the run so `headShaBeforeBuild === headShaAfterBuild` (no new commits this attempt). Assert
   `dispatchVerifier` was called exactly once.
2. Verify test fails (RED) — on current code the `!isZeroWork` guard suppresses dispatch, so the spy
   is never called (call count 0).
3. (No implementation in this task — RED only; GREEN lands in Task 4.)
4. Leave the test failing; commit the RED test.
5. Commit with message: "test(#570): RED — judge lane must dispatch on inherited residue (no new commits)"

**Files likely touched:**
- `src/conductor/test/engine/attribution-conductor-wiring.test.ts` — new failing test for inherited-residue dispatch

**Wired-into:** none (no new production surface)
**Dependencies:** none

### Task 2: RED — no-op when cutover disabled/absent (with inherited residue)
**Story:** "Judge lane no-ops when the cutover is disabled or absent" — happy + negative path.
**Type:** negative-path

**Steps:**
1. Write failing test asserting the negative guarantee is *pinned*: with `attribution_judge_cutover`
   undefined AND inherited residue (no new commits), `dispatchVerifier` (spy) is NEVER called; add a
   second case with a FUTURE `attribution_judge_cutover` asserting the same. (These pass on current
   code — they are regression pins that must STILL hold after Task 4 removes `!isZeroWork`.)
2. Verify the tests pass now (they encode behavior that must survive the fix — run before Task 4 to
   confirm the baseline, then again after Task 4).
3. (No implementation — pins only.)
4. Confirm both cutover-off cases assert zero spy calls.
5. Commit with message: "test(#570): pin cutover-disabled/future no-op under inherited residue"

**Files likely touched:**
- `src/conductor/test/engine/attribution-conductor-wiring.test.ts` — cutover-off / future-cutover no-op pins

**Wired-into:** none (no new production surface)
**Dependencies:** none

### Task 3: RED — no-op when residue set is empty
**Story:** "Judge lane no-ops when the residue set is empty" — happy + negative path.
**Type:** negative-path

**Steps:**
1. Write failing test: with cutover armed and derived completion showing every task
   completed/skipped (`residueIds.length === 0`), assert `dispatchVerifier` (spy) is NEVER called —
   and assert it holds whether or not the current attempt added new commits. (Passes on current code;
   a regression pin that must survive Task 4.)
2. Verify the test passes now (baseline), to be re-run after Task 4.
3. (No implementation — pin only.)
4. Confirm zero spy calls in both commit/no-commit sub-cases.
5. Commit with message: "test(#570): pin empty-residue no-op independent of zero-work signal"

**Files likely touched:**
- `src/conductor/test/engine/attribution-conductor-wiring.test.ts` — empty-residue no-op pin

**Wired-into:** none (no new production surface)
**Dependencies:** none

### Task 4: GREEN — drop `!isZeroWork` from the judge-lane dispatch predicate
**Story:** "Judge lane dispatches on inherited residue…" — implementation for the happy path; keeps Tasks 2 & 3 pins green.
**Type:** happy-path

**Steps:**
1. (RED already exists from Task 1.)
2. Confirm Task 1's test is RED.
3. Implement in `conductor.ts`: in the judge-lane block (`:3037-3132`), remove `!isZeroWork` from the
   dispatch predicate (`:3057-3062`) and delete the now-unused `const isZeroWork = await
   detectZeroWorkProduct({...})` computation (`:3048-3053`). Retain `const headShaAfterBuild = await
   currentCommitSha(...)` (still used by the `headShaAfterBuild &&` guard and the `headSha` passed to
   `runAttributionLane`). Leave `isZeroWorkProduct: false` (`:3072`) as-is. Update the adjacent
   comment (`:3030-3036`) to state that the lane dispatches on residue regardless of whether the
   current attempt added commits (inherited residue is judged).
4. Verify Task 1's test passes (GREEN) and Tasks 2 & 3 pins remain green. Run the full
   `attribution-*` engine test suite to confirm no regressions.
5. Commit with message: "fix(#570): dispatch attribution judge on inherited residue — drop attempt-scoped !isZeroWork guard"

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — remove `!isZeroWork` from the judge-lane dispatch predicate and delete the dead `isZeroWork` computation in that block

**Wired-into:** same as Task 1 (the judge-lane dispatch site at `src/conductor/src/engine/conductor.ts` is already wired into the build-step auto-heal loop; this task only relaxes its predicate — no new production surface)
**Dependencies:** Task 1

### Task 5: Guard — kickback / no-evidence zero-work path unchanged
**Story:** "The separate kickback / no-evidence zero-work path is unchanged by the fix" — invariant side-effect on alternate branches.
**Type:** negative-path

**Steps:**
1. Write a test (or extend the zero-work kickback test) asserting that after Task 4, a zero-work
   build attempt at the `conductor.ts:3236-3299` retry/stall path still emits the `zero_work_product`
   event, still prepends the "Previous attempt made zero progress…" retry-hint preamble, and still
   records `noEvidenceReasons: ["zero_work_product"]` in the task-evidence ledger; and that a
   progress-making attempt resets the no-evidence counter and emits no `zero_work_product` event.
2. Verify the test passes against the Task-4 tree (RED only if the edit accidentally touched the
   kickback block).
3. Implementation: none expected — this task proves the edit was surgical. If it fails, the fix
   over-reached and must be narrowed to the judge-lane block only.
4. Verify GREEN; additionally confirm `git show` for Task 4's commit touches only the `:3037-3132`
   judge-lane block, not `:3236-3299`.
5. Commit with message: "test(#570): assert kickback/no-evidence zero-work path unchanged by judge-lane fix"

**Files likely touched:**
- `src/conductor/test/engine/attribution-enforcement.test.ts` — or the existing zero-work kickback test file: assert the kickback path invariants hold post-fix

**Wired-into:** none (no new production surface)
**Dependencies:** Task 4

### Task 6: Docs — CHANGELOG + behavior note
**Story:** all — documentation upkeep (harness convention: docs track features).
**Type:** infrastructure

**Steps:**
1. Add a `## [Unreleased]` → `### Fixed` entry to `CHANGELOG.md` describing #570: the attribution
   judge now dispatches on inherited build-gate residue on resumed/stalled runs (previously the
   attempt-scoped `!isZeroWork` guard suppressed it). Note the two preserved no-op paths (cutover
   off; empty residue) and that the kickback/no-evidence path is unchanged.
2. Verify the `[Unreleased]` block is non-empty (release CI gate) and that no `settings.json`/hook/CLI
   surface changed → no `## Migration` block required (internal engine behavior only).
3. Confirm no README/`src/conductor/README.md` change is needed (no new `conduct`/`conduct-ts` flag
   or daemon option; the judge lane is not a documented user-facing flag). If a behavior note exists
   for the attribution judge in `src/conductor/README.md`, refine it to reflect inherited-residue dispatch.
4. Re-read the CHANGELOG entry for accuracy.
5. Commit with message: "docs(#570): changelog + note for judge-lane inherited-residue dispatch"

**Files likely touched:**
- `CHANGELOG.md` — `[Unreleased] / Fixed` entry for #570
- `src/conductor/README.md` — refine attribution-judge behavior note if one exists

**Wired-into:** none (no new production surface)
**Dependencies:** Task 4

## Task Dependency Graph
```
Task 1 (RED: inherited-residue dispatch) ─┐
Task 2 (pin: cutover-off no-op) ──────────┤
Task 3 (pin: empty-residue no-op) ────────┤
                                          ▼
                       Task 4 (GREEN: drop !isZeroWork)
                                          │
                          ┌───────────────┴───────────────┐
                          ▼                               ▼
        Task 5 (guard: kickback path)         Task 6 (docs / changelog)
```
Tasks 1, 2, 3 are independent and may run in any order (all before Task 4). Task 4 depends on Task 1.
Tasks 5 and 6 depend on Task 4 and are independent of each other.

## Integration Points
- After Task 4: the judge lane can be exercised end-to-end on an inherited-residue build — Task 1's
  test observes a real `dispatchVerifier` call where none occurred before, and the two no-op pins
  (Tasks 2, 3) confirm the negative guarantees still hold.
- After Task 5: the fix is proven surgical — the kickback/no-evidence machinery is untouched.

## Verification
- [ ] All happy path criteria covered — inherited-residue dispatch (Task 1 RED → Task 4 GREEN); fresh-commit dispatch regression preserved (asserted in Task 1/4 suite)
- [ ] All negative path criteria covered — cutover-off/future no-op (Task 2), empty-residue no-op (Task 3), kickback-path-unchanged invariant (Task 5)
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies are explicit and acyclic
- [ ] Only the judge-lane block (`conductor.ts:3037-3132`) is edited in production; the kickback path (`:3236-3299`) is untouched (verified in Task 5)
- [ ] CHANGELOG `[Unreleased]` updated; no migration block required (internal-only, no CLI/hook/schema change)
