# Implementation Plan: Custom steps crash the conductor with `STEP_ARTIFACT_CONTRACTS[step] is not iterable`

**Date:** 2026-08-30
**Stories:** .docs/stories/custom-steps-crash-the-conductor-with-step-artifac.md
**Conflict check:** Skipped (Tier S)
**Source:** jstoup111/ai-conductor#1840

## Summary

Make every read of a step's artifact contracts tolerate a step with no entry, and gate the
conductor's post-success artifact review on "declares reviewable artifacts" rather than "is
completion-checked", so config-declared custom steps run through `inline --from` in default mode
without crashing. Seven tasks.

## Technical Approach

- **One accessor, three reads.** `STEP_ARTIFACT_CONTRACTS` in
  `src/conductor/src/engine/artifacts.ts` is typed `Record<StepName, …>` but custom step names
  reach it at runtime. Add an exported accessor, `stepArtifactContracts(step)`, returning the
  step's entry or an empty readonly list, and route the three raw reads through it:
  `featureArtifactPatternsAreRecursive`, `validateFeatureArtifactStems`, and the contract loop
  inside `resolveArtifactFiles`. Every `STEP_ARTIFACT_GLOBS[step]` read already uses `?? []`;
  leave those alone. No step is required to declare a contract, so no new error is introduced
  (Scope boundary in `.docs/track/custom-steps-crash-the-conductor-with-step-artifac.md`).
- **Gate realignment.** In `src/conductor/src/engine/conductor.ts`, the post-success artifact
  review block (the one commented "Artifact review gate … runs for every step that declares
  artifact globs") is gated on `stepHasCompletionCheck(step.name, this.config) && this.mode !==
  'auto'`. `stepHasCompletionCheck` → `hasCompletionContract` returns true for any custom step
  with `completion_artifact` and for any step with a `CUSTOM_COMPLETION_PREDICATES` entry, which
  is wider than the block's stated intent. Add a module-level predicate
  `stepDeclaresReviewableArtifacts(step, config)` = `stepArtifactContracts(step).length > 0 ||
  extraArtifactGlobs(step, config).length > 0` and use it for this block only.
  `stepHasCompletionCheck` keeps governing the completion checks and the SHIP-tail readers that
  already call it (do not touch those call sites).
- **Why both.** The accessor removes the crash class wherever a custom step name reaches the
  contract table; the gate change removes the pointless review pass for steps with nothing to
  review and is what makes the daemon (`mode: 'auto'`) and `inline` (default mode) agree.
- **Test pattern (engine tests).** `test/acceptance/maintain-documentation-gate.acceptance.test.ts`
  already drives a real `Conductor.run` over a temp project with a config-declared custom step
  (`steps: { '<name>': { after, skill, enforcement, completion_artifact } }`), a `StepRunner`
  fake that writes the marker, `verifyArtifacts: true`, `fromStep: <custom step>`, and a state
  file with every built-in step `done`. Reuse that shape with `mode: 'default'`; the artifact
  review seam is the `onReviewArtifacts` constructor option (see the `artifact_approvals` tests
  in `test/engine/conductor.test.ts`, which install a sentinel-throwing `onReviewArtifacts` to
  observe which files reach the prompt). Search hints: `onReviewArtifacts`, `createMockStepRunner`,
  `fromStep`, `completion_artifact` under `test/`.
- **Sequencing.** Accessor first (Task 1–2), then the gate (Task 3), then the review-preservation
  and completion-preservation tests (Task 4–5), then the two-step `inline`-shaped acceptance
  specs (Task 6–7). Tasks 1 and 3 are independent; everything else hangs off them.

## Prerequisites

- None. No migrations, config keys, or schema changes.

## Tasks

### Task 1: Add the contract accessor and route `resolveArtifactFiles` through it
**Story:** Story 1 — happy path 1 (absent step resolves to empty files), happy path 4 (`complexity` behaves identically), negative path 1 (`plan` ambiguous diagnostic unchanged), negative path 2 (extra globs still honored)
**Type:** happy-path

**Steps:**
1. Write failing tests in `test/engine/artifacts.test.ts`: (a) `resolveArtifactFiles(dir, 'maintain-documentation' as StepName, emptyContext)` over a temp dir containing one plan-family markdown file and the custom step's `.pipeline/maintain-documentation-pass` marker resolves to `{ files: [] }` with no `diagnostic`; (b) the same call with `extraGlobs: ['.pipeline/*-pass']` returns exactly the marker file; (c) `resolveArtifactFiles(dir, 'complexity', emptyContext)` deep-equals the result of (a); (d) `resolveArtifactFiles(dir, 'plan', ctx)` with two plan-family markdown candidates that match neither `changedPaths` nor `featureIdentities` still returns `files: []` with a `code: 'ambiguous'` diagnostic whose `reason` names `plan` (existing behavior — this is a pin, it should already pass).
2. Verify (a)–(c) fail with `TypeError: … is not iterable` (RED); (d) passes.
3. Implement: export `stepArtifactContracts(step: StepName): readonly ArtifactPatternContract[]` in `src/conductor/src/engine/artifacts.ts` returning `STEP_ARTIFACT_CONTRACTS[step] ?? []` (typed via an index-signature cast, since the record type has no custom keys); replace the `for (const contract of STEP_ARTIFACT_CONTRACTS[step])` loop in `resolveArtifactFiles` with the accessor.
4. Verify all four pass (GREEN).
5. Commit: "fix(artifacts): resolve absent step contracts as an empty artifact set"

**Done when:**
- `stepArtifactContracts` is exported from `src/conductor/src/engine/artifacts.ts` and `resolveArtifactFiles` contains no direct `STEP_ARTIFACT_CONTRACTS[step]` read.
- Tests (a)–(d) above pass; (a)–(c) fail against pre-change code with `is not iterable`.
- `npx vitest run test/engine/artifacts.test.ts test/engine/artifact-resolution-wiring.test.ts` passes with no other test edited.

**Files likely touched:**
- `src/conductor/src/engine/artifacts.ts` — accessor + loop rewrite
- `src/conductor/test/engine/artifacts.test.ts` — four tests

**Dependencies:** none

### Task 2: Route the stem validator and recursion probe through the accessor
**Story:** Story 1 — happy path 2 (stem validation reports zero violations), happy path 3 (recursion probe answers `false`)
**Type:** happy-path

**Steps:**
1. Write failing tests in `test/engine/artifacts.test.ts`: `validateFeatureArtifactStems` called with `step: 'release-disposition' as StepName` and a single plan-family path naming a different feature, against identity `'my-feature'`, returns `[]`; `featureArtifactPatternsAreRecursive('release-disposition' as StepName)` returns `false`; and a pin that `featureArtifactPatternsAreRecursive('stories')` still returns `true`.
2. Verify the first two fail with `is not iterable` / `Cannot read properties of undefined` (RED).
3. Implement: replace the raw reads in `featureArtifactPatternsAreRecursive` and `validateFeatureArtifactStems` with `stepArtifactContracts(step)`.
4. Verify GREEN.
5. Commit: "fix(artifacts): stem validation and recursion probe tolerate steps without contracts"

**Done when:**
- `grep -n "STEP_ARTIFACT_CONTRACTS\[" src/conductor/src/engine/artifacts.ts` shows only the accessor's own read (and the literal-key `.prd[0]` style reads, if any), no `[step]` indexing elsewhere.
- The three tests above pass; the two absent-step tests fail against pre-change code.
- `test/engine/engineer/` land-spec suites (`npx vitest run test/engine/engineer`) pass unchanged.

**Files likely touched:**
- `src/conductor/src/engine/artifacts.ts` — two call sites
- `src/conductor/test/engine/artifacts.test.ts` — three tests

**Dependencies:** Task 1

### Task 3: Gate the post-success artifact review on declared reviewable artifacts
**Story:** Story 2 — happy path 1 (custom step advances in `default` mode with no prompt, no HALT), negative path 3 (`auto` mode unchanged)
**Type:** happy-path

**Steps:**
1. Write a failing engine test in a new file `test/engine/custom-step-review-gate.test.ts`, following the maintain-documentation acceptance fixture (temp project, every built-in step `done`, `steps: { 'maintain-documentation': { after: 'rebase', skill, enforcement: 'gating', completion_artifact: '.pipeline/maintain-documentation-pass' } }`, a `StepRunner` fake whose `run` writes the marker and returns success, `verifyArtifacts: true`, `fromStep: 'maintain-documentation'`): construct the `Conductor` with `mode: 'default'` and an `onReviewArtifacts` that records its calls; run; assert `onReviewArtifacts` was never called, the state file records `maintain-documentation: 'done'`, the runner was invoked for the step that follows it (e.g. `finish`, or the next configured step), and `.pipeline/HALT` does not exist. Add a sibling case with `mode: 'auto'` asserting the same observable outcome.
2. Verify the `default`-mode case fails (RED): `.pipeline/HALT` exists and contains `STEP_ARTIFACT_CONTRACTS[step] is not iterable`.
3. Implement in `src/conductor/src/engine/conductor.ts`: add `function stepDeclaresReviewableArtifacts(step: StepName, config: HarnessConfig): boolean { return stepArtifactContracts(step).length > 0 || extraArtifactGlobs(step, config).length > 0; }` next to `hasCompletionContract`; change the post-success artifact review gate from `stepHasCompletionCheck(step.name, this.config) && this.mode !== 'auto'` to `stepDeclaresReviewableArtifacts(step.name, this.config) && this.mode !== 'auto'`. Do not change any other `stepHasCompletionCheck` / `hasCompletionContract` call site.
4. Verify GREEN in both modes.
5. Commit: "fix(conductor): review artifacts only for steps that declare them"

**Done when:**
- The post-success artifact review block in `src/conductor/src/engine/conductor.ts` is gated by `stepDeclaresReviewableArtifacts`; `stepHasCompletionCheck` still gates the completion-check block and the SHIP-tail readers (diff touches exactly one gate condition plus the new predicate).
- `test/engine/custom-step-review-gate.test.ts` `default`-mode case passes, and fails against pre-change code with a HALT containing `is not iterable`.
- The `auto`-mode case passes before and after the change.

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — new predicate + one gate condition
- `src/conductor/test/engine/custom-step-review-gate.test.ts` — new file, two cases

**Dependencies:** Task 1

### Task 4: Prove the review prompt still fires for steps that declare artifacts
**Story:** Story 2 — happy path 2 (`plan` still prompts), happy path 3 (`acceptance_specs` extra glob still considered), negative path 2 (`worktree`-style predicate step without contracts does not prompt)
**Type:** negative-path

**Steps:**
1. In `test/engine/custom-step-review-gate.test.ts`, add: (a) a `default`-mode run over a config with `steps.plan.review: 'manual'` and one unapproved plan-family artifact for the feature on disk, asserting `onReviewArtifacts` is called with `'plan'` and that file — if an equivalent assertion already exists in `test/engine/conductor.test.ts` (`artifact_approvals` block), cite it in the test file header comment and skip re-authoring; (b) a `default`-mode run of `acceptance_specs` with `acceptance_spec_globs: ['custom-specs/**/*.test.ts']`, `review: 'manual'`, and one file under `custom-specs/`, asserting `onReviewArtifacts` receives that file; (c) a `default`-mode run of a step with a `CUSTOM_COMPLETION_PREDICATES` entry and an empty contract list (`worktree`) with `review: 'manual'`, asserting `onReviewArtifacts` is never called and the step completes.
2. Verify (b) and (c) pass against Task 3's code (they pin behavior the gate must preserve); confirm (c) would also pass before Task 3 only because `allFiles.length === 0` — record that in the test comment.
3. No production change expected; if (b) fails, the predicate is missing the `extraArtifactGlobs` term — fix it in `src/conductor/src/engine/conductor.ts`.
4. Commit: "test(conductor): review gate still prompts for contract and extra-glob steps"

**Done when:**
- Cases (a) (or its cited existing equivalent), (b), and (c) pass.
- Removing the `extraArtifactGlobs(...)` term from `stepDeclaresReviewableArtifacts` makes case (b) fail (checked once by hand or by a temporary mutation; not committed).

**Files likely touched:**
- `src/conductor/test/engine/custom-step-review-gate.test.ts` — three cases

**Dependencies:** Task 3

### Task 5: A custom step with a missing completion marker still fails its completion check in default mode
**Story:** Story 2 — negative path 1 (missing `completion_artifact` fails the step naming the path; no `TypeError`)
**Type:** negative-path

**Steps:**
1. In `test/engine/custom-step-review-gate.test.ts`, add a `default`-mode run where the `StepRunner` fake returns success but does not write `.pipeline/maintain-documentation-pass` (`maxRetries: 1`); capture emitted events; assert a `step_failed` (or the completion-failure event the fixture's sibling asserts) whose reason contains `configured completion artifact ".pipeline/maintain-documentation-pass" is missing`, that the state file does not record `maintain-documentation: 'done'`, and that neither the events nor `.pipeline/HALT` (if written) contain `not iterable`.
2. Verify it passes against Task 3's code; verify against pre-change code it fails because the HALT reason is the `TypeError` (RED-by-construction check, run once).
3. No production change expected.
4. Commit: "test(conductor): missing custom completion marker still fails closed in default mode"

**Done when:**
- The test passes and its failure-reason assertion matches the `configured completion artifact "…" is missing — <step> must write it after a passing review` text from `src/conductor/src/engine/artifacts.ts`.
- The same test, run against a checkout of Task 3's parent commit, fails with `not iterable` present in the HALT.

**Files likely touched:**
- `src/conductor/test/engine/custom-step-review-gate.test.ts` — one case

**Dependencies:** Task 3

### Task 6: Acceptance — `inline --from` runs two chained custom SHIP-tail steps to done
**Story:** Story 3 — happy path (both custom steps `done`, run advances, no HALT)
**Type:** happy-path

**Steps:**
1. Write a failing acceptance test `test/acceptance/custom-steps-crash-the-conductor-with-step-artifac.acceptance.test.ts`: temp project; config declares `'doc-pass'` (`after: 'rebase'`, `completion_artifact: '.pipeline/doc-pass'`) and `'release-note'` (`after: 'doc-pass'`, `completion_artifact: '.pipeline/release-note'`); state file has every built-in step `done` except `finish`; `StepRunner` fake writes each marker on its step and records the order of steps it was asked to run; construct `Conductor` with `mode: 'default'`, `verifyArtifacts: true`, `fromStep: 'doc-pass'`; run; assert the runner saw `['doc-pass', 'release-note', 'finish']` (prefix match on the first two), the state file has both custom steps `'done'`, and `.pipeline/HALT` is absent.
2. Verify RED against pre-change code (HALT with `not iterable` after `doc-pass`).
3. No production change expected beyond Tasks 1–3; if the second custom step is not reached, the defect is in step ordering — surface it, do not patch around it.
4. Commit: "test(acceptance): inline --from runs chained custom steps to done"

**Done when:**
- The acceptance test passes on the branch and fails against pre-change code with a HALT containing `is not iterable`.
- The runner-order assertion proves advancement past the second custom step (a third step name follows).

**Files likely touched:**
- `src/conductor/test/acceptance/custom-steps-crash-the-conductor-with-step-artifac.acceptance.test.ts` — new file

**Dependencies:** Task 3

### Task 7: Acceptance — a missing second marker names the step and keeps the first step done
**Story:** Story 3 — negative path (second marker missing: failure names step + path; first stays `done`)
**Type:** negative-path

**Steps:**
1. In the Task 6 acceptance file, add a case where the runner writes `.pipeline/doc-pass` but never `.pipeline/release-note` (`maxRetries: 1`); capture events; assert the state file has `doc-pass: 'done'` and `release-note` not `'done'`, the failure reason contains `release-note` and `.pipeline/release-note`, and no event or HALT text contains `not iterable`.
2. Verify it passes against the branch; run once against pre-change code to confirm it fails (the run never reaches `release-note`).
3. No production change expected.
4. Commit: "test(acceptance): missing second custom marker fails closed and preserves earlier step"

**Done when:**
- The negative case passes with the three assertions above.
- The first custom step's `'done'` status is asserted from the on-disk state file, not from in-memory state.

**Files likely touched:**
- `src/conductor/test/acceptance/custom-steps-crash-the-conductor-with-step-artifac.acceptance.test.ts` — one case

**Dependencies:** Task 6

## Task Dependency Graph

```
Task 1 ──► Task 2
Task 1 ──► Task 3 ──► Task 4
                 ├──► Task 5
                 └──► Task 6 ──► Task 7
```

## Integration Points

- After Task 3: a real `Conductor.run` in `default` mode over a custom-step config completes without the crash; `inline --from <custom-step>` can be exercised by hand against this repository's `maintain-documentation` step.

## Coverage

| Criterion | Task |
|---|---|
| Story 1 happy 1 (absent step → empty files) | 1 |
| Story 1 happy 2 (stem validation → zero violations) | 2 |
| Story 1 happy 3 (recursion probe → false) | 2 |
| Story 1 happy 4 (`complexity` identical to absent) | 1 |
| Story 1 negative 1 (`plan` ambiguous diagnostic unchanged) | 1 |
| Story 1 negative 2 (extra globs honored) | 1 |
| Story 2 happy 1 (custom step advances, no prompt, no HALT, default mode) | 3 |
| Story 2 happy 2 (`plan` still prompts) | 4 |
| Story 2 happy 3 (`acceptance_specs` extra glob considered) | 4 |
| Story 2 negative 1 (missing marker fails naming path, no TypeError) | 5 |
| Story 2 negative 2 (predicate-only step does not prompt) | 4 |
| Story 2 negative 3 (`auto` unchanged) | 3 |
| Story 3 happy (two chained custom steps done, advances, no HALT) | 6 |
| Story 3 negative (missing second marker names step, first stays done) | 7 |

## Verification

- [x] All happy path criteria covered by at least one task
- [x] All negative path criteria covered by at least one task
- [x] No task exceeds 5 minutes of work
- [x] Every task has a `Done when:` block of falsifiable checks
- [x] Dependencies are explicit and acyclic
