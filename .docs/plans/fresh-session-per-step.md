# Implementation Plan: Fresh Session Per Step (ai-conductor#325)

**Date:** 2026-07-05
**Track:** Technical (Small tier)
**Design:** `.docs/track/fresh-session-per-step.md`, `.memory/decisions/fresh-session-per-step-approach.md`
**Stories:** `.docs/stories/fresh-session-per-step.md`
**Conflict check:** Skipped (Small tier)

## Summary
Remove the opt-in `freshContextPerStep` flag and make the conductor reset the LLM session
before **every** step across all phases unconditionally, while preserving within-step
retry-resume. ~9 tasks including test updates, the front-half artifact-read audit, docs, and
validation.

## Technical Approach
The reset primitive already exists and is correct: `conductor.ts:1114` calls
`this.stepRunner.resetSession()` once **before** the `while (attempt < stepMaxRetries)` retry
loop (loop begins ~1149), so retries inside the loop reuse the session and only the
`sessionExpired` recovery path resets mid-loop (budget-neutral). The bug is purely that this
call is gated behind `this.freshContextPerStep`, which defaults `false` and is set `true` only
by the daemon — and the daemon skips the pre-seeded front half, so fresh-per-step never reaches
`assess…plan` and never runs in interactive `/conduct` at all.

The fix is subtractive:
1. Drop the `this.freshContextPerStep &&` guard at `conductor.ts:1114` → reset is unconditional
   (keep the `this.stepRunner.resetSession` capability check).
2. Remove the option (`:287`), the private field (`:451`), and the assignment (`:495`).
3. Remove `freshContextPerStep: true` from the daemon conductor construction
   (`daemon-cli.ts:481`) and de-reference it in the comments at `:244` and `:425`.
4. Update the tests that asserted flag-conditional behavior: the false-branch test
   (`conductor.test.ts:393`) that asserts **no** reset must be repurposed to assert reset
   happens unconditionally; drop the flag from the true-branch tests
   (`conductor.test.ts:347–490`, `gate-loop.test.ts:638`, `step-runners.test.ts:312` comment).
5. Add a retry-resume regression test (a second attempt must reuse the same session id / resume,
   not reset) — this is the load-bearing invariant the change must not break.
6. **Interactive carve-out is conditional and last:** only if the front-half audit or a manual
   inline `/conduct` smoke shows unconditional fresh actually breaks the interactive design REPL
   do we scope a shared session to `mode !== 'auto' && INTERACTIVE_STEPS` in the runner. Default
   is pure unconditional fresh. Autonomous/print-mode (all judgement steps) always reset.
7. Audit the front-half steps for reliance on cross-step conversational memory instead of an
   artifact read; fix any found to read the artifact.

Docs referencing the flag: `README.md:916`, `src/conductor/README.md:132`. CHANGELOG
`[Unreleased]` (line 11) needs a `Changed`/`Fixed` entry.

## Prerequisites
- Work in the spec worktree on `spec/…`; `src/conductor` needs its own `npm install` before
  running vitest (`rtk proxy npx vitest run`).

## Tasks

### Task 1: Make the step-boundary session reset unconditional
**Story:** "Every step boundary starts a fresh session, all phases, unconditionally"
**Type:** refactor
**Steps:**
1. Write/repurpose failing test: in `conductor.test.ts`, a run with no flag drives ≥2 steps and
   asserts a `reset` precedes each `run:<step>` (reset-then-run interleaving for every executed
   step). RED against current gated code.
2. Verify RED.
3. Implement: at `conductor.ts:1114` change `if (this.freshContextPerStep && this.stepRunner.resetSession)`
   to `if (this.stepRunner.resetSession)`.
4. Verify GREEN.
5. Commit: "Reset conductor session before every step unconditionally (#325)".
**Files likely touched:** `src/conductor/src/engine/conductor.ts`, `src/conductor/test/engine/conductor.test.ts`
**Dependencies:** none

### Task 2: Remove the `freshContextPerStep` option, field, and assignment
**Story:** "The `freshContextPerStep` opt-in flag is removed"
**Type:** refactor
**Steps:**
1. Write failing test/typecheck expectation: constructing `Conductor` without the flag compiles
   and resets per step (already covered by Task 1); add a grep-clean assertion to the plan's
   validation, not a unit test.
2. Verify current references exist (RED = grep finds them).
3. Implement: delete `freshContextPerStep?: boolean` from the opts type (`:287`), the
   `private freshContextPerStep: boolean` field (`:451`), and the `this.freshContextPerStep = opts.freshContextPerStep ?? false;`
   line (`:495`).
4. Verify GREEN: `npx tsc` passes.
5. Commit: "Remove freshContextPerStep option from Conductor (#325)".
**Files likely touched:** `src/conductor/src/engine/conductor.ts`
**Dependencies:** Task 1

### Task 3: Remove the daemon's `freshContextPerStep: true` and update comments
**Story:** "The `freshContextPerStep` opt-in flag is removed"
**Type:** refactor
**Steps:**
1. Write failing expectation: daemon path still resets per tail step without the flag (the
   `gate-loop.test.ts:638` tail test, updated in Task 5, covers this).
2. Verify RED (flag still referenced).
3. Implement: remove `freshContextPerStep: true` at `daemon-cli.ts:481`; edit the comments at
   `:244` and `:425` to drop the flag reference (describe unconditional reset instead).
4. Verify GREEN.
5. Commit: "Daemon relies on default fresh-per-step; drop flag (#325)".
**Files likely touched:** `src/conductor/src/daemon-cli.ts`
**Dependencies:** Task 2

### Task 4: Grep-clean orphaned references
**Story:** "The `freshContextPerStep` opt-in flag is removed" (negative path: no dangling refs)
**Type:** refactor
**Steps:**
1. Run `grep -rn "freshContextPerStep" src/conductor/src src/conductor/test` — expect only
   updated/removed references; RED if any production reference remains.
2. Implement: fix any stragglers.
3. Verify GREEN: grep returns no production references; build + typecheck pass.
4. Commit: "Remove last freshContextPerStep references (#325)".
**Files likely touched:** any file with a straggler
**Dependencies:** Task 3

### Task 5: Repurpose flag-conditional tests to unconditional
**Story:** "Every step boundary…" + front-half reset coverage
**Type:** negative-path / refactor
**Steps:**
1. Update `conductor.test.ts:347–490`: rename the `describe('fresh session per step
   (freshContextPerStep)')` block, drop `freshContextPerStep: true/false` from constructions.
   The false-branch test at `:393` (currently `expect(log.includes('reset')).toBe(false)`) is
   repurposed to assert `reset` DOES occur unconditionally.
2. Add/confirm a front-half reset case: a run where a front-half step executes asserts it is
   reset (front-half path covered, not only the tail).
3. Update `gate-loop.test.ts:638` ("resets before each tail step") to not pass the flag.
4. Update the `step-runners.test.ts:312` comment referencing the flag.
5. Verify GREEN.
6. Commit: "Assert unconditional per-step session reset incl. front half (#325)".
**Files likely touched:** `src/conductor/test/engine/conductor.test.ts`, `src/conductor/test/integration/gate-loop.test.ts`, `src/conductor/test/engine/step-runners.test.ts`
**Dependencies:** Task 1

### Task 6: Add within-step retry-resume regression test
**Story:** "Within-step retries resume the same session (not fresh)"
**Type:** negative-path
**Steps:**
1. Write test: a step fails attempt 1 and retries; assert the second attempt uses the SAME
   session id + resume dispatch (fails if it reset). Also assert the boundary reset fires exactly
   once per step entry (before the retry loop), not per attempt. RED if the invariant were broken.
2. Verify test passes against current code (invariant already holds) — the value is regression
   protection; confirm it FAILS if the reset is moved inside the loop (spike, then revert).
3. Implement: no production change expected (guard only).
4. Verify GREEN.
5. Commit: "Lock within-step retry-resume invariant (#325)".
**Files likely touched:** `src/conductor/test/engine/conductor.test.ts` (or a focused new test file)
**Dependencies:** Task 1

### Task 7: Front-half artifact-read audit (+ conditional interactive carve-out)
**Story:** "Interactive inline REPL carve-out and front-half artifact-read audit"
**Type:** infrastructure / audit
**Steps:**
1. Audit each front-half step's prompt/skill (`explore`, `prd`, `stories`, `plan`, and the
   judgement steps) for reliance on cross-step conversational memory instead of reading its
   `.docs/` artifact. Record findings in the PR notes.
2. For any step found leaning on session recall, fix it to read the artifact (e.g. ensure its
   system prompt/skill instructs the artifact read). Add a test if the fix is code-level.
3. Manual smoke: run interactive `/conduct` (or reason from the dispatch code) to check the inline
   design REPL still completes each step with fresh sessions. If it demonstrably breaks, scope a
   shared session to `mode !== 'auto' && INTERACTIVE_STEPS` in `step-runners.ts` and add a test
   asserting the same step under `auto` still resets. Otherwise leave pure unconditional.
4. Verify GREEN; add a test that autonomous judgement steps always reset regardless of the
   carve-out branch.
5. Commit: "Audit front-half artifact reads; scope interactive carve-out if needed (#325)".
**Files likely touched:** `src/conductor/src/engine/step-runners.ts` (only if carve-out needed), step prompt/skill definitions, tests
**Dependencies:** Task 1

### Task 8: Update docs (README + conductor README)
**Story:** all (Docs track features)
**Type:** infrastructure
**Steps:**
1. Edit `README.md:916` and `src/conductor/README.md:132` to describe unconditional fresh-per-step
   (remove "with `freshContextPerStep` (daemon/auto only…)" framing).
2. Note the retry-resume exception and (if implemented) the interactive carve-out.
3. Commit: "Docs: fresh session per step is unconditional (#325)".
**Files likely touched:** `README.md`, `src/conductor/README.md`
**Dependencies:** Tasks 1–3

### Task 9: CHANGELOG + full validation
**Story:** all
**Type:** infrastructure
**Steps:**
1. Add a `[Unreleased]` entry (Changed or Fixed): "Conductor resets the LLM session before every
   step unconditionally; removed the `freshContextPerStep` opt-in flag (#325)."
2. Run the conductor suite: `rtk proxy npx vitest run` (green).
3. Run `test/test_harness_integrity.sh` (green).
4. Commit: "CHANGELOG + validation for fresh-per-step (#325)".
**Files likely touched:** `CHANGELOG.md`
**Dependencies:** Tasks 1–8

## Task Dependency Graph
```
Task 1 ─┬─ Task 2 ── Task 3 ── Task 4
        ├─ Task 5
        ├─ Task 6
        └─ Task 7
Tasks 1–3 ── Task 8
Tasks 1–8 ── Task 9
```

## Integration Points
- After Task 1: fresh-per-step is live and default; the conductor suite exercises it end-to-end.
- After Task 3: the daemon path runs on the default with no flag.
- After Task 9: fully validated and documented, ready for the spec PR.

## Verification
- [ ] All happy-path criteria covered (Tasks 1, 3, 5, 6, 7)
- [ ] All negative-path criteria covered (Task 4 dangling-ref, Task 6 retry-resume, Task 7 carve-out scope)
- [ ] No task exceeds ~5 minutes
- [ ] Dependencies explicit and acyclic
- [ ] Within-step retry-resume invariant explicitly protected (Task 6)
- [ ] Front-half reset covered, not only the tail (Task 5)
- [ ] Docs + CHANGELOG updated (Tasks 8–9)
