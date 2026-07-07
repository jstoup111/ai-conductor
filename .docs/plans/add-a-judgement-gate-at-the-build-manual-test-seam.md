# Implementation Plan: build_review judgement gate at the build → manual_test seam

**Date:** 2026-07-07
**Design:** `.docs/decisions/adr-2026-07-07-build-review-judgement-gate.md` (APPROVED) + `.docs/architecture/add-a-judgement-gate-at-the-build-manual-test-seam.md`
**Stories:** `.docs/stories/add-a-judgement-gate-at-the-build-manual-test-seam.md` (TS-1…TS-7, Accepted)
**Conflict check:** Clean as of 2026-07-07 (`.docs/conflicts/2026-07-07-build-review-gate.md`)
**Tracking:** jstoup111/ai-conductor#324

## Summary

Adds the opt-in `build_review` judgement loopGate between `build` and `manual_test`: 19 tasks —
registry + config plumbing, input-starved grader dispatch, fail-closed verdict predicate, kickback
+ cap wiring, and docs. All model interaction is behind an injected fake grader in tests.

## Technical Approach

- **Registry first.** `build_review` joins the `StepName` union (`types/steps.ts:1-26`) and
  `ALL_STEPS` after `build` (`steps.ts:139`): `phase 'BUILD'`, `enforcement 'gating'`,
  `prerequisites ['build']`, `loopGate: true`, `isCheckpoint: false`; `manual_test.prerequisites`
  → `['build_review']`. Every exhaustive `Record<StepName,…>` map gets a row
  (`resolved-config.ts:25-119`, `STEP_PROMPTS` `step-runners.ts:21-47`,
  `model-table-metadata.ts`); the generated model table is regenerated.
- **Grader is engine-internal, not a skill.** `DefaultStepRunner.run()` special-cases
  `build_review` into a fresh one-shot session (the `resolveRebaseConflict` pattern,
  `step-runners.ts:594-610`: new uuid, `resume: false`). The prompt is assembled by engine code
  from exactly: the merge-base→HEAD diff, the plan document body, the strict 3-item rubric, and
  the instruction to run the project test suite itself and write
  `.pipeline/build-review.json`. Input isolation is therefore structural — the assembly function
  cannot see maker transcript/summary/task-status. The `STEP_PROMPTS` row exists only for map
  exhaustiveness/display.
- **Fail-closed verdict.** `{verdict:'PASS'|'FAIL', reasons[], rubric:{tautology,scope,rootCause}}`
  validated in the `validateAcceptanceRedEvidence` style (`artifacts.ts:346-380`);
  `CUSTOM_COMPLETION_PREDICATES.build_review` (neighborhood `artifacts.ts:689-764`) requires
  parse-valid + fresh-since-session + exact `'PASS'`.
- **Kickback mirrors the manual_test self-heal block** (`conductor.ts:1650-1703`), using the
  gate-keyed per-gate kickback counter (not a new parallel registry), bounded by
  `MAX_KICKBACKS_PER_GATE` (`conductor.ts:163`); at cap, `LOOP_HALT_MARKER` + `loop_halt`.
  `build` re-entry is safe under engine-owned task-status (ADR 2026-07-05).
- **Opt-in resolver flag** `build_review.enabled` (top-level `HarnessConfig`), safe-by-default
  off; off ⇒ engine marks the step `skipped` (satisfies prerequisites per `state.ts:105-108`,
  selector per `selector.ts:58`). Per-step `disable:` for it is rejected (gating step,
  `types/config.ts:74-75`).
- **Sequencing:** registry/config plumbing (1–6) → verdict layer (7–8) → grader (9–12) →
  loop wiring (13–18) → docs (19). All tests: injected fakes, isolated tmpdir `projectRoot`.

## Prerequisites

None beyond current main — #325 (fresh sessions) and #384 (engine-owned task-status) are merged;
`model-table-metadata.ts` exists. `src/conductor` needs its own `npm install` in the build
worktree; run vitest via `rtk proxy npx vitest run`.

## Tasks

### Task 1: Register build_review in the step registry
**Story:** TS-1 happy 1; TS-1 done-when 1–2
**Type:** infrastructure
**Steps:**
1. Write failing test (registry): `ALL_STEPS` contains `build_review` with exact fields (`phase:'BUILD'`, `enforcement:'gating'`, `prerequisites:['build']`, `loopGate:true`, `isCheckpoint:false`) positioned after `build`; `manual_test.prerequisites` equals `['build_review']`.
2. RED → add `build_review` to the `StepName` union (`src/types/steps.ts`), insert the `ALL_STEPS` entry (`src/engine/steps.ts` after :139), update `manual_test.prerequisites`. Fix resulting type errors ONLY by adding stub rows where the compiler demands (fleshed out in Task 2).
3. GREEN → commit `feat(steps): register build_review loopGate between build and manual_test`, trailer `Task: 1`.
**Files likely touched:** `src/conductor/src/types/steps.ts`, `src/conductor/src/engine/steps.ts`, `src/conductor/test/engine/steps.test.ts` (or nearest registry test)
**Dependencies:** none

### Task 2: Rows in every exhaustive per-step map + regenerated model table
**Story:** TS-1 negative 4; TS-1 done-when 3; TS-7 negative
**Type:** infrastructure
**Steps:**
1. Write failing check: run `test/generate-model-table.test.ts` + `test/test_harness_integrity.sh` — must fail on missing/drifted `build_review` rows (verified RED).
2. Add real rows: `DEFAULT_STEP_MODELS` (session default), `DEFAULT_STEP_EFFORT` ('high'), `DEFAULT_STEP_RETRIES`, `DEFAULT_STEP_REVIEW`, `STEP_PROMPTS` ('/build-review' display sentinel), `STEP_RATIONALE` in `model-table-metadata.ts`; run `bin/generate-model-table` and commit the regenerated HARNESS.md section.
3. GREEN (both suites) → commit, trailer `Task: 2`.
**Files likely touched:** `src/conductor/src/engine/resolved-config.ts`, `src/conductor/src/engine/model-table-metadata.ts`, `src/conductor/src/engine/step-runners.ts` (STEP_PROMPTS), `HARNESS.md`
**Dependencies:** 1

### Task 3: Topology and selector ordering tests
**Story:** TS-1 happy 2–3; TS-1 negatives 1–2
**Type:** happy-path
**Steps:**
1. Write failing tests: `deriveGateTopology` includes `build_review` in `verdictSteps` with `firstLoopIndex`/`regionStart` unchanged; selector picks `build_review` after `build` satisfies and never `manual_test` directly; unsatisfied `build` selected before `build_review`; staled `build_review` re-runs despite old satisfied verdict.
2. RED → wire any gaps (expected: none beyond Task 1 — these pin behavior) → GREEN → commit, trailer `Task: 3`.
**Files likely touched:** `src/conductor/test/engine/selector.test.ts`, topology test (nearest to `conductor.ts:141-160` coverage)
**Dependencies:** 1

### Task 4: build_review config type, resolver, and disable-rejection
**Story:** TS-2 happy 1,3; TS-2 negatives 1–2; TS-1 negative 3
**Type:** infrastructure
**Steps:**
1. Write failing unit tests: absent key → off; `enabled:false` → off (identical); `enabled:true` → on; malformed value → off + validation warning; `steps.build_review.disable: true` rejected by `validateConfig`.
2. RED → add `build_review?: { enabled?: boolean }` to `HarnessConfig`, `resolveBuildReviewConfig` (safe-default pattern of `mergeable_autoresolve`), extend disable-rejection to cover `build_review`.
3. GREEN → commit, trailer `Task: 4`.
**Files likely touched:** `src/conductor/src/types/config.ts`, `src/conductor/src/engine/resolved-config.ts`, `src/conductor/test/engine/resolved-config.test.ts`
**Dependencies:** 1

### Task 5: Flag-off skip wiring preserves legacy topology
**Story:** TS-2 happy 1–2; TS-2 negatives 3–4
**Type:** happy-path
**Steps:**
1. Write failing gate-loop integration test (fake StepRunner, tmpdir projectRoot): flag off ⇒ `build_review` marked `skipped` + skip event emitted at startup; after `build` satisfies, selector picks `manual_test` directly; zero grader dispatches; a stale `.pipeline/build-review.json` present on disk changes nothing.
2. RED → wire startup skip-marking off the resolved flag (read-once, `owner_gate_cutover` semantics) → GREEN → commit, trailer `Task: 5`.
**Files likely touched:** `src/conductor/src/engine/conductor.ts` (startup skip marking), `src/conductor/test/integration/gate-loop.test.ts`
**Dependencies:** 3, 4

### Task 6: Flag-on dispatch between build and manual_test
**Story:** TS-2 happy 3; TS-2 done-when 3
**Type:** happy-path
**Steps:**
1. Write failing gate-loop test: flag on ⇒ after `build` satisfies, `build_review` is dispatched (fake runner records order `build → build_review → manual_test`).
2. RED → any remaining wiring → GREEN → commit, trailer `Task: 6`.
**Files likely touched:** `src/conductor/test/integration/gate-loop.test.ts`
**Dependencies:** 5

### Task 7: Verdict schema + fail-closed validator
**Story:** TS-4 all negatives; TS-4 done-when 1
**Type:** infrastructure
**Steps:**
1. Write failing unit tests for `validateBuildReviewVerdict`: valid PASS ok; missing file N/A (predicate's job); malformed JSON, missing `verdict`/`rubric`, `'FAIL'` (valid parse, reasons preserved), unrecognized strings (`'pass'`, `'APPROVED'`, `''`) all invalid-or-FAIL as specified.
2. RED → implement `BUILD_REVIEW_VERDICT` path constant + interface + validator in `artifacts.ts` (style: `validateAcceptanceRedEvidence`, `artifacts.ts:346-380`).
3. GREEN → commit, trailer `Task: 7`.
**Files likely touched:** `src/conductor/src/engine/artifacts.ts`, `src/conductor/test/engine/artifacts.test.ts`
**Dependencies:** none (parallel with 1–6)

### Task 8: Completion predicate + freshness + glob
**Story:** TS-4 happy; TS-4 negatives (missing file, stale mtime); TS-4 done-when 2
**Type:** happy-path
**Steps:**
1. Write failing predicate tests: valid fresh PASS ⇒ satisfied; missing file ⇒ "no build-review verdict"; stale mtime (`fileIsFreshSinceSession` false) ⇒ unsatisfied; FAIL ⇒ unsatisfied with reasons in the gate reason string.
2. RED → add `CUSTOM_COMPLETION_PREDICATES.build_review` + `build_review: ['.pipeline/build-review.json']` artifact glob.
3. GREEN → commit, trailer `Task: 8`.
**Files likely touched:** `src/conductor/src/engine/artifacts.ts`, `src/conductor/test/engine/gate-predicates.test.ts`
**Dependencies:** 7

### Task 9: Grader input assembly (diff + plan), error paths
**Story:** TS-3 happy 2; TS-3 negatives 2,4
**Type:** happy-path
**Steps:**
1. Write failing unit tests against `assembleBuildReviewInputs(repoRoot, planPath)`: returns `{diff, planBody}` from `git diff <merge-base(defaultBranch,HEAD)>..HEAD` (derived default branch, never hardcoded) in an isolated fixture repo; merge-base failure ⇒ typed error (step will fail unsatisfied); empty diff ⇒ signals no-diff so caller writes FAIL verdict "no diff to grade".
2. RED → implement in `step-runners.ts` (or a new `build-review-inputs.ts`), inputs strictly `(git, planPath)`.
3. GREEN → commit, trailer `Task: 9`.
**Files likely touched:** `src/conductor/src/engine/step-runners.ts` or new module, fixture-based test
**Dependencies:** none (parallel)

### Task 10: Structural input-isolation test
**Story:** TS-3 negative 1; TS-3 done-when 2
**Type:** negative-path
**Steps:**
1. Write failing test: seed fixture with a maker "summary" sentinel string in `.pipeline/task-status.json` + a transcript-like file; assemble the full grader prompt; assert the sentinel appears NOWHERE in the prompt, and the assembly function's signature admits only git diff + plan path (compile-level: no state/summary parameter exists).
2. RED if prompt assembly leaks → fix → GREEN → commit, trailer `Task: 10`.
**Files likely touched:** grader prompt builder + its test
**Dependencies:** 9, 12

### Task 11: One-shot grader dispatch + runner-death path
**Story:** TS-3 happy 1,3; TS-3 negative 3; TS-3 done-when 1
**Type:** happy-path
**Steps:**
1. Write failing tests: `build_review` dispatch uses a fresh uuid + `resume:false` (assert on fake runner invocation, `resolveRebaseConflict` pattern `step-runners.ts:594-610`); ladder-exhausted runner error ⇒ step `failed`, gate unsatisfied (never PASS).
2. RED → special-case `build_review` in `DefaultStepRunner.run()` to the one-shot path.
3. GREEN → commit, trailer `Task: 11`.
**Files likely touched:** `src/conductor/src/engine/step-runners.ts`, `src/conductor/test/engine/step-runners.test.ts`
**Dependencies:** 9, 12

### Task 12: Grader rubric prompt
**Story:** TS-3 happy 3 (verdict shape); ADR decision 5
**Type:** infrastructure
**Steps:**
1. Write failing test: prompt contains the 3 rubric items verbatim (tautology / plan scope / root cause), the all-or-FAIL rule, the exact JSON schema of `.pipeline/build-review.json`, and the run-the-test-suite instruction; contains no reference to task-status or maker summary.
2. RED → author `buildGraderPrompt(inputs)` in engine code.
3. GREEN → commit, trailer `Task: 12`.
**Files likely touched:** grader prompt builder module + test
**Dependencies:** 9

### Task 13: FAIL kickback block (counter, hints, navigateBack, stale, empty-reasons)
**Story:** TS-5 happy 1; TS-5 negative 1; TS-6 happy 1
**Type:** happy-path
**Steps:**
1. Write failing unit-ish conductor test (fake runner writes FAIL verdict): kickback verdict `{satisfied:false, kickback:{from:'build_review', evidence}}` written against `build`; gate-keyed counter incremented (shared per-gate counter mechanism, key `build_review`); `pendingRetryHints` for `build` carries grader reasons; `navigateBack('build')` + downstream (`build_review`, `manual_test`) staled; empty `reasons[]` ⇒ placeholder evidence "grader returned FAIL without reasons".
2. RED → implement mirroring `conductor.ts:1650-1703`.
3. GREEN → commit, trailer `Task: 13`.
**Files likely touched:** `src/conductor/src/engine/conductor.ts`, conductor test
**Dependencies:** 6, 8

### Task 14: Integration — FAIL-tautological and FAIL-scope end-to-end
**Story:** TS-5 done-when 1–2; #324 acceptance criteria (fake-grader FAIL paths)
**Type:** negative-path
**Steps:**
1. Write failing gate-loop integration tests (injected fake grader): (a) FAIL with tautology reason ⇒ full kickback path, `build` re-dispatched, evidence string surfaces in retry hint; (b) FAIL with scope reason ⇒ same path, distinct evidence asserted end-to-end; after a subsequent fake PASS, `manual_test` becomes selectable.
2. RED → fix wiring gaps → GREEN → commit, trailer `Task: 14`.
**Files likely touched:** `src/conductor/test/integration/gate-loop.test.ts`
**Dependencies:** 13

### Task 15: Task completion survives build_review kickback
**Story:** TS-5 happy 2; TS-5 negative 2; TS-5 done-when 3
**Type:** negative-path
**Steps:**
1. Write failing integration test: complete tasks via `Task: <id>` trailers, trigger build_review FAIL kickback, have the fake build agent wipe `.pipeline/task-status.json`; build gate still derives completed tasks (engine-owned task-status), rebuild diff includes fix commits on re-grade.
2. RED → (expected GREEN-by-design; if RED, fix) → commit, trailer `Task: 15`.
**Files likely touched:** `src/conductor/test/integration/` (task-status-gate-recompute neighborhood)
**Dependencies:** 14

### Task 16: Retry cap HALTs
**Story:** TS-6 happy 2; TS-6 done-when 1
**Type:** negative-path
**Steps:**
1. Write failing integration test (fake grader always-FAIL): exactly `MAX_KICKBACKS_PER_GATE` (2) kickbacks then `LOOP_HALT_MARKER` written with grader evidence + `loop_halt` emitted; total `build` dispatches = initial + 2; no further dispatch after HALT.
2. RED → implement cap branch → GREEN → commit, trailer `Task: 16`.
**Files likely touched:** `src/conductor/src/engine/conductor.ts`, gate-loop test
**Dependencies:** 13

### Task 17: Counter independence + restart/backstop bound
**Story:** TS-6 negatives 2–3; TS-6 done-when 2–3
**Type:** negative-path
**Steps:**
1. Write failing tests: (a) one build_review FAIL (counter 1) then a manual_test→build kickback — `manualTestSelfHeals` and the build_review gate counter move independently; (b) simulate conductor restart mid-cycle — either the counter state survives (persisted) or `scanKickbackVerdicts`/`MAX_GATE_SELECTIONS` bounds the loop; pin whichever is implemented, assert no unbounded loop.
2. RED → implement → GREEN → commit, trailer `Task: 17`.
**Files likely touched:** conductor + gate-loop tests
**Dependencies:** 16

### Task 18: Rebase re-verify set includes build_review
**Story:** TS-5 negative 4 (amendment)
**Type:** negative-path
**Steps:**
1. Write failing test (daemon-gated rebase step, isolated repo, `daemon: true`): a code-changing rebase resolution that re-opens `build` stales `build_review`; `manual_test` not selectable until `build_review` re-passes.
2. RED if the generic downstream-stale cascade misses it → fix target set → GREEN → commit, trailer `Task: 18`.
**Files likely touched:** rebase re-verify wiring in `conductor.ts` + its test
**Dependencies:** 13

### Task 19: Docs, CHANGELOG, integrity suite
**Story:** TS-7 all; TS-7 done-when 1–2
**Type:** infrastructure
**Steps:**
1. Update `README.md` + `src/conductor/README.md` (`build_review`: what it grades, `build_review.enabled`, cap/HALT behavior, cost note); add CHANGELOG `[Unreleased]` → Added entry; confirm regenerated model table committed (Task 2).
2. Run full `test/test_harness_integrity.sh` + `rtk proxy npx vitest run` — all green.
3. Commit, trailer `Task: 19`.
**Files likely touched:** `README.md`, `src/conductor/README.md`, `CHANGELOG.md`
**Dependencies:** 2, 18 (last task)

## Task Dependency Graph

```
1 ─┬─ 2 ──────────────────────────────┐
   ├─ 3 ─┐                            │
   └─ 4 ─┴─ 5 ─ 6 ─┐                  │
7 ─ 8 ─────────────┤                  │
9 ─┬─ 12 ─┬─ 10    │                  │
   │      └─ 11 ───┤                  │
   │               └─ 13 ─┬─ 14 ─ 15  │
   │                      ├─ 16 ─ 17  │
   │                      └─ 18 ──────┴─ 19
```
(1→{2,3,4}; 4→5 (also 3→5); 5→6; 7→8; 9→{12}; 12→{10,11} (10 also ←9); {6,8,11}→13; 13→{14,16,18}; 14→15; 16→17; {2,15,17,18}→19)

## Integration Points

- After Task 6: flag on/off topology fully testable end-to-end with fakes.
- After Task 8: gate satisfaction from a hand-written verdict file works.
- After Task 13: first full loop tick (grade → kickback) exercisable.
- After Task 17: the complete #324 acceptance matrix (PASS, FAIL-tautological, FAIL-scope, retry-cap-HALT) is covered.

## Verification

- [ ] All happy path criteria covered (mapping: TS-1→1,2,3; TS-2→4,5,6; TS-3→9,10,11,12; TS-4→7,8; TS-5→13,14,15,18; TS-6→13,16,17; TS-7→2,19)
- [ ] All negative path criteria covered by explicit tasks (3,4,5,7,8,9,10,11,13,14,15,16,17,18)
- [ ] No task exceeds ~5 minutes of focused work
- [ ] Dependencies explicit and acyclic (graph above)
