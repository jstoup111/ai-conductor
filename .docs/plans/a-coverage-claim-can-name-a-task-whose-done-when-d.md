# Implementation Plan: coverage claims bound to `Done when` (#2088)

**Date:** 2026-08-31
**Stories:** .docs/stories/a-coverage-claim-can-name-a-task-whose-done-when-d.md
**Conflict check:** Clean as of 2026-08-31

## Summary

Ground every criterion→task coverage claim in the cited task's `Done when` block at land (both
carriers, every tier), and add a config-gated, default-off `coverage_binding` step before `build`
that judges each (criterion, `Done when`) pair in a fresh one-shot session and halts `needs-human`
on `does-not-assert`. 19 tasks.

## Technical Approach

Governing decision: `adr-2026-08-31-coverage-binding-judge-step` (D1–D9). Two independent halves
that share one claim shape.

- **Mechanical half (land).** `CriterionCoherenceRow` is the single claim shape. The shared parser
  in `src/conductor/src/engine/coherence-parse.ts` gains a plan-table reader that turns four-cell
  rows under the plan's `## Coverage Check` heading into that shape; legacy two-cell story→task
  rows are untouched (cell count is the discriminator). `checkCriterionCoverage` in
  `src/conductor/src/engine/engineer/coherence-validator.ts` matches the quote against the union of
  the cited tasks' `parsePlanTaskDoneWhen` checks instead of `parsePlanTaskBodies` text, and emits
  `criterion:quote-not-done-when:<n>` when the quote is in the body but not in `Done when`.
  `resolveRequiredLayers` stops returning `tier-exempt` at S and instead returns `engaged` with the
  single `criterion` layer sourced from the plan carrier; `runCoherenceGate` feeds plan-table rows
  to the same criterion checks (disposition included) and skips every other layer at S.
- **Judgement half (daemon step).** `coverage_binding` joins `ALL_STEPS` after `coherence_check`,
  before `acceptance_specs`, `phase: 'BUILD'`, gating, prerequisite `plan`, no tier/track skip. The
  step runner assembles claims from the carrier (coherence artifact at M/L, plan table at S) joined
  to each cited task's `Done when` checks (`coverage-binding-inputs.ts`), and — only when
  `coverage_binding.judge.enabled` is `true` (default `false`) — dispatches one fresh one-shot
  session per claim through `executeAuxiliaryProviderCandidates`, replicating the `build_review`
  grader traits: fresh session, `resume: false`, model fallback ladder, closed input in the prompt,
  provider returns only the judged payload, engine stamps identity and persists atomically. The
  envelope module (`coverage-binding-envelope.ts`) owns the closed vocabulary
  `asserts | does-not-assert` (+ engine-side `not-applicable`), the claim digest
  (sha256 over normalized criterion + `Done when` checks), and `.pipeline/coverage-binding.json`,
  rewritten on every run. A `does-not-assert` verdict stamps `refused`/`needs-human` and writes the
  committed halt record through `writeHaltMarker`. Search hints: `runRubricBuildReview`,
  `dispatchBuildReviewRubric` in `src/conductor/src/engine/step-runners.ts`;
  `build-review-coordinator.ts` for the cache-hit/dispatched branch shape; `step_refused` emit in
  `src/conductor/src/engine/conductor.ts`.
- **Sequencing.** Parser first (Tasks 1–2), then the land rules (3–6), then step registration and
  config (7–9), then inputs/envelope/skill (10–12), then dispatch and its failure and halt paths
  (13–16), events (17), and the authoring-skill text (18–19). Independent tasks fan out.

## Prerequisites

- None. All seams exist on HEAD; no migration, no new dependency.

## Tasks

### Task 1: Parse four-cell criterion rows from the plan's Coverage Check table
**Story:** Story 2
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/coherence-parse.test.ts`: a `## Coverage Check` table row `| Story 2 happy: Given …, when …, then … | 4 | <quote> | diff-local |` parses to one `CriterionCoherenceRow` with that criterion, `citedIds: ['4']`, that quote (unquoted via `unquote`), `disposition: 'diff-local'`; a two-cell row `| 2 | 4, 5 |` is NOT returned by the new reader; a table mixing both forms yields only the four-cell rows; a plan with no `## Coverage Check` heading yields an empty array.
2. Verify tests fail (RED).
3. Implement `parsePlanCoverageCriterionRows(planText): CriterionCoherenceRow[]` in `src/conductor/src/engine/coherence-parse.ts` (ADR D1), reusing `splitRow`/`isSeparatorRow`/`unquote`, section-bounded by the next `## ` heading, classifying rows by cell count (4 → criterion claim; anything else ignored by this reader). Keep the module dependency-light (no land-only imports).
4. Verify tests pass (GREEN).
5. Commit: "feat(coherence): parse plan-table criterion rows into the shared claim shape"

**Done when:**
- `parsePlanCoverageCriterionRows` exists in `src/conductor/src/engine/coherence-parse.ts` and returns `CriterionCoherenceRow` values with `rowClass: 'criterion'` for four-cell rows only
- The four tests in step 1 pass; the two-cell row case asserts the reader returns nothing for it
- `parseCoverageCheckTableRows` in `coherence-validator.ts` is unchanged in this task (its legacy story→task result set is pinned by Task 2)

**Files:**
- `src/conductor/src/engine/coherence-parse.ts` — new plan-table criterion reader
- `src/conductor/test/engine/coherence-parse.test.ts` — parser tests

**Dependencies:** none

### Task 2: Corpus pin for legacy Coverage Check rows and annotation-tolerant task ids
**Story:** Story 2
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/engineer/coherence-validator.test.ts`: (a) corpus test — for every merged plan under the repository's plans directory, `checkCoverageTableConsistency(planText)` returns the identical `claim-<row>` gap set before and after Task 1 (snapshot the pre-change result set in the test fixture from a run against HEAD~ and assert equality); (b) a four-cell criterion row citing `4 (landed)` resolves to task `4`; (c) a criterion row citing task `9` when the plan has tasks 1–8 yields `criterion:task-missing:<n>:9` naming the criterion; (d) a criterion row whose criterion text is not in the stories file yields `criterion:invented:<n>`.
2. Verify tests fail (RED) — (b) fails because `taskIdFromCitation` does not strip annotations.
3. Implement in `src/conductor/src/engine/engineer/coherence-validator.ts`: extend `taskIdFromCitation` to strip one trailing parenthesized annotation before the `task-` prefix strip (the rule `adr-2026-08-30-shared-plan-task-reference-resolver` prescribes; that feature's resolver adopts this call site when it ships). Confirm `checkCoverageTableConsistency` still ignores four-cell rows' extra cells (it reads cells[0] and cells[1] only) — if a four-cell criterion row would be misread as a story→task pair, skip rows with ≥4 cells there.
4. Verify tests pass (GREEN).
5. Commit: "test(coherence): pin legacy coverage-table results; strip task-id annotations"

**Done when:**
- The corpus test iterates every plan file under the plans directory and asserts an identical `claim-<row>` result set; it fails if any merged plan's legacy rows change classification
- `taskIdFromCitation('4 (landed)')` returns `'4'`; `taskIdFromCitation('task-4')` still returns `'4'`
- Tests (c) and (d) pass with the existing `criterion:task-missing` and `criterion:invented` gap ids unchanged

**Files:**
- `src/conductor/src/engine/engineer/coherence-validator.ts` — annotation strip; four-cell rows excluded from story→task reconciliation
- `src/conductor/test/engine/engineer/coherence-validator.test.ts` — corpus pin and resolution tests

**Dependencies:** Task 1

### Task 3: Ground the criterion quote in the cited task's Done when block
**Story:** Story 1
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/engineer/coherence-validator.test.ts` against `checkCriterionCoverage`: (a) quote is a whitespace-normalized substring of one of task 3's `Done when` checks → no gap; (b) row cites `task-3, task-5`, quote only in task 5's `Done when` → no gap; (c) quote appears in task 14's Steps prose but in none of its `Done when` checks → gap `criterion:quote-not-done-when:<n>` whose `detail` contains the criterion text, `task-14`, and every `Done when` check of task 14 verbatim; (d) quote appears nowhere in the cited task → gap id is still `criterion:quote-ungrounded:<n>`.
2. Verify tests fail (RED).
3. Implement (ADR D2): in `checkCriterionCoverage`, compute `doneWhen = parsePlanTaskDoneWhen(planText)`; for each row, `quoteInDoneWhen = citedTaskIds.some(id => (doneWhen.get(id) ?? []).some(check => normalizeWhitespace(check).includes(quote)))`; if false and the quote IS in `taskBodies` → push `criterion:quote-not-done-when:<index+1>` with the detail above; if the quote is in neither → keep the existing `criterion:quote-ungrounded` branch. Add the new id to the `CriterionGapFinding` doc comment; do not rename any existing id.
4. Verify tests pass (GREEN).
5. Commit: "feat(coherence): criterion quotes must come from the cited task's Done when"

**Done when:**
- A quote present in the task body but absent from every cited task's `Done when` check is reported as `criterion:quote-not-done-when:<n>` and the detail string includes the criterion, the cited task id(s), and each cited task's `Done when` checks verbatim
- A quote absent from the task entirely is still reported as `criterion:quote-ungrounded:<n>`
- A quote found in any one cited task's `Done when` (multi-task citation) reports no gap
- The existing whitespace-normalization behavior is preserved (test (a) uses a wrapped check)

**Files:**
- `src/conductor/src/engine/engineer/coherence-validator.ts` — Done-when-scoped grounding
- `src/conductor/test/engine/engineer/coherence-validator.test.ts` — grounding tests

**Dependencies:** none

### Task 4: The new gap id is waivable as a coverage gap
**Story:** Story 1
**Type:** negative-path

**Steps:**
1. Write a failing-or-confirming test in `src/conductor/test/engine/engineer/coherence-waiver.test.ts`: given gaps `[{ gapId: 'criterion:quote-not-done-when:2', … }]` and a waiver text `Waives: criterion:quote-not-done-when:2` with a rationale, `parseCoherenceWaiver` returns the id and the aggregate waiver check reports zero unwaived gaps; and given the four evidentiary refusals (`unparseable-coherence-artifact`, `unparseable-criterion-row`, `criterion:stories-unparseable`, fabricated-id) the refusal path is unchanged (assert the existing tests for those still exist and pass).
2. Verify (RED if the waiver aggregate filters ids by a grammar; otherwise the test passes immediately — record which in the commit body).
3. Implement only if RED: admit the new id in whatever grammar filter rejected it, in `src/conductor/src/engine/engineer/coherence-waiver.ts`.
4. Verify tests pass (GREEN).
5. Commit: "test(coherence): criterion:quote-not-done-when is a waivable coverage gap"

**Done when:**
- A waiver naming `criterion:quote-not-done-when:<n>` clears that gap in the land aggregate
- The four evidentiary refusals remain non-waivable (existing tests unchanged and passing)

**Files:**
- `src/conductor/src/engine/engineer/coherence-waiver.ts` — only if a grammar filter needs the new id
- `src/conductor/test/engine/engineer/coherence-waiver.test.ts` — waiver test

**Dependencies:** Task 3

### Task 5: Tier S engages exactly the criterion layer over the plan carrier
**Story:** Story 3
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/engineer/coherence-validator.test.ts`: (a) `resolveRequiredLayers(…, 'S', …)` returns `{ engaged: true, layers: Set{'criterion'}, carrier: 'plan' }` (add `carrier` to `RequiredLayersResult`; M/L return `carrier: 'coherence'` and their layer sets are unchanged — pin both); (b) `runCoherenceGate` on a tier-S worktree with a plan whose four-cell rows ground every extracted criterion in `Done when` with `diff-local` dispositions and no coherence artifact resolves without throwing; (c) the same worktree with an `outside-diff` row throws naming `criterion:disposition-negative:<n>`.
2. Verify tests fail (RED).
3. Implement (ADR D3): in `resolveRequiredLayers`, replace the `tier === 'S'` early return with `engaged: true, layers: {'criterion'}, carrier: 'plan'`, checked before the legacy-change-set rule (which stays for M/L). In `runCoherenceGate`, when `carrier === 'plan'`: skip the artifact-presence/parse rungs, take rows from `parsePlanCoverageCriterionRows(planText)`, run `crossCheckIds` only for task ids, and run the existing criterion-layer checks (omitted/duplicate/invented, verdict, disposition, task existence, quote) unchanged. No outcome/fr/story/orphan-task/adr checks at S.
4. Verify tests pass (GREEN).
5. Commit: "feat(land): tier S engages the criterion layer over plan-carried claims"

**Done when:**
- `resolveRequiredLayers` returns `engaged: true` with exactly `{criterion}` and `carrier: 'plan'` at tier S; M and L layer sets are byte-identical to before (pinned test)
- A tier-S land with fully grounded four-cell rows and no coherence artifact passes the gate
- The disposition checks (`criterion:disposition-missing`, `criterion:disposition-negative`) fire at S exactly as at M/L
- No missing-coherence-artifact rejection fires at S (existing Story 14 test still passes)

**Files:**
- `src/conductor/src/engine/engineer/coherence-validator.ts` — S engagement and plan carrier
- `src/conductor/test/engine/engineer/coherence-validator.test.ts` — S engagement tests

**Dependencies:** Task 1, Task 3

### Task 6: Tier S rejections and discovery no-regression
**Story:** Story 3
**Type:** negative-path

**Steps:**
1. Write failing tests: in `src/conductor/test/engine/engineer/coherence-validator.test.ts` — (a) tier-S plan with no four-cell rows → throw listing one `criterion:omitted:<n>` per extracted criterion, each naming the criterion text; (b) tier-S row whose quote is absent from the cited task's `Done when` → `criterion:quote-not-done-when:<n>`; (c) tier-S stories file with no Given/When/Then → `criterion:stories-unparseable` and no waiver clears it. In `src/conductor/test/engine/daemon-backlog.test.ts` — (d) a merged tier-S spec with a plan lacking any four-cell rows is eligible at discovery (extend the existing tier-S exemption fixture).
2. Verify (a)–(c) fail (RED); (d) should pass already — keep it as the pin.
3. Implement any missing branch in `runCoherenceGate`'s plan-carrier path so (a)–(c) pass; do not touch `daemon-backlog.ts`.
4. Verify tests pass (GREEN).
5. Commit: "test(land): tier-S criterion rejections; discovery unchanged"

**Done when:**
- Tests (a), (b), (c) pass with the named gap ids; (c) is refused even with a waiver naming it
- Test (d) passes with `src/conductor/src/engine/daemon-backlog.ts` untouched in this diff

**Files:**
- `src/conductor/src/engine/engineer/coherence-validator.ts` — S rejection branches
- `src/conductor/test/engine/engineer/coherence-validator.test.ts` — rejection tests
- `src/conductor/test/engine/daemon-backlog.test.ts` — discovery pin

**Dependencies:** Task 5

### Task 7: Register the coverage_binding step
**Story:** Story 4
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/steps.test.ts`: `ALL_STEPS` index of `coverage_binding` is `indexOf('coherence_check') + 1` and `indexOf('acceptance_specs') - 1`; its definition is `{ phase: 'BUILD', enforcement: 'gating', prerequisites: ['plan'], skippableForTiers: [], isCheckpoint: false }` with no `skippableForTracks` and no `skillName`; the daemon's derived preseed set does not contain `coverage_binding`. Update the pinned `getSkippableSteps('S')` sets in `src/conductor/test/engine/steps.test.ts` and `src/conductor/test/acceptance/s-tier-pipeline-knobs.acceptance.test.ts` to assert `coverage_binding` is absent.
2. Verify tests fail (RED).
3. Implement (ADR D4): add `'coverage_binding'` to `StepName` in `src/conductor/src/types/steps.ts` and the definition to `ALL_STEPS` in `src/conductor/src/engine/steps.ts` at the stated position. Run `src/conductor/test/engine/steps-declaration-invariance.test.ts` and satisfy whatever declaration it requires for a new step.
4. Verify tests pass (GREEN).
5. Commit: "feat(steps): register coverage_binding as a BUILD-phase gating step"

**Done when:**
- `ALL_STEPS` contains `coverage_binding` immediately after `coherence_check` and before `acceptance_specs`, `phase: 'BUILD'`, `enforcement: 'gating'`, `prerequisites: ['plan']`, `skippableForTiers: []`
- `getSkippableSteps('S')` pinned tests in both files assert `coverage_binding` is not skipped
- The derived daemon preseed set excludes `coverage_binding` (test asserts on the derivation used by the daemon)

**Files:**
- `src/conductor/src/types/steps.ts` — `StepName` member
- `src/conductor/src/engine/steps.ts` — step definition
- `src/conductor/test/engine/steps.test.ts` — position and preseed tests
- `src/conductor/test/acceptance/s-tier-pipeline-knobs.acceptance.test.ts` — pinned S set

**Dependencies:** none

### Task 8: The coverage_binding.judge.enabled config key, default false
**Story:** Story 4
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/config.test.ts` and `src/conductor/test/engine/resolved-config.test.ts`: a config with no `coverage_binding` block resolves `judge.enabled === false`; `coverage_binding: { judge: { enabled: true } }` resolves `true`; `coverage_binding: { judge: { enabled: "yes" } }` fails validation with an error naming `coverage_binding.judge.enabled` and `boolean`; an unknown key under `coverage_binding.judge` fails validation.
2. Verify tests fail (RED).
3. Implement (ADR D7): `CoverageBindingConfig { judge?: { enabled?: boolean } }` in `src/conductor/src/types/config.ts` on `HarnessConfig`; add `'coverage_binding'` to `CONFIG_CONSUMER_KEY_SETS.top`, plus `coverage_binding: ['judge']` and `'coverage_binding.judge': ['enabled']` entries, and the boolean type check in `validate` in `src/conductor/src/engine/config.ts`; `resolveCoverageBindingConfig(config)` in `src/conductor/src/engine/resolved-config.ts` returning `{ judgeEnabled: boolean }` with default `false`.
4. Verify tests pass (GREEN).
5. Commit: "feat(config): coverage_binding.judge.enabled (default false)"

**Done when:**
- `resolveCoverageBindingConfig(undefined).judgeEnabled === false` is asserted by a test
- A non-boolean value fails `validate` naming the key and the expected type; an unknown nested key fails the unknown-key check
- `coverage_binding` and `coverage_binding.judge` appear in `CONFIG_CONSUMER_KEY_SETS` with a consumer (`resolveCoverageBindingConfig`)

**Files:**
- `src/conductor/src/types/config.ts` — config type
- `src/conductor/src/engine/config.ts` — validation and consumer registry
- `src/conductor/src/engine/resolved-config.ts` — resolver
- `src/conductor/test/engine/config.test.ts` — validation tests
- `src/conductor/test/engine/resolved-config.test.ts` — resolver tests

**Dependencies:** none

### Task 9: Completion artifact and the disabled path of the step runner
**Story:** Story 4
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/step-runners.test.ts` and `src/conductor/test/engine/artifacts.test.ts`: `DefaultStepRunner.run('coverage_binding')` with the default config returns `{ success: true, output: 'coverage_binding judge disabled' }`, writes `.pipeline/coverage-binding.json` containing `{ "status": "disabled" }` plus run identity, and performs zero provider invocations (assert on the injected provider mock); the completion predicate for `coverage_binding` is `{ pattern: '.pipeline/coverage-binding.json', scope: 'run' }`; `GATE_SURFACE.coverage_binding` is declared (use `'feature-runtime-or-prd-inputs'` so a stories/plan edit invalidates a prior done).
2. Verify tests fail (RED).
3. Implement: `coverage_binding` entry in the completion-artifact map in `src/conductor/src/engine/artifacts.ts` and in `GATE_SURFACE` in `src/conductor/src/engine/gate-invalidation.ts`; a `runCoverageBinding()` branch in `src/conductor/src/engine/step-runners.ts` beside the `build_review` branch that reads `resolveCoverageBindingConfig` and, when disabled, writes the envelope via Task 11's writer stub (for this task: a minimal atomic write of `{status:'disabled', …identity}`) and returns success.
4. Verify tests pass (GREEN).
5. Commit: "feat(coverage_binding): completion artifact and disabled path"

**Done when:**
- With the default config the step returns success with output `coverage_binding judge disabled`, writes `.pipeline/coverage-binding.json` with `status: "disabled"`, and the provider mock records zero calls
- `artifacts.ts` maps `coverage_binding` to the run-scoped `.pipeline/coverage-binding.json` completion artifact and `GATE_SURFACE` declares the step
- The daemon resolves the step as `done` after the disabled run (completion predicate test)
- The disabled run emits exactly one `coverage_binding_disabled` event and no `coverage_binding_judged` event

**Files:**
- `src/conductor/src/engine/artifacts.ts` — completion artifact entry
- `src/conductor/src/engine/gate-invalidation.ts` — gate surface entry
- `src/conductor/src/engine/step-runners.ts` — `runCoverageBinding` disabled path
- `src/conductor/test/engine/step-runners.test.ts` — disabled-path tests
- `src/conductor/test/engine/artifacts.test.ts` — completion predicate test

**Dependencies:** Task 7, Task 8, Task 17

### Task 10: Assemble judge inputs from the carrier joined to Done when
**Story:** Story 7
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/coverage-binding-inputs.test.ts`: (a) M-tier fixture with a coherence artifact of three criterion rows → three `CoverageBindingClaim` values `{ criterion, taskIds, doneWhen: string[][], quote }`; (b) S-tier fixture with a plan table of two four-cell rows → two claims; (c) a claim citing a task whose block has no `Done when` → `applicability: 'not-applicable'` and an empty `doneWhen`; (d) no carrier rows at all → empty claim list; (e) a claim never includes diff text, stories prose beyond the criterion, or task Steps text (assert the assembled object has only the named fields).
2. Verify tests fail (RED).
3. Implement `assembleCoverageBindingClaims({ tier, coherenceText, planText })` in a new `src/conductor/src/engine/coverage-binding-inputs.ts` (ADR D4, D8): rows from `parseCoherenceArtifact` (M/L) or `parsePlanCoverageCriterionRows` (S), joined to `parsePlanTaskDoneWhen(planText)`; tasks with no block mark the claim `not-applicable`.
4. Verify tests pass (GREEN).
5. Commit: "feat(coverage_binding): assemble scoped (criterion, Done when) claims"

**Done when:**
- `assembleCoverageBindingClaims` returns one claim per carrier row with exactly the fields `criterion`, `taskIds`, `doneWhen`, `quote`, `applicability`
- A cited task without a `Done when` block yields `applicability: 'not-applicable'`; a spec with no rows yields `[]`
- Test (e) proves no diff, transcript, or Steps text is present on any claim

**Files:**
- `src/conductor/src/engine/coverage-binding-inputs.ts` — claim assembly
- `src/conductor/test/engine/coverage-binding-inputs.test.ts` — assembly tests

**Dependencies:** Task 1

### Task 11: Envelope schema, closed verdict vocabulary, and claim digest
**Story:** Story 5
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/coverage-binding-envelope.test.ts`: `parseJudgePayload('{"verdict":"asserts"}')` → ok; `{"verdict":"does-not-assert","missingAssertion":"…"}` → ok; `{"verdict":"partial"}`, `{"verdict":"does-not-assert"}` without `missingAssertion`, and non-JSON → `{ ok: false, reason }` naming the problem; `claimDigest(claim)` is stable across whitespace changes in the criterion and changes when any `Done when` check changes; `writeCoverageBindingEnvelope` writes atomically (temp + rename) and the file carries `slug`, `runId`, `status`, and per-claim `{ digest, criterion, taskIds, doneWhen, verdict, missingAssertion? }`; `readCoverageBindingEnvelope` returns `null` on a missing or malformed file.
2. Verify tests fail (RED).
3. Implement `src/conductor/src/engine/coverage-binding-envelope.ts` (ADR D5): the types, `parseJudgePayload` (closed vocabulary; `missingAssertion` required iff `does-not-assert`), `claimDigest` (sha256 over normalized criterion + normalized checks), writer/reader with the same `readFile/mkdir/writeFile/rename` injection shape `build-review-cache.ts` uses.
4. Verify tests pass (GREEN).
5. Commit: "feat(coverage_binding): engine-stamped envelope and closed verdict vocabulary"

**Done when:**
- `parseJudgePayload` accepts exactly the two verdict strings and rejects everything else with a named reason
- `claimDigest` is whitespace-stable on the criterion and changes on any `Done when` check edit (both asserted)
- The envelope writer is atomic and the reader returns `null` for missing/malformed files
- The written envelope carries `slug`, `runId`, `status`, and per-claim `digest`, `criterion`, `taskIds`, `doneWhen`, and `verdict` fields

**Files:**
- `src/conductor/src/engine/coverage-binding-envelope.ts` — schema, digest, persistence
- `src/conductor/test/engine/coverage-binding-envelope.test.ts` — schema tests

**Dependencies:** none

### Task 12: The coverage-binding judgement skill and its model-table row
**Story:** Story 5
**Type:** infrastructure

**Steps:**
1. Write a failing test in `src/conductor/test/engine/model-table-metadata.test.ts`: `AUXILIARY_MODEL_TABLE_ROWS` contains a row `name: 'coverage-binding'` with `executionPath: 'engine-managed auxiliary judge'`; and confirm `test/test_harness_integrity.sh` currently fails when a `skills/coverage-binding/` directory exists without a model-table row (run it after creating the directory, before the row).
2. Verify (RED).
3. Implement: `skills/coverage-binding/SKILL.md` with frontmatter (`name: coverage-binding`, `disable-model-invocation: true`, `description`, `enforcement: gating`, `phase: build`) modelled on `skills/build-review-test-quality/SKILL.md`; body = the judgement policy only — answer "does the cited `Done when` assert this criterion?", treat topical adjacency as `does-not-assert`, never read files, return exactly one JSON object `{ verdict, missingAssertion? }`. Add the `AUXILIARY_MODEL_TABLE_ROWS` entry in `src/conductor/src/engine/model-table-metadata.ts` and regenerate the HARNESS.md table with `bin/generate-model-table`.
4. Verify tests pass (GREEN) and `test/test_harness_integrity.sh` passes.
5. Commit: "feat(skills): coverage-binding judgement policy and model-table row"

**Done when:**
- `skills/coverage-binding/SKILL.md` exists with the required frontmatter fields and `disable-model-invocation: true`, and its body instructs the judge never to read files and to return only the closed verdict object
- `AUXILIARY_MODEL_TABLE_ROWS` carries the `coverage-binding` row and `bin/generate-model-table` output matches the committed HARNESS.md section (integrity check 5a)
- `test/test_harness_integrity.sh` exits 0

**Files:**
- `skills/coverage-binding/SKILL.md` — judgement policy
- `src/conductor/src/engine/model-table-metadata.ts` — model-table row
- `HARNESS.md` — regenerated model table section
- `src/conductor/test/engine/model-table-metadata.test.ts` — row test

**Dependencies:** none

### Task 13: Dispatch one fresh one-shot judge per claim with a digest cache
**Story:** Story 5
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/step-runners.test.ts` with the provider mock: with `judge.enabled: true` and three applicable claims, `run('coverage_binding')` makes exactly three provider invocations, each prompt containing exactly one claim's criterion text and its `Done when` checks plus the skill policy, and none containing diff, transcript, or Steps text; each invocation uses a fresh session (`resume: false`, distinct ids) via `executeAuxiliaryProviderCandidates` with `memberId` = the claim digest; all three returning `{"verdict":"asserts"}` → step `done`, envelope has three `asserts` entries; a prior envelope whose digest matches one claim → two invocations, three entries, envelope file mtime updated (rewritten); a `Done when` edit on that claim → three invocations again. Replicate the `build_review` grader traits (fresh id, `resume: false`, ladder, closed prompt) — search hints `runRubricBuildReview`, `dispatchBuildReviewRubric`; allowed variation: per-claim dispatch, no worktree reads.
2. Verify tests fail (RED).
3. Implement the enabled path of `runCoverageBinding` in `src/conductor/src/engine/step-runners.ts` (ADR D5): assemble claims (Task 10), skip `not-applicable`, look up cache hits by digest in the prior envelope, dispatch the rest per claim with the skill policy text from `skills/coverage-binding/SKILL.md` and the claim JSON, parse each payload with `parseJudgePayload`, and always rewrite the envelope.
4. Verify tests pass (GREEN).
5. Commit: "feat(coverage_binding): per-claim fresh one-shot judge with digest cache"

**Done when:**
- Enabled with N applicable claims and no cache, the runner performs exactly N provider invocations, each with `resume: false` and a prompt containing only that claim and the policy
- A digest cache hit is not re-dispatched and the envelope is still rewritten (mtime assertion)
- All-`asserts` completes the step `done` with N envelope entries
- A `not-applicable` claim is never dispatched and does not block `done`; zero applicable claims completes `done` with an empty entries list

**Files:**
- `src/conductor/src/engine/step-runners.ts` — enabled dispatch path
- `src/conductor/test/engine/step-runners.test.ts` — dispatch and cache tests

**Dependencies:** Task 9, Task 10, Task 11, Task 12, Task 17

### Task 14: Malformed payloads and ladder exhaustion are step failures, never verdicts
**Story:** Story 5
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/step-runners.test.ts`: a provider returning `{"verdict":"partial"}` → the attempt is reported as a typed infrastructure failure of the step (a named error class, e.g. `CoverageBindingPayloadError`), no verdict entry for that claim, no halt marker written, and the ordinary step retry ladder is what re-dispatches (assert via the classifier input, not message text); every ladder candidate unavailable → `run` returns `{ success: false }` and `.pipeline/coverage-binding.json` is not written with `status: 'done'`.
2. Verify tests fail (RED).
3. Implement in `src/conductor/src/engine/step-runners.ts` (ADR D5): throw the typed error on `parseJudgePayload` failure; on ladder exhaustion return `success: false` with the provider's reason and leave the envelope status `failed`.
4. Verify tests pass (GREEN).
5. Commit: "feat(coverage_binding): malformed judge payloads fail the attempt, never grade"

**Done when:**
- An out-of-vocabulary payload produces the typed error, no envelope verdict entry, and no halt marker
- Ladder exhaustion returns `success: false` and the completion predicate remains unsatisfied

**Files:**
- `src/conductor/src/engine/step-runners.ts` — typed failure paths
- `src/conductor/test/engine/step-runners.test.ts` — failure tests

**Dependencies:** Task 13

### Task 15: does-not-assert halts needs-human naming the Done when
**Story:** Story 6
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/step-runners.test.ts` (and the conductor refusal seam test file that covers `step_refused`): one claim returning `{"verdict":"does-not-assert","missingAssertion":"no check requires the coordinator to emit the five occurrences"}` → the step result carries a typed `refusal: { kind: 'needs-human' }` facet, the conductor stamps `coverage_binding: 'refused'` and emits `step_refused` with `kind: 'needs-human'`, a halt record is written through `writeHaltMarker` with class `needs-human`, and the rendered halt text contains the criterion, the bound task id, each of that task's `Done when` checks verbatim, and the `missingAssertion` string; two failing claims → one halt record listing both; the plan file is byte-identical after the run and no decide-grant/route-to-plan record is written.
2. Verify tests fail (RED).
3. Implement (ADR D6): in `runCoverageBinding` collect failing claims, render the halt body (criterion / task / `Done when` / missing assertion per claim), return the refusal facet on the step result; wire the conductor's existing `step_refused` stamping seam (`src/conductor/src/engine/conductor.ts`, the `[step]: 'refused'` write and `step_refused` emit) to accept the facet from this step, calling `writeHaltMarker` with the existing `needs-human` class.
4. Verify tests pass (GREEN).
5. Commit: "feat(coverage_binding): does-not-assert refuses needs-human before build"

**Done when:**
- A `does-not-assert` verdict stamps `coverage_binding: 'refused'`, emits `step_refused` with `kind: 'needs-human'`, and writes one `needs-human` halt record whose text includes the criterion, task id, the task's `Done when` checks verbatim, and the `missingAssertion`
- Two failing claims produce exactly one halt record listing both
- The plan file is unchanged and no routing/grant record exists after the run

**Files:**
- `src/conductor/src/engine/step-runners.ts` — failing-claim collection and halt rendering
- `src/conductor/src/engine/conductor.ts` — refusal facet handling at the existing seam
- `src/conductor/test/engine/step-runners.test.ts` — halt tests

**Dependencies:** Task 13

### Task 16: A refused step is re-admitted and the amended pair re-judged
**Story:** Story 6
**Type:** negative-path

**Steps:**
1. Write a failing test in `src/conductor/test/engine/step-runners.test.ts` (or the resume-clamp test file that already covers `refused` re-admission): after a `does-not-assert` refusal, the halt is cleared, the plan's `Done when` for the bound task is edited to carry the assertion, and the feature re-dispatches → the resume clamp re-admits `coverage_binding` (status no longer `refused` blocks dependents), the claim's digest differs from the persisted entry, the judge is re-dispatched for exactly that claim, and an `asserts` reply completes the step `done`.
2. Verify the test fails (RED) only if the re-admission or digest miss is not already delivered by Tasks 11, 13, 15 and the existing clamp; otherwise it passes immediately — record which in the commit body.
3. Implement only what RED requires, in `src/conductor/src/engine/step-runners.ts`.
4. Verify tests pass (GREEN).
5. Commit: "test(coverage_binding): refused step re-admitted; amended pair re-judged"

**Done when:**
- After halt clear and a `Done when` amendment, the step runs again, dispatches only the changed claim, and completes `done` on `asserts`
- The stale `does-not-assert` entry is not reused (its digest no longer matches)

**Files:**
- `src/conductor/src/engine/step-runners.ts` — only if RED requires
- `src/conductor/test/engine/step-runners.test.ts` — re-admission test

**Dependencies:** Task 15

### Task 17: coverage_binding_judged and coverage_binding_disabled ride the spine
**Story:** Story 8
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/event-sinks.test.ts` and the event-persister test file: the sink registry declares `coverage_binding_judged` and `coverage_binding_disabled` (`render: false, persist: true, audit: false, otel: false`); a fixture registry omitting either fails the exhaustiveness test naming the type; a `coverage_binding_judged` event `{ verdict: 'asserts', digest, taskIds, step: 'coverage_binding' }` persists to `.pipeline/events.jsonl`; no `coverage_binding_started` or `coverage_binding_halted` member exists in the union (type-level assertion).
2. Verify tests fail (RED).
3. Implement (ADR D9): add the two variants to the `ConductorEvent` union in `src/conductor/src/types/events.ts` (`verdict: 'asserts' | 'does-not-assert' | 'not-applicable'`) and their declarations in `src/conductor/src/engine/event-sinks.ts`.
4. Verify tests pass (GREEN).
5. Commit: "feat(events): coverage_binding_judged and coverage_binding_disabled"

**Done when:**
- Both event types are members of `ConductorEvent` with sink declarations; the exhaustiveness test fails when either is omitted from a fixture
- A `coverage_binding_judged` event is observed in `.pipeline/events.jsonl` by the persister test
- No `coverage_binding_started`/`_halted` union members exist

**Files:**
- `src/conductor/src/types/events.ts` — union members
- `src/conductor/src/engine/event-sinks.ts` — sink declarations
- `src/conductor/test/engine/event-sinks.test.ts` — registry and exhaustiveness tests

**Dependencies:** none

### Task 18: coherence-check skill states the Done when quote rule
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write a failing test in `src/conductor/test/skills/coherence-check-skill-text.test.ts` (create beside any existing skill-text tests; if none exist, a plain vitest file reading the file from the repo root): `skills/coherence-check/SKILL.md` §4a row class 6 contains the phrase "quote from one cited task's `Done when` block" and names `criterion:quote-not-done-when` in §4c's gap-id list.
2. Verify the test fails (RED).
3. Edit `skills/coherence-check/SKILL.md`: in §4a(6) replace "a verbatim quote from one cited task's body" with the `Done when` rule and one sentence on why (a Steps quote grounded two claims whose `Done when` never asserted the criterion); add `criterion:quote-not-done-when:<n>` to §4c; add a §5 bullet telling the author to read the cited task's `Done when` before marking `covered`.
4. Verify the test passes (GREEN).
5. Commit: "docs(skill): coherence-check quotes come from Done when"

**Done when:**
- `skills/coherence-check/SKILL.md` §4a(6) states the quote must be one of the cited task's `Done when` checks and §4c lists `criterion:quote-not-done-when:<n>`
- The skill-text test passes and `test/test_harness_integrity.sh` exits 0

**Files:**
- `skills/coherence-check/SKILL.md` — quote rule and gap id
- `src/conductor/test/skills/coherence-check-skill-text.test.ts` — text assertion

**Dependencies:** none

### Task 19: plan skill prescribes the four-cell criterion row form
**Story:** Story 2
**Type:** happy-path

**Steps:**
1. Write a failing test in `src/conductor/test/skills/plan-skill-text.test.ts`: `skills/plan/SKILL.md` §7 contains a `## Coverage Check` example row with four cells (criterion, task id(s), `Done when` quote, `diff-local`), states that the criterion cell is the exact extracted criterion text (`Story <id> happy|negative: Given …`), and states the rule applies at every tier with tier S required to carry the table.
2. Verify the test fails (RED).
3. Edit `skills/plan/SKILL.md` §7: add the row form, the exact-text and `Done when`-quote rules, the disposition cell, and the tier-S requirement; keep the legacy two-cell story→task form documented as still accepted.
4. Verify the test passes (GREEN).
5. Commit: "docs(skill): plan Coverage Check carries criterion-level rows"

**Done when:**
- `skills/plan/SKILL.md` §7 shows the four-cell row form with the `Done when` quote and disposition cells and states the tier-S requirement
- The skill-text test passes and `test/test_harness_integrity.sh` exits 0

**Files:**
- `skills/plan/SKILL.md` — coverage table form
- `src/conductor/test/skills/plan-skill-text.test.ts` — text assertion

**Dependencies:** none

## Task Dependency Graph

```
1 ─┬─▶ 2
   ├─▶ 5 ─▶ 6
   └─▶ 10 ─┐
3 ─┬─▶ 4   │
   └─▶ 5   │
7 ─┬─▶ 9 ──┤
8 ─┘       ├─▶ 13 ─┬─▶ 14
11 ────────┤       └─▶ 15 ─▶ 16
12 ────────┤
17 ────────┘
18, 19 independent
```

## Integration Points

- After Task 6: a tier-S and an M-tier spec can be landed against the new grounding rule end to end (`engineer land`).
- After Task 9: the daemon dispatches `coverage_binding` as a no-op `done` step on every feature with the default config.
- After Task 15: enabling `coverage_binding.judge.enabled` in a project config exercises the full judge → envelope → halt path on a real dispatch.

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks; no unbounded quality word is left without its closed enumeration or named mechanism
- [ ] Dependencies are explicit and acyclic

### Task rem-as-built-rem-ab1-1: src/conductor/src/engine/coverage-binding-inputs.ts:24-26 and src/conductor/src/engine/engineer/coherence-validator.ts:385-386 — replace BOTH hand-rolled `taskIdFromCitation` helpers with one shared export derived from `normalizePlanTaskId` (src/conductor/src/engine/plan-task-parse.ts:31) plus the `^task-` prefix strip, so the runtime judge carrier and the land carrier can no longer drift; keep the land validator's existing behavior byte-for-byte (Task 3 quote-in-Done-when grounding and its `criterion:quote-not-done-when:` gap id must still fire unchanged). Add tests: src/conductor/test/engine/coverage-binding-inputs.test.ts — an S-tier plan row and an M/L-tier coherence row each citing `task-7 (landed)` assemble as `applicability: 'applicable'` with taskIds `['7']` and the task's real Done-when checks; assert the shared helper is the single definition.
**Gate:** as-built
**Rationale:** Conforming implementation drift, not an architecture change: adr-2026-08-31 D1 (.docs/decisions/adr-2026-08-31-coverage-binding-judge-step.md:67-72) is still the correct approved rule, and the runtime assembler simply fails to apply it — src/conductor/src/engine/coverage-binding-inputs.ts:24-26 strips only the `task-` prefix while the land validator at src/conductor/src/engine/engineer/coherence-validator.ts:385-386 also strips a trailing parenthesized annotation, so lines 49-59 look up an annotated id, miss the Done-when block, and record `not-applicable`. Plan Task 10 (claim assembly) and Task 2 (annotation-tolerant task ids) both admit the repair, so this is not a planning miss. Matched pair: these are two hand-copied citation normalizers that must agree, and src/conductor/src/engine/plan-task-parse.ts:31 already exports the canonical `normalizePlanTaskId` whose doc comment requires every caller to route through it — the task derives both from that one source rather than patching the runtime copy alone. Sibling sweep: the only other `taskIdFromCitation` definitions in the tree are these two; found-and-excluded is the stale diagram at .docs/architecture/a-coverage-claim-can-name-a-task-whose-done-when-d.md:20-41,93-95 (Drift Notes, not a blocking finding), because that file is a sealed protected artifact for this feature (.pipeline/protected-artifact-seal.json) and a build-step edit would halt on protected-artifact self-amendment — it needs an operator reseal, not a remediation task. No existing assertion is removed or relaxed.
**Governing clause:** adr-2026-08-31-coverage-binding-judge-step decision 1
**Done when:**
- adr-2026-08-31-coverage-binding-judge-step decision 1 is satisfied by this task.

### Task rem-as-built-rem-ab2-1: src/conductor/src/engine/step-runners.ts:2473-2477 — on a digest cache hit, reuse ONLY the cached verdict/missingAssertion and reconstruct the envelope entry and the `coverage_binding_judged` occurrence via `entryFor(claim, digest, hit.verdict, hit.missingAssertion)` from the CURRENT claim's taskIds and doneWhen projection; keep the no-re-dispatch behavior Task 13 delivered (no provider call on a hit) and keep the envelope rewrite. Add a regression test in src/conductor/test/engine/step-runners.test.ts: same criterion + same Done-when text rebound from task A to task B yields a cache hit (no provider invocation) whose written envelope entry and emitted event carry task B's ids, not task A's.
**Gate:** as-built
**Rationale:** Conforming implementation drift against the approved design: adr-2026-08-31 D5 (.docs/decisions/adr-2026-08-31-coverage-binding-judge-step.md:100-113) requires the engine to stamp current task ids and current Done-when checks into a session-fresh rewritten envelope, and the digest's deliberate exclusion of task ids at src/conductor/src/engine/coverage-binding-envelope.ts:112-118 is correct and stays — the defect is only that the cache-hit branch at src/conductor/src/engine/step-runners.ts:2473-2477 pushes and emits the prior entry object itself, so rebinding an unchanged criterion/check pair to a different task persists and emits the stale task identity. Plan Task 13 admits the repair (its Done when already requires 'a digest cache hit is not re-dispatched and the envelope is still rewritten'), so this is not a planning miss. Sibling sweep: the `not-applicable` branch at lines 2465-2472 and the fresh-judgement branch at lines 2517-2519 already build their entries through `entryFor` from the current claim; the cache-hit branch is the only site that reuses a stored entry, and nothing is orphaned by the change. No assertion is removed — the existing cache-hit no-redispatch coverage is preserved and extended.
**Governing clause:** adr-2026-08-31-coverage-binding-judge-step decision 5
**Done when:**
- adr-2026-08-31-coverage-binding-judge-step decision 5 is satisfied by this task.

### Task rem-as-built-rem-ab3-1: src/conductor/src/engine/step-runners.ts:2515-2518 — throw the Task 14 typed error (a named `CoverageBindingPayloadError` class) on `parseJudgePayload` failure instead of returning a generic `{ success: false }`, so the ordinary step retry ladder classifies it as an infrastructure failure, no verdict entry is recorded for the claim, and no halt marker is written; leave the provider/ladder-exhaustion exit at lines 2511-2513 returning `{ success: false }` with the provider reason and envelope status `failed` as Task 14 specifies. Tests in src/conductor/test/engine/step-runners.test.ts assert via the classifier input, not message text.
**Gate:** as-built
**Rationale:** Implementation gap against an existing plan task, not an architecture question: Task 14 (.docs/plans/a-coverage-claim-can-name-a-task-whose-done-when-d.md:355-368) already requires a typed infrastructure error on malformed payloads and requires ladder exhaustion to leave the completion predicate unsatisfied, but src/conductor/src/engine/step-runners.ts:2511-2518 writes a `status: 'failed'` envelope and returns an undifferentiated `{ success: false }`, and coverage_binding carries only a glob artifact contract at src/conductor/src/engine/artifacts.ts:280 with no status-aware predicate, so `checkStepCompletion` (lines 5377-5444) accepts any matching envelope and `checkGateCompletion` exposes it to gate-verdict recomputation at src/conductor/src/engine/gate-verdicts.ts:17-24 — failed evidence can satisfy the gate. Task 14 admits the whole repair. Sibling sweep: BOTH failure exits share the defect — the provider-failure return at lines 2511-2513 and the parse-failure return at lines 2515-2518 — and the `refused` status written at line 2523 is the third status the predicate must reject, so the one task covers all of them rather than fixing the cited parse path alone. No existing coverage is removed; the Task 9 `disabled` and Task 13 `done` completion paths must keep passing unchanged.
**Governing clause:** Task 14
**Parent task:** 14
**Done when:**
- Task 14 is satisfied by this task.

### Task rem-as-built-rem-ab3-2: src/conductor/src/engine/artifacts.ts:280 — replace coverage_binding's presence-only glob contract with a status-aware completion predicate over `.pipeline/coverage-binding.json` that is satisfied ONLY by `status: 'disabled'` or `status: 'done'` and never by `'failed'` or `'refused'` (all four statuses are written at src/conductor/src/engine/step-runners.ts:2403-2412; keep the writer's status vocabulary and the predicate's accepted set derived from the same union type so the pair cannot drift). Tests: src/conductor/test/engine/artifacts.test.ts covers all four statuses through `checkStepCompletion`, and a gate-verdict test exercises the same envelopes through `checkGateCompletion`/`src/conductor/src/engine/gate-verdicts.ts:17-24` so a failed or refused envelope cannot satisfy objective gate recomputation. Preserves Task 9's disabled-path and Task 13's done-path completion coverage.
**Gate:** as-built
**Rationale:** Implementation gap against an existing plan task, not an architecture question: Task 14 (.docs/plans/a-coverage-claim-can-name-a-task-whose-done-when-d.md:355-368) already requires a typed infrastructure error on malformed payloads and requires ladder exhaustion to leave the completion predicate unsatisfied, but src/conductor/src/engine/step-runners.ts:2511-2518 writes a `status: 'failed'` envelope and returns an undifferentiated `{ success: false }`, and coverage_binding carries only a glob artifact contract at src/conductor/src/engine/artifacts.ts:280 with no status-aware predicate, so `checkStepCompletion` (lines 5377-5444) accepts any matching envelope and `checkGateCompletion` exposes it to gate-verdict recomputation at src/conductor/src/engine/gate-verdicts.ts:17-24 — failed evidence can satisfy the gate. Task 14 admits the whole repair. Sibling sweep: BOTH failure exits share the defect — the provider-failure return at lines 2511-2513 and the parse-failure return at lines 2515-2518 — and the `refused` status written at line 2523 is the third status the predicate must reject, so the one task covers all of them rather than fixing the cited parse path alone. No existing coverage is removed; the Task 9 `disabled` and Task 13 `done` completion paths must keep passing unchanged.
**Governing clause:** Task 14
**Parent task:** 14
**Done when:**
- Task 14 is satisfied by this task.
