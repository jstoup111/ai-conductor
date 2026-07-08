# Implementation Plan: Post-rebase gate-first mechanical re-verify (#420)

**Date:** 2026-07-08
**Design:** `.docs/decisions/adr-2026-07-08-post-rebase-gate-first-mechanical-reverify.md` (APPROVED)
**Stories:** `.docs/stories/post-rebase-build-invalidation-dispatches-a-full-b.md` (Accepted, 5 stories)
**Conflict check:** Clean as of 2026-07-08 (0 blocking; 2 degrading resolved via ADR amendment notes)

## Summary

Make the daemon's file-changing finish-time rebase re-verify the `build` gate mechanically
(git-evidence derive) before invalidating it, dispatching the build agent only when evidence is
genuinely missing. 14 tasks: 1 event type, 5 unit tasks on `applyRebaseVerdicts`, 1 conductor
injection task, 4 integration tasks, 1 rekick-call-site pin, 1 evidence-bar negative, 1 docs task.

## Technical Approach

- **Capability injection, no new imports.** `applyRebaseVerdicts` (`src/conductor/src/engine/rebase.ts:725`)
  gains an optional 4th parameter `preVerify?: (step: StepName) => Promise<{ done: boolean; reason?: string }>`
  and its result type gains `reverified: StepName[]`. On `outcome.kind === 'changed'` it calls
  `preVerify('build')` (build ONLY — the ADR's eligibility bar): `done: true` → write a fresh
  objective verdict `{ satisfied: true, reason: 're-verified mechanically after file-changing rebase…', checkedAt: Date.now() }`
  for build and add it to `reverified`; `done: false` / thrown error / capability absent → write
  today's `satisfied:false` kickback verdict (fail-closed). `build_review` and `manual_test`
  (when `ranManualTest`) are invalidated unconditionally, unchanged. `rebase.ts` never imports
  `artifacts.ts` — the capability closes over the conductor's machinery.
- **Conductor injection.** `runRebaseStep` (`src/conductor/src/engine/conductor.ts:2923`, daemon
  call site) passes `preVerify: (step) => checkStepCompletion(this.projectRoot, step, await this.completionCtx(state))`
  (the build predicate internally runs `deriveCompletion` + `applyDerivedCompletion` on every
  evaluation — `artifacts.ts:680-682` — so no separate auto-heal block is needed). It then emits a
  new `rebase_gate_reverified` event per `reverified` entry. The non-daemon call site (`:2872`,
  forced `noop`) never reaches the changed-branch; the rekick call site
  (`src/conductor/src/engine/daemon-rekick.ts:360`) deliberately stays capability-absent
  (fail-closed, today's behavior) per the conflict-report coverage note.
- **No `advanceTail` behavior change (verified).** Its kickback re-emission filters on the
  on-disk verdict (`conductor.ts:2582` — only `satisfied === false && kickback.from === 'rebase'`)
  and the `done→pending` reset (`:2718-2724`) fires only for selector-returned UNSATISFIED gates.
  A fresh `satisfied:true` build verdict therefore keeps build `done` with zero phantom kickback
  events — condition C1 is pinned by tests, not new code. Only the FR-5 comment block
  (`:2571-2577`) is updated to describe the conditional build write.
- **Sequencing:** event type first (everything references it), then unit-tested rebase.ts change,
  then conductor wiring, then integration inversions, then docs.

## Prerequisites

- Fresh `npm install` in `src/conductor` of the build worktree (per-worktree installs).
- Run tests as `rtk proxy npx vitest run <file>` from `src/conductor`.

## Tasks

### Task 1: Add `rebase_gate_reverified` event type
**Story:** Story 1 (structured event, C2)
**Type:** infrastructure

**Steps:**
1. Write failing test: type-level/emit test in `test/engine/rebase.test.ts` asserting an emitter
   accepts `{ type: 'rebase_gate_reverified', step: 'build', skippedDispatch: true }` (compile +
   runtime shape).
2. Verify test fails (RED — type union rejects the literal).
3. Implement: add the variant `{ type: 'rebase_gate_reverified'; step: StepName; skippedDispatch: boolean; reason?: string }`
   to the event union in `src/conductor/src/types/events.ts` (near `rebase_noop`, `:121`).
4. Verify test passes (GREEN).
5. Commit: "feat(rebase): add rebase_gate_reverified event type"

**Files:**
- src/conductor/src/types/events.ts
- src/conductor/test/engine/rebase.test.ts

**Dependencies:** none

### Task 2: `applyRebaseVerdicts` capability parameter — absent ⇒ byte-identical behavior
**Story:** Story 5 negative (capability absent → today's behavior)
**Type:** happy-path

**Steps:**
1. Write failing test: in `test/engine/rebase.test.ts`, call the NEW 4-arg signature with
   `preVerify: undefined` on a `changed` outcome and assert the full target set
   (`build`, `build_review`, `manual_test` when ran) gets `satisfied:false` kickback verdicts and
   the result carries `reverified: []`. (Fails: signature/return shape don't exist yet.)
2. Verify test fails (RED).
3. Implement: extend `applyRebaseVerdicts` in `src/conductor/src/engine/rebase.ts` with the
   optional `preVerify` param and `reverified` return field; absent capability takes the existing
   code path untouched.
4. Verify test passes (GREEN) — and ALL existing `rebase.test.ts` expectations stay green
   unmodified.
5. Commit: "feat(rebase): optional preVerify capability on applyRebaseVerdicts (absent = fail-closed)"

**Files:**
- src/conductor/src/engine/rebase.ts
- src/conductor/test/engine/rebase.test.ts

**Dependencies:** Task 1

### Task 3: Pre-verify pass confirms build with a fresh objective verdict
**Story:** Story 1 happy paths; Story 3 happy path; C2
**Type:** happy-path

**Steps:**
1. Write failing test: `preVerify` resolves `{ done: true }` for build on a `changed` outcome →
   assert `.pipeline/gates/build.json` is `satisfied: true` with a NEW `checkedAt` (newer than a
   pre-seeded stale verdict) and a reason containing "re-verified mechanically"; result
   `kickedBack` excludes build and includes `build_review` + `manual_test`; `reverified === ['build']`.
2. Verify test fails (RED).
3. Implement: the build-only pre-verify branch in the `changed` path of `applyRebaseVerdicts`
   (call capability for `'build'` only; on pass write the fresh objective verdict instead of the
   kickback verdict).
4. Verify test passes (GREEN).
5. Commit: "feat(rebase): gate-first mechanical pre-verify confirms evidence-intact build"

**Files:** same as Task 2

**Dependencies:** Task 2

### Task 4: Pre-verify fail invalidates build exactly as today
**Story:** Story 2 happy path
**Type:** happy-path

**Steps:**
1. Write failing test: `preVerify` resolves `{ done: false, reason: 'task 3 has no evidence' }` →
   assert build's verdict is `satisfied:false`, `kickback: { from: 'rebase', evidence: <changed paths string> }`,
   byte-shape-identical to the capability-absent write; `reverified: []`.
2. Verify test fails (RED — until fail branch routes through the existing write).
3. Implement: fail branch falls through to the existing kickback write.
4. Verify test passes (GREEN).
5. Commit: "test(rebase): failing pre-verify preserves today's kickback shape"

**Files:** same as Task 2

**Dependencies:** Task 2

### Task 5: Pre-verify throw ⇒ fail-closed invalidation
**Story:** Story 1 negative (erroring pre-verify NEVER confirms)
**Type:** negative-path

**Steps:**
1. Write failing test: `preVerify` rejects (`throw new Error('git failed')`) → assert build gets
   the `satisfied:false` + `kickback.from === 'rebase'` verdict and `reverified: []` (no throw
   escapes `applyRebaseVerdicts`).
2. Verify test fails (RED).
3. Implement: try/catch around the capability call; catch → invalidate path.
4. Verify test passes (GREEN).
5. Commit: "feat(rebase): erroring pre-verify fail-closes to invalidation"

**Files:** same as Task 2

**Dependencies:** Task 3

### Task 6: Skipped manual_test never spuriously kicked back
**Story:** Story 3 negative (ranManualTest=false)
**Type:** negative-path

**Steps:**
1. Write failing test: `ranManualTest: false` + passing `preVerify` → `kickedBack === ['build_review']`
   exactly; with failing `preVerify` → `['build', 'build_review']`.
2. Verify test fails (RED) — or passes trivially; if it passes, tighten the assertion to the
   exact-set form so the invariant is pinned (still commit the pin).
3. Implement: none expected (existing `ranManualTest` branching), assertion-only.
4. Verify test passes (GREEN).
5. Commit: "test(rebase): pin exact kicked-back sets across preVerify × ranManualTest"

**Files:** same as Task 2

**Dependencies:** Task 3

### Task 7: Conductor injects the capability and emits the event
**Story:** Story 1 (event emission, C2); ADR wiring decision
**Type:** happy-path

**Steps:**
1. Write failing test: engine-level test (`test/engine/conductor.test.ts` or a focused new file)
   driving `runRebaseStep` in daemon mode with a stubbed `performRebase` returning `changed` and
   evidence-complete completion machinery → assert `rebase_gate_reverified` for `build`
   (`skippedDispatch: true`) is emitted and the build verdict on disk is `satisfied:true`.
2. Verify test fails (RED).
3. Implement: in `src/conductor/src/engine/conductor.ts` `runRebaseStep` (daemon call site
   `:2923`): build the `preVerify` closure over `checkStepCompletion` + `this.completionCtx(state)`
   scoped to `'build'`; pass it to `applyRebaseVerdicts`; emit `rebase_gate_reverified` per
   `reverified` entry. Update the FR-5 comment block at `:2571-2577` to describe the conditional
   build write (no behavior change there — verified verdict-driven).
4. Verify test passes (GREEN).
5. Commit: "feat(conductor): inject build pre-verify into rebase verdicts + emit rebase_gate_reverified"

**Files:**
- src/conductor/src/engine/conductor.ts
- src/conductor/test/engine/conductor.test.ts

**Dependencies:** Task 3, Task 5

### Task 8: Integration — evidence-intact lap skips the build dispatch
**Story:** Story 1 Done-When (buildRuns === 1); Story 5 (no phantom kickback event — C1)
**Type:** happy-path

**Steps:**
1. Write failing test: modify the file-changing-rebase case in
   `test/integration/rebase-loop.test.ts` (`:249-288`): arrange the feature branch's commits to
   carry `Task: <id>` evidence trailers whose commits touch the plan's `Files:` paths (mirror the
   fixture style of `test/integration/task-status-gate-recompute.test.ts`), then assert
   `buildRuns === 1` (was 2), `events.jsonl` contains `rebase_gate_reverified` for build and NO
   `kickback` event with `to: 'build'`, and build's step state remains `done`.
2. Verify test fails (RED — still dispatches twice before Task 7 lands… run after Task 7: fails
   only if wiring is wrong; the RED anchor is the pre-Task-7 run).
3. Implement: fixture/assertion work only; fix any wiring gaps it exposes.
4. Verify test passes (GREEN).
5. Commit: "test(integration): file-changing rebase with intact evidence skips build dispatch"

**Files:**
- src/conductor/test/integration/rebase-loop.test.ts

**Dependencies:** Task 7

### Task 9: Integration — genuinely-missing evidence still dispatches (C3)
**Story:** Story 2 Done-When (buildRuns === 2 pinned)
**Type:** negative-path

**Steps:**
1. Write failing test: sibling case in `rebase-loop.test.ts` where at least one plan task has NO
   evidence trailer → assert `buildRuns === 2` and the build verdict carries
   `kickback.from === 'rebase'` with the changed-paths evidence string (today's shape).
2. Verify test fails or passes for the right reason (RED anchor: assert against the new
   `reverified` event being ABSENT — must not appear).
3. Implement: fixture/assertion only.
4. Verify test passes (GREEN).
5. Commit: "test(integration): pin buildRuns===2 when evidence is genuinely missing post-rebase"

**Files:** same as Task 8

**Dependencies:** Task 8

### Task 10: Integration — non-tree-attesting gates always re-run
**Story:** Story 3 Done-When (build_review re-runs; manual_test false despite fresh PASS file)
**Type:** negative-path

**Steps:**
1. Write failing test: on the evidence-intact lap (Task 8 fixture), assert `buildReviewRuns === 2`
   (the `:290-355` case adjusted) AND — with a fresh all-PASS `.pipeline/manual-test-results.md`
   written mid-session before the rebase — manual_test's verdict is `satisfied:false` after the
   rebase and its runner re-runs.
2. Verify test fails (RED) or pin-passes; tighten to exact assertions.
3. Implement: fixture/assertion only.
4. Verify test passes (GREEN).
5. Commit: "test(integration): build_review + manual_test always invalidated by file-changing rebase"

**Files:** same as Task 8

**Dependencies:** Task 8

### Task 11: Regression — review-kickback rework is never swallowed
**Story:** Story 4 (both criteria)
**Type:** negative-path

**Steps:**
1. Write failing test: evidence-complete build state + a `build_review` kickback verdict
   (`kickback.from === 'build_review'`) → assert the build runner IS dispatched (no mechanical
   pre-check intercepts a non-rebase kickback). Place beside the existing build_review kickback
   integration tests; run those unchanged as part of the same suite invocation.
2. Verify test fails only if the implementation over-reached (expected: passes immediately —
   the pre-verify is structurally confined to the rebase path; the test pins it).
3. Implement: none expected.
4. Verify test passes (GREEN) + existing kickback tests green unmodified.
5. Commit: "test(regression): review kickback dispatches build despite intact evidence"

**Files:**
- src/conductor/test/integration/rebase-loop.test.ts
- src/conductor/test/engine/rebase.test.ts

**Dependencies:** Task 7

### Task 12: Rekick call site ships capability-absent (fail-closed) — explicit + pinned
**Story:** Story 5 negative; conflict-report coverage note
**Type:** negative-path

**Steps:**
1. Write failing test: in the daemon-rekick tests, a `changed` play-forward rebase invalidates
   the FULL target set (build included) even when git evidence is complete — pin unconditional
   invalidation at `resumeRebaseFirst`.
2. Verify RED anchor (assert the exact-set), then GREEN.
3. Implement: no behavior change; add a code comment at `src/conductor/src/engine/daemon-rekick.ts:360`
   stating the capability is deliberately absent (ADR fail-closed default).
4. Verify test passes (GREEN).
5. Commit: "test(rekick): play-forward rebase stays unconditionally fail-closed (no pre-verify)"

**Files:**
- src/conductor/src/engine/daemon-rekick.ts
- src/conductor/test/engine/daemon-rekick.test.ts

**Dependencies:** Task 2

### Task 13: Evidence bar not lowered — corroboration + forged-status negatives
**Story:** Story 2 negatives (path corroboration; forged task-status.json)
**Type:** negative-path

**Steps:**
1. Write failing test: unit test where the injected conductor-shaped pre-verify (real
   `checkStepCompletion` over a fixture repo) sees (a) a trailer whose commit touches none of the
   task's plan paths → pre-verify fails → build kicked back; (b) `task-status.json` forged
   all-completed with an empty evidence sidecar → pre-verify fails.
2. Verify test fails (RED) against a naive always-pass stub, passes against the real predicate.
3. Implement: none expected (properties of the existing predicate — H6/H7 + #424/#425); tests pin
   that the pre-verify path inherits them.
4. Verify test passes (GREEN).
5. Commit: "test(rebase): pre-verify inherits path-corroboration and sidecar-only trust"

**Files:**
- src/conductor/test/engine/rebase.test.ts

**Dependencies:** Task 7

### Task 14: Docs + CHANGELOG
**Story:** repo release gates (docs track features)
**Type:** infrastructure

**Steps:**
1. Add `CHANGELOG.md` `## [Unreleased]` → Changed: gate-first mechanical re-verify of the build
   gate after a file-changing finish-time rebase; new `rebase_gate_reverified` event. No
   Migration block (internal engine behavior; no CLI/hook/schema surface).
2. Update `src/conductor/README.md` rebase-before-finish section: conditional build dispatch +
   event; note build_review/manual_test remain unconditional.
3. Update root `README.md` where the daemon rebase re-verify lap is described.
4. Run `test/test_harness_integrity.sh` (repo validation).
5. Commit: "docs: document post-rebase gate-first re-verify (#420)"

**Files:**
- CHANGELOG.md
- src/conductor/README.md
- README.md

**Dependencies:** Task 8

## Task Dependency Graph

```
1 → 2 → 3 → 5 → 7 → 8 → 9
        3 → 6       8 → 10
        2 → 4       7 → 11
        2 → 12      7 → 13
                    8 → 14
```

## Integration Points

- After Task 7: the full daemon path is wired — a manually-driven daemon run on a fixture repo
  exercises pre-verify end-to-end.
- After Task 8/9: the headline behavior (skip vs dispatch) is pinned in integration.

## Coverage Map (story criterion → task)

- Story 1 happy (fresh verdict / no dispatch / event): Tasks 3, 7, 8 — negatives (noop excluded,
  throw fail-closed): existing FR-4 tests + Task 5
- Story 2 happy (dispatch on pending work): Tasks 4, 9 — negatives (corroboration, forged
  status): Task 13
- Story 3 happy (build_review/manual_test invalidated): Tasks 3, 10 — negatives (fresh PASS file,
  skipped manual_test): Tasks 10, 6
- Story 4 (review kickback never swallowed, both criteria): Task 11
- Story 5 happy (C1 selective reset — verdict-driven, pinned): Task 8 (build stays `done`, no
  phantom kickback) — negatives (capability absent, rekick site, event stream): Tasks 2, 12, 8

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies are explicit and acyclic
