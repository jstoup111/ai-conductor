# Implementation Plan: build_review severity definitions have one engine-owned source (#3381)

**Date:** 2026-10-28
**Design:** none (technical track, Small tier; governed by `adr-2026-10-19-build-review-finding-severity-advisory-threshold` D1 as amended 2026-10-28)
**Stories:** .docs/stories/build-review-severity-definitions-are-duplicated-p.md
**Conflict check:** Not required at Small tier

## Summary

The severity scale is defined in four copies today: a paragraph in each of the three built-in rubric
skills and an inlined sentence in the custom-rubric contract prompt. This plan moves it to one
engine-owned text that both prompt assemblers render, removes every copy, and adds tests that fail on
any missing, reworded, or reintroduced copy, in 4 tasks.

## Technical Approach

- **One source.** `src/conductor/src/engine/build-review-contract.ts` already owns
  `renderRubricContractShape`, which both prompt assemblers import. It gains:
  - `BUILD_REVIEW_SEVERITY_DEFINITIONS: Readonly<Record<BuildReviewSeverity, string>>`, declared in the
    order `critical`, `major`, `minor`, `nit`, with `BuildReviewSeverity` imported as a type from
    `../types/build-review.js`. A `Record` keyed by the severity type makes a missing or extra level a
    compile error. The meanings are exactly the four in the ADR's D1:
    - `critical`: `security exposure, data loss, or wrong results`
    - `major`: `a real defect or broken invariant`
    - `minor`: `a real, low-impact quality issue`
    - `nit`: `cosmetic, such as naming or style`
  - `renderBuildReviewSeverityDefinitions(): string`, which returns exactly
    ``Every finding requires `severity`. Severity definitions: `critical`: security exposure, data loss, or wrong results; `major`: a real defect or broken invariant; `minor`: a real, low-impact quality issue; `nit`: cosmetic, such as naming or style.``
    It builds the list from the record's entries in declaration order, joined with `; `.
  - The constant does not live in `build-review-domain.ts` beside `BUILD_REVIEW_SEVERITIES`, because
    `build-review-domain.ts` imports `build-review-policy-contract.ts`, so the custom prompt would
    import its own importer.
- **Built-in prompt.** In `dispatchBuildReviewRubric` (`src/conductor/src/engine/step-runners.ts`),
  the `rubricPrompt` array gains one paragraph, `renderBuildReviewSeverityDefinitions()`, immediately
  after the `Your final message MUST end with one JSON object matching this schema:` paragraph and
  before the projection JSON. Every built-in rubric is dispatched through this one array, so a newly
  registered rubric gets the text with no per-rubric code.
- **Custom prompt.** In `renderBuildReviewPolicyContract`
  (`src/conductor/src/engine/build-review-policy-contract.ts`), the `Payload variants:` line drops its
  `Every finding requires severity: critical (…), major (…), minor (…), or nit (…).` sentence and keeps
  the rest, ending `… when you cannot. Include no other fields.` A new line,
  `renderBuildReviewSeverityDefinitions()`, goes immediately after the `Shared findings payload schema:`
  line.
- **Skills.** Delete the severity sentence from `skills/build-review-implementation-quality/SKILL.md`
  (its `## Result` paragraph keeps "and required `severity`" and its closing sentence) and the trailing
  severity paragraph from `skills/build-review-security/SKILL.md` and
  `skills/build-review-test-quality/SKILL.md`. No other skill text changes.
- **Tests.** A new `src/conductor/test/engine/build-review-severity-prompt.test.ts` captures each
  built-in prompt by calling `dispatchBuildReviewRubric` on a `DefaultStepRunner` with a mocked
  `invoke`. Follow `captureRubricPrompt` in `src/conductor/test/engine/build-review-dispatch-prompt.test.ts`:
  it builds a branch and a projection per rubric (search hints: the `TestQualityProjection` fixture
  there, and the security projection in `build-review-rubric-skills.test.ts`), and reads
  `invoke.mock.calls[0][0].prompt`. A second new file,
  `src/conductor/test/engine/build-review-severity-prompt-source.test.ts`, uses `vi.mock` with
  `importOriginal` on `../../src/engine/build-review-contract.js` to replace
  `renderBuildReviewSeverityDefinitions` with a sentinel. It needs its own file because `vi.mock` is
  hoisted for the whole file.
- **Unchanged.** Severity values, order, result schemas, contract versions (built-in v4, custom v2),
  finding identity, and the rubric cache key. The engine content stamp in the key changes with every
  engine build already.

## Prerequisites

- None.

## Tasks

### Task 1: Add the engine-owned severity definitions and their renderer
**Story:** Story 1
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/build-review-contract.test.ts` for every Done-when check below.
2. Verify the tests fail (RED).
3. Implement in `src/conductor/src/engine/build-review-contract.ts`, importing `BuildReviewSeverity` as a type from `../types/build-review.js` and nothing from `build-review-domain.ts` (which imports `build-review-policy-contract.ts`):
   - `BUILD_REVIEW_SEVERITY_DEFINITIONS: Readonly<Record<BuildReviewSeverity, string>>`, declared in this order: `critical` → `security exposure, data loss, or wrong results`; `major` → `a real defect or broken invariant`; `minor` → `a real, low-impact quality issue`; `nit` → `cosmetic, such as naming or style`;
   - `renderBuildReviewSeverityDefinitions(): string`, which builds the list from the record's entries in declaration order as ``` `<level>`: <meaning> ``` joined with `; ` and returns exactly: ``Every finding requires `severity`. Severity definitions: `critical`: security exposure, data loss, or wrong results; `major`: a real defect or broken invariant; `minor`: a real, low-impact quality issue; `nit`: cosmetic, such as naming or style.``
4. Verify the tests pass (GREEN).
5. Commit: "feat(build-review): engine-owned severity definitions"

**Done when:**
- [test] A `build-review-contract.test.ts` case asserts `Object.keys(BUILD_REVIEW_SEVERITY_DEFINITIONS)` equals `['critical', 'major', 'minor', 'nit']` and each value equals the meaning listed in Steps.
- [test] A `build-review-contract.test.ts` case asserts `renderBuildReviewSeverityDefinitions()` returns exactly the string pinned in Steps.
- `src/conductor/src/engine/build-review-contract.ts` has no import from `build-review-domain.ts` or `build-review-policy-contract.ts`.

**Files likely touched:**
- `src/conductor/src/engine/build-review-contract.ts` — severity definitions constant and renderer
- `src/conductor/test/engine/build-review-contract.test.ts` — renderer tests

**Dependencies:** none

### Task 2: Render the shared severity definitions into every built-in rubric dispatch prompt
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/build-review-severity-prompt.test.ts` and `src/conductor/test/engine/build-review-severity-prompt-source.test.ts` for every Done-when check below. Generate the per-rubric cases with `it.each(BUILD_REVIEW_RUBRIC_IDS)` (import it from `src/conductor/src/engine/build-review-registry.ts`), with the rubric id in each case title, and take each branch's `skillName` from `getBuildReviewRubricDescriptor`.
2. Verify the tests fail (RED). Today the built-in prompt carries no severity text.
3. Implement: in `dispatchBuildReviewRubric` in `src/conductor/src/engine/step-runners.ts`, add `renderBuildReviewSeverityDefinitions()` as its own paragraph immediately after the result-schema paragraph of `rubricPrompt`.
4. Verify the tests pass (GREEN).
5. Commit: "feat(build-review): built-in rubric prompts render the shared severity definitions"

**Done when:**
- [test] For every id in `BUILD_REVIEW_RUBRIC_IDS`, a case titled with that id dispatches the rubric through `DefaultStepRunner.dispatchBuildReviewRubric` and asserts that the captured provider prompt contains `renderBuildReviewSeverityDefinitions()` exactly once and that, split on blank lines, the paragraph right after the one starting `Your final message MUST end with one JSON object matching this schema:` equals it byte for byte; a prompt that omits or rewords the text fails the case titled with that rubric id.
- [test] In `build-review-severity-prompt-source.test.ts`, with `renderBuildReviewSeverityDefinitions` mocked to return a sentinel string, every id in `BUILD_REVIEW_RUBRIC_IDS` dispatches a prompt containing the sentinel exactly once and none of the four D1 meaning phrases, while the bytes of every registered rubric's `skills/<skillName>/SKILL.md` are identical before and after the run, which proves the text comes from the engine-owned source and from no SKILL.md.
- The `rubricPrompt` array in `dispatchBuildReviewRubric` is the only built-in prompt site that adds severity text, and it names no rubric id when doing so.

**Files likely touched:**
- `src/conductor/src/engine/step-runners.ts` — severity paragraph in the built-in rubric prompt
- `src/conductor/test/engine/build-review-severity-prompt.test.ts` — per-rubric prompt tests (new)
- `src/conductor/test/engine/build-review-severity-prompt-source.test.ts` — sentinel source test (new)

**Dependencies:** Task 1

### Task 3: Render the same definitions into the custom rubric prompt and drop its inline copy
**Story:** Story 2
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/build-review-severity-prompt.test.ts` for every Done-when check below. Build the custom prompt with `renderBuildReviewPolicyContract`, using the bundle, question, scope, and `BUILD_REVIEW_CUSTOM_V1_CONTRACT` fixture pattern from `src/conductor/test/engine/build-review-policy-contract.test.ts`.
2. Verify the tests fail (RED).
3. Implement in `renderBuildReviewPolicyContract` in `src/conductor/src/engine/build-review-policy-contract.ts`: remove the `Every finding requires severity: …` sentence from the `Payload variants:` line, and add `renderBuildReviewSeverityDefinitions()` as the line immediately after the `Shared findings payload schema:` line.
4. Verify the tests pass (GREEN).
5. Commit: "feat(build-review): custom rubric prompt renders the shared severity definitions"

**Done when:**
- [test] The rendered custom policy contract prompt contains `renderBuildReviewSeverityDefinitions()` exactly once, on the line immediately after the `Shared findings payload schema:` line, and that line is byte-identical to the severity paragraph captured from the testQuality, security, and implementationQuality built-in dispatch prompts.
- [test] The rendered custom policy contract prompt does not contain `Every finding requires severity: critical (`, and its `Payload variants:` line still contains `{"kind":"custom-findings","version":"v2","findings":[...]}`, `{"kind":"unsupported-policy","requirement":`, and `Include no other fields.`
- `renderBuildReviewPolicyContract` in `src/conductor/src/engine/build-review-policy-contract.ts` contains no severity meaning text of its own.

**Files likely touched:**
- `src/conductor/src/engine/build-review-policy-contract.ts` — shared severity line, inline sentence removed
- `src/conductor/test/engine/build-review-severity-prompt.test.ts` — custom prompt tests

**Dependencies:** Task 2

### Task 4: Remove the severity scale from the built-in rubric skills
**Story:** Story 3
**Type:** refactor

**Steps:**
1. Write failing tests in `src/conductor/test/engine/build-review-rubric-skills.test.ts` for the first Done-when check. Generate one case per `BUILD_REVIEW_RUBRIC_REGISTRY` entry with `it.each`, with the descriptor's `skillName` in the case title, reading `skills/<skillName>/SKILL.md` from the repository root.
2. Verify the tests fail (RED). Today all three skills define the scale.
3. Implement: in `skills/build-review-implementation-quality/SKILL.md`, delete the sentence starting "Use `critical` for security exposure" from the `## Result` paragraph, keeping "and required `severity`" and the closing "Return an empty findings array …" sentence; in `skills/build-review-security/SKILL.md` and `skills/build-review-test-quality/SKILL.md`, delete the trailing paragraph starting "Every reported finding requires `severity`". Change no other skill text.
4. Verify the tests pass (GREEN).
5. Commit: "refactor(build-review): rubric skills no longer define the severity scale"

**Done when:**
- [test] For every `BUILD_REVIEW_RUBRIC_REGISTRY` entry, a case titled with its `skillName` reads `skills/<skillName>/SKILL.md` and asserts it contains none of the four `BUILD_REVIEW_SEVERITY_DEFINITIONS` values and no match of the pattern for a backticked `critical`, `major`, `minor`, or `nit`; a skill that contains either fails the case titled with that skill directory name.
- [test] The existing `build-review rubric skill catalog` cases in `build-review-rubric-skills.test.ts`, which assert each skill's judgement vocabulary and non-finding guidance, pass with no edit to their assertions, and `test/check_build_review_rubric_skill_vocabularies.sh` exits 0.
- `git diff` of the three SKILL.md files removes only the severity text: in `build-review-implementation-quality` the `## Result` paragraph still contains "and required `severity`" and "Return an empty findings array when there is no concrete defect."

**Files likely touched:**
- `skills/build-review-implementation-quality/SKILL.md` — severity sentence removed
- `skills/build-review-security/SKILL.md` — severity paragraph removed
- `skills/build-review-test-quality/SKILL.md` — severity paragraph removed
- `src/conductor/test/engine/build-review-rubric-skills.test.ts` — skill-free-of-scale test

**Dependencies:** Task 2

## Task Dependency Graph

```
Task 1 → Task 2 → Task 3
              └─→ Task 4
```

## Integration Points

- After Task 2: every built-in rubric dispatch carries the engine-owned text.
- After Task 3: built-in and custom prompts carry the same text. After Task 4 it is the only copy.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given each rubric id in the built-in rubric registry (testQuality, security, implementationQuality), when build_review dispatches that rubric, then the dispatched prompt contains the shared severity definitions exactly once, byte-identical to the engine-owned text, in the paragraph after the result schema. | 2 | "asserts that the captured provider prompt contains `renderBuildReviewSeverityDefinitions()` exactly once" | diff-local |
| Story 1 happy: Given the engine-owned severity definition text is changed in its one source, when each registered built-in rubric is dispatched, then every dispatched prompt carries the changed text and no rubric SKILL.md is edited. | 2 | "with `renderBuildReviewSeverityDefinitions` mocked to return a sentinel string, every id in `BUILD_REVIEW_RUBRIC_IDS` dispatches a prompt containing the sentinel exactly once" | diff-local |
| Story 1 negative: Given a registered built-in rubric whose dispatch prompt omits the shared severity definitions or carries a different wording of them, when the dispatch-prompt test runs, then the test fails and names that rubric id. | 2 | "a prompt that omits or rewords the text fails the case titled with that rubric id" | diff-local |
| Story 2 happy: Given a custom review policy, when the engine renders its build-review policy contract prompt, then the prompt contains the shared severity definitions exactly once, byte-identical to the text in every built-in rubric dispatch prompt, after the shared findings payload schema line. | 3 | "byte-identical to the severity paragraph captured from the testQuality, security, and implementationQuality built-in dispatch prompts" | diff-local |
| Story 2 negative: Given the rendered custom policy contract prompt, when it is inspected for severity guidance, then it contains no second severity definition: the inline parenthetical sentence that begins "Every finding requires severity: critical (" is absent, and the payload-variants line still names the custom-findings and unsupported-policy variants. | 3 | "The rendered custom policy contract prompt does not contain `Every finding requires severity: critical (`" | diff-local |
| Story 3 happy: Given the installed SKILL.md of every rubric in the built-in rubric registry, when its text is read, then it contains none of the four severity meanings and no backticked severity level name (`critical`, `major`, `minor`, `nit`), and its judgement vocabulary and non-finding guidance are unchanged. | 4 | "asserts it contains none of the four `BUILD_REVIEW_SEVERITY_DEFINITIONS` values" | diff-local |
| Story 3 negative: Given a registered rubric's SKILL.md that contains a severity meaning or a backticked severity level name, when the rubric-skill test runs, then the test fails and names that skill's directory. | 4 | "a skill that contains either fails the case titled with that skill directory name" | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-10-19-build-review-finding-severity-advisory-threshold#D1 | task | task-2, task-3, task-4 | asserts that the captured provider prompt contains `renderBuildReviewSeverityDefinitions()` exactly once |
| adr-2026-10-19-build-review-finding-severity-advisory-threshold#D2 | no-change | none | Contract versions stay built-in v4 and custom v2; no schema or identity input changes |
| adr-2026-10-19-build-review-finding-severity-advisory-threshold#D3 | no-change | none | `min_severity` config keys, validation, and the threshold helper are untouched |
| adr-2026-10-19-build-review-finding-severity-advisory-threshold#D4 | no-change | none | Effective-verdict classification order and advisory reduction are untouched |
| adr-2026-10-19-build-review-finding-severity-advisory-threshold#D5 | no-change | none | Suppression store, `build_review_outer_verdict` advisory list, CLI, and PR-body region are untouched |
| adr-2026-10-19-build-review-finding-severity-advisory-threshold#D6 | no-change | none | The remediate advisory disposition and `skills/remediate/SKILL.md` are out of scope and unchanged |
| adr-2026-10-19-build-review-finding-severity-advisory-threshold#D7 | no-change | none | The settled-recurrence predicate for advisory cases is untouched |

## Verification
- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic
