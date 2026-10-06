# Implementation Plan: Maintenance-change lane for refactors, deletions, and dependency upgrades (#1790)

**Date:** 2026-10-06
**Design:** technical track — no PRD; approach and rejected alternatives recorded in `.docs/track/work-with-no-new-behavior-to-specify-has-no-lane-r.md`
**Stories:** `.docs/stories/work-with-no-new-behavior-to-specify-has-no-lane-r.md`
**Conflict check:** skipped per Tier S (`.docs/complexity/work-with-no-new-behavior-to-specify-has-no-lane-r.md`)

## Summary

Make refactors, deletions, and dependency upgrades runnable through the harness on existing
machinery: enable this repository's `feature_applicability` toggle, teach the shipped DECIDE, plan,
and TDD skills the maintenance-change recipe, and correct agent-facing text that still steers toward
retired rubrics or a nonexistent technical-track skip. 8 tasks; no engine behavior changes.

## Technical Approach

- **Repository toggle (repo-only surface).** `.ai-conductor/config.yml` gains
  `feature_applicability: { enabled: true }`. `land-spec` loads the project config from the target
  repository root (`src/conductor/src/engine/engineer/land-spec.ts`, applicability block) and passes
  `resolveFeatureApplicabilityConfig(config).enabled` plus the config's custom step names to
  `validateApplicability` (`src/conductor/src/engine/feature-applicability.ts`). A new focused test
  follows the precedent of `src/conductor/test/engine/event-spine-rubric-config.test.ts`: it resolves
  `repoRoot` from the test file, calls `loadConfig(repoRoot)`, and asserts against the loaded
  repository config — no fixture config. Before this change the toggle is absent, so
  `validateApplicability` returns `capability-disabled` for every marker; the new assertions
  (`not-declarable` for gating steps, `ok` for a class-naming `acceptance_specs` declaration) fail
  against pre-change config.
- **Recipe in the shipped DECIDE skill (consumer-facing surface).** `skills/explore/SKILL.md` already
  owns the operator-confirmed track decision and writes `.docs/track/<slug>.md`; it becomes the
  author of `.docs/applicability/<slug>.md` for a confirmed maintenance change. The marker grammar is
  the existing `Inapplicable: <step> — <reason>` line (`parseApplicability`); the recipe declares only
  `acceptance_specs`, with a reason that begins with the change class. The skill checks the target
  project's `.ai-conductor/config.yml` for `feature_applicability.enabled: true` before writing a
  marker; otherwise it writes none and relies on `acceptance_specs`' existing `disposition-only`
  outcome.
- **Plan and TDD skills.** `skills/plan/SKILL.md` §3b gains the per-class task shape (Verify-only for
  non-behavioral refactor/upgrade tasks; `/code-removal` shape for deletions; normal test-first for
  any behavior-changing task). `skills/tdd/SKILL.md` routes maintenance tasks to its existing
  **No Legitimate RED for Already-Existing Behavior** and **Removal Boundary** sections.
- **Stale-reference corrections.** The retired `scope`/`completeness`/`tautology` rubrics
  (`adr-2026-08-22-one-owner-per-review-question`) are replaced by their current owners — `prd_audit`
  for plan completion and over-scope, the `testQuality` rubric for test signal. The technical track
  skips only `prd` (`skippableForTracks` on the `prd` step in `src/conductor/src/engine/steps.ts`;
  `prd_audit` has none), so three comments claiming a `prd_audit` skip are corrected.
- **Scope split (scope-check Decision A, Step 3).** The config toggle and its test are repo-only; the
  skill edits are consumer-facing because `feature_applicability` is shipped engine configuration any
  consumer can enable. Both surfaces land in this one diff and are named separately here.

## Prerequisites

- None. Per-feature applicability (#1789) is already on `main`.

## Tasks

### Task 1: Enable per-feature applicability for this repository
**Story:** Story 1 happy 1, Story 3 negative 2 (gating steps stay undeclarable; validation layer)
**Type:** infrastructure

**Steps:**
1. Write failing test `src/conductor/test/engine/feature-applicability-repo-config.test.ts`, modeled on `src/conductor/test/engine/event-spine-rubric-config.test.ts` (resolve `repoRoot` as `resolve(testDir, '../../../..')`, call `loadConfig(repoRoot)`, assert `loaded.ok`). Derive `enabled` with `resolveFeatureApplicabilityConfig(loaded.config).enabled` and `customStepNames` exactly as `land-spec.ts` does (config `steps` keys not in `ALL_STEPS`). Assert: (a) `enabled === true`; (b) `validateApplicability('Inapplicable: acceptance_specs — dependency upgrade: the existing suite is the specification\n', …)` returns `ok: true` with one declaration for `acceptance_specs`; (c) for each of `test_suite`, `build_review`, `finish`, and every custom step name from the repository config (including `release-disposition`), a one-line marker declaring it returns `{ ok: false, error: { kind: 'not-declarable', step } }`.
2. Verify RED: against the current config the toggle is absent, so (a) fails and (b)/(c) return `capability-disabled`.
3. Implement: add a `feature_applicability:` block with `enabled: true` to `.ai-conductor/config.yml`, with a short comment that it lets merged maintenance specs declare `acceptance_specs`/`manual_test` inapplicable (#1790).
4. Verify GREEN; run the new test file only.
5. Commit.

**Done when:**
- [test] `feature-applicability-repo-config.test.ts` asserts `loadConfig(repoRoot)` succeeds and `resolveFeatureApplicabilityConfig` reports `enabled === true` for this repository's committed config.
- [test] The same test asserts `validateApplicability` accepts the class-naming `acceptance_specs` declaration under the repository's loaded config, returning `ok: true` with exactly that one declaration.
- [test] The same test asserts `validateApplicability` returns `not-declarable` naming the step for `test_suite`, `build_review`, `finish`, and each repository custom step including `release-disposition`, under the repository's loaded config.
- `.ai-conductor/config.yml` contains `feature_applicability:` with `enabled: true` and the file still loads (`loaded.ok === true` in the test above).

**Files:** `.ai-conductor/config.yml`, `src/conductor/test/engine/feature-applicability-repo-config.test.ts`

**Dependencies:** none

### Task 2: Pin that markerless features run identically with the toggle on
**Story:** Story 1 happy 2
**Type:** happy-path

**Steps:**
1. In `src/conductor/test/engine/conductor-feature-applicability.test.ts`, add a test that seeds the same state twice — every step done except `acceptance_specs` and `manual_test` (the only built-in steps `isFeatureDeclarable` admits, so the only steps the toggle can affect), with `applicability_declarations: []` — and runs the conductor once with `config: { feature_applicability: { enabled: true } }` and once with `{ enabled: false }`, each with an `EventPersister` writing `.pipeline/events.jsonl`, as the existing "honors feature A acceptance_specs only" test does.
2. Assert the two runs produce identical ordered `runner.run` step-name lists and identical final statuses for `acceptance_specs` and `manual_test`, and that neither run's persisted events contain a `step_inapplicable`, `step_inapplicable_ignored`, or `step_inapplicable_refused` event.
3. This pins preserved behavior; it is expected to pass before and after Task 1. Commit.

**Done when:**
- [test] The new conductor test asserts that with an empty declaration seed the ordered list of dispatched step names and the final `acceptance_specs`/`manual_test` statuses are identical for `feature_applicability.enabled: true` and `false`.
- [test] The same test asserts neither run persists any `step_inapplicable`, `step_inapplicable_ignored`, or `step_inapplicable_refused` event to `.pipeline/events.jsonl`.
- The test's seeded pending set is exactly `acceptance_specs` and `manual_test`, the steps the existing `isFeatureDeclarable` test in `src/conductor/test/engine/steps.test.ts` pins as the only declarable built-ins, so every other step's run/skip decision is untouched by the toggle.

**Files:** `src/conductor/test/engine/conductor-feature-applicability.test.ts`

**Dependencies:** none

### Task 8: Prove land-spec admits a class marker and refuses gating steps under this repository's config
**Story:** Story 1 negative 1, Story 2 happy 2
**Type:** negative-path

**Steps:**
1. In `src/conductor/test/engine/engineer/land-spec-applicability.test.ts`, add a variant of the `seed` helper (or a parameter) that writes this repository's own `.ai-conductor/config.yml` bytes (read via a `repoRoot` resolved from the test file, as in `event-spine-rubric-config.test.ts`) into the fixture repository's `.ai-conductor/config.yml` instead of the inline toggle, and that also writes `.docs/track/applicability-landing.md` containing `Track: technical` and `Change class: dependency upgrade`.
2. Test A: with marker `Inapplicable: acceptance_specs — dependency upgrade: the existing suite is the specification\n`, `landSpec` resolves and the land commit's `diff-tree` file list contains both `.docs/applicability/applicability-landing.md` and `.docs/track/applicability-landing.md`.
3. Test B (`it.each` over `test_suite`, `build_review`, `finish`): with marker `Inapplicable: <step> — dependency upgrade: suite is the spec\n`, `landSpec` rejects with a land-gate error whose code is `applicability-invalid` and whose message contains `not-declarable` and the step name, and no land commit is created (`git log` unchanged), following the existing "refuses any marker while the capability is disabled without creating a land commit" test.
4. Verify RED before Task 1 lands (the repository config lacks the toggle, so Test A fails and Test B reports `capability-disabled`), GREEN after. Commit.

**Done when:**
- [test] Test A asserts `landSpec` under this repository's config bytes resolves for the class-naming `acceptance_specs` marker and the land commit includes both `.docs/applicability/applicability-landing.md` and `.docs/track/applicability-landing.md`.
- [test] Test B asserts, for each of `test_suite`, `build_review`, `finish`, that `landSpec` rejects with code `applicability-invalid`, a message naming `not-declarable` and the step, and creates no land commit.
- Because the refused marker never lands, and the existing `isFeatureDeclarable` test in `src/conductor/test/engine/steps.test.ts` pins `test_suite`, `build_review`, and `finish` as not declarable, the conductor has no inapplicable-skip path for those steps: they still run and their failures still block.

**Files:** `src/conductor/test/engine/engineer/land-spec-applicability.test.ts`

**Dependencies:** Task 1

### Task 3: Teach the explore skill the maintenance-change classification and marker
**Story:** Story 2 happy 1, Story 2 negative 1, Story 2 negative 2, Story 2 negative 3
**Type:** happy-path

**Steps:**
1. In `skills/explore/SKILL.md`, add a section `### Maintenance changes (refactor, deletion, dependency upgrade)` after the track-decision practice. It defines the three classes by their acceptance criterion: refactor and dependency upgrade — existing observable behavior unchanged, proven by the existing suite; deletion — a named capability is gone and every surviving behavior still passes.
2. In that section, state: the classification is proposed with the track and needs explicit operator confirmation; interactive runs wait, autonomous runs HALT with the classification as an unconfirmed load-bearing assumption; no marker is written without confirmation.
3. State the marker: on confirmation, with track `technical`, and only when the target project's `.ai-conductor/config.yml` sets `feature_applicability.enabled: true`, write `.docs/applicability/<slug>.md` (same stem as the track marker) containing the line `Inapplicable: acceptance_specs — <class>: <why the existing suite or surviving tests are the specification>`. The reason must begin with the class name (`refactor`, `deletion`, or `dependency upgrade`). Declare no other step.
4. State the exclusions: a change that adds or changes observable behavior — including a dependency upgrade bundled with a feature — is not maintenance; write no applicability marker and follow the normal flow. When the toggle is not enabled, write no marker (land-spec refuses one) and note that `acceptance_specs` handles the change through its existing `disposition-only` outcome, citing for each criterion the existing test that covers it.
5. State that on confirmation the track marker `.docs/track/<slug>.md` also carries a prose line `Change class: <refactor|deletion|dependency upgrade>` (no parser reads it; `parseTrack` matches only the `Track:` line), so the class is recorded whether or not an applicability marker is written.
6. Amend the **Boundaries** paragraph ("It MAY write exactly one committed marker") so that explore may also write the applicability marker for an operator-confirmed maintenance change, and add a matching line to **Verification**.
7. Commit.

**Done when:**
- `skills/explore/SKILL.md` has a "Maintenance changes" section naming the three classes (refactor, deletion, dependency upgrade) and the acceptance criterion that defines each, and stating that a confirmed maintenance change's track marker carries a `Change class: <refactor|deletion|dependency upgrade>` line, whether or not the toggle is enabled.
- That section instructs writing `.docs/applicability/<slug>.md` with an `Inapplicable: acceptance_specs — <class>: …` line whose reason begins with the class name, only after operator confirmation, only on the `technical` track, and only when the target config sets `feature_applicability.enabled: true`.
- That section states that without confirmation interactive runs wait and autonomous runs HALT, writing no marker in either case.
- That section states that a change adding or changing observable behavior (including an upgrade bundled with a feature) gets no applicability marker and the normal flow, and that with the toggle off no marker is written and `acceptance_specs`' `disposition-only` outcome applies, citing for each criterion the existing test that covers it.
- The **Boundaries** paragraph permits the applicability marker for a confirmed maintenance change in addition to the track marker, and **Verification** carries a matching checklist line.

**Files:** `skills/explore/SKILL.md`

**Dependencies:** none

### Task 4: Teach the plan skill the maintenance task shape and drop the retired-rubric reference
**Story:** Story 3 happy 1, Story 3 happy 2, Story 3 negative 1, Story 3 negative 2, Story 4 happy 1 (plan skill)
**Type:** happy-path

**Steps:**
1. In `skills/plan/SKILL.md` §3b, replace "This marker is review-load-bearing evidence for the Tautology and Completeness reviews." with a sentence naming the current reader: `prd_audit` judges plan completion, and build_review's advisory work-happened floor recognizes the marker.
2. Add a subsection `### 3b-i. Maintenance-change tasks` under §3b: for a spec whose track marker carries an operator-confirmed `Change class:` line (written by `/explore`) of `refactor` or `dependency upgrade`, each task that changes no observable behavior is `**Verify-only:** yes` and its `Done when:` names the existing suite (or the scoped existing tests) passing as evidence; for `Change class: deletion`, removal tasks follow `/code-removal` (deletion diff plus passing scoped survivor tests) and are never Verify-only; any task that adds or changes observable behavior (for example adapting callers to a changed dependency API in a way they can observe) is not Verify-only and follows normal test-first ordering.
3. In the same subsection, state that the maintenance recipe declares no step other than `acceptance_specs` inapplicable: `test_suite` (including integrity checks), `build_review`, `prd_audit`, release disposition, and `finish` run exactly as for a feature, and their failures still block.
4. Commit.

**Done when:**
- `skills/plan/SKILL.md` no longer contains "Tautology and Completeness"; §3b names `prd_audit` as the completion judge for Verify-only evidence.
- A "Maintenance-change tasks" subsection keys on the track marker's `Change class:` line and states refactor/upgrade tasks with no observable behavior change are `**Verify-only:** yes` with a `Done when:` naming the existing suite or scoped existing tests passing.
- The subsection states deletion removal tasks follow `/code-removal` (deletion diff plus passing scoped survivor tests) and are never Verify-only.
- The subsection states any task that adds or changes observable behavior is not Verify-only and follows normal test-first ordering.
- The subsection states `test_suite` (with integrity checks), `build_review`, `prd_audit`, release disposition, and `finish` are never declared inapplicable by the recipe and their failures still block.

**Files:** `skills/plan/SKILL.md`

**Dependencies:** none

### Task 5: Route maintenance tasks in the TDD skill and drop the retired-rubric reference
**Story:** Story 3 happy 3, Story 4 happy 1 (tdd skill)
**Type:** happy-path

**Steps:**
1. In `skills/tdd/SKILL.md`, at the top of **No Legitimate RED for Already-Existing Behavior**, add that plan-declared Verify-only tasks of a refactor or dependency-upgrade maintenance change fall under this section, and that deletion tasks fall under **Removal Boundary**; a maintenance task that changes observable behavior runs the full cycle.
2. In the RED-validity step, replace "will fail the tautology review rubric one expensive lap later" with "will fail build_review's testQuality rubric one expensive lap later".
3. Commit.

**Done when:**
- **No Legitimate RED for Already-Existing Behavior** in `skills/tdd/SKILL.md` states that Verify-only refactor and dependency-upgrade maintenance tasks follow that section and deletion tasks follow **Removal Boundary**, rather than requiring a new failing test.
- The same addition states a maintenance task that changes observable behavior runs the full RED → GREEN cycle.
- `skills/tdd/SKILL.md` contains no "tautology review rubric" phrase; the RED-validity step names the `testQuality` rubric.

**Files:** `skills/tdd/SKILL.md`

**Dependencies:** none

### Task 6: Drop the retired completeness-rubric reference from the pipeline skill
**Story:** Story 4 happy 1 (pipeline skill)
**Type:** refactor

**Steps:**
1. In `skills/pipeline/SKILL.md`, replace "the normal completeness rubric still evaluates that task against the plan" with "`prd_audit` still judges that task's completion against the plan".
2. Commit.

**Done when:**
- `skills/pipeline/SKILL.md` contains no "completeness rubric" phrase.
- The satisfied-by paragraph in `skills/pipeline/SKILL.md` names `prd_audit` as the judge of the task's completion against the plan.

**Files:** `skills/pipeline/SKILL.md`

**Dependencies:** none

### Task 7: Correct engine and config comments about track skips and retired rubrics
**Story:** Story 4 happy 2, Story 4 negative 1
**Type:** refactor

**Steps:**
1. `.ai-conductor/config.yml`: in the `manual_test` comment's pipeline description, replace "prd_audit (skipped on technical track)" with "prd_audit (runs on both tracks; the technical track skips only prd)".
2. `src/conductor/src/engine/daemon.ts`: in the `track` field doc, replace "`technical` features skip the `prd` step + `prd-audit` at SHIP" with "`technical` features skip the `prd` step".
3. `src/conductor/src/engine/conductor.ts`: in the SHIP-loop comment above `const track = await this.resolveTrack(state);`, replace "so a technical feature skips prd_audit in the SHIP loop" with a statement that track skips apply only to steps declaring `skippableForTracks` (today only `prd`).
4. `src/conductor/src/types/state.ts`: in the track field doc, replace "`technical` features skip the `prd` step (and `prd-audit` at SHIP)" with "`technical` features skip only the `prd` step".
5. `src/conductor/src/engine/build-review-inputs.ts`: reword the comment that says these paths read "to the Scope rubric as unplanned work" so it names `prd_audit`'s OVER_SCOPE judgement, or drops the rubric name.
6. Run the greps in Done when; commit.

**Done when:**
- `grep -rniE 'technical.{0,60}prd[-_]audit|prd[-_]audit.{0,60}technical|skipped on technical track' src/conductor/src .ai-conductor/config.yml` prints nothing.
- The touched track comments in `.ai-conductor/config.yml`, `src/conductor/src/types/state.ts`, `src/conductor/src/engine/daemon.ts`, and `src/conductor/src/engine/conductor.ts` (SHIP-loop comment) each state that the technical track skips only `prd`.
- `grep -rniE 'technical (track|features?).{0,40}skip|skip.{0,40}technical track' src/conductor/src .ai-conductor/config.yml` lists only comments that name `prd` as the sole technical-track skip (today's untouched matches, `steps.ts` on the `prd` step and `conductor.ts` "`prd` is skipped on the technical track", already do).
- `grep -rniE 'completeness rubric|tautology (review )?rubric|scope rubric|Tautology and Completeness' skills/ src/conductor/src` prints only lines that state the rubric is retired, removed, or replaced (none otherwise).
- No executable line changes in `state.ts`, `daemon.ts`, `conductor.ts`, or `build-review-inputs.ts`: `git diff` for those files touches comment lines only.

**Files:** `.ai-conductor/config.yml`, `src/conductor/src/types/state.ts`, `src/conductor/src/engine/daemon.ts`, `src/conductor/src/engine/conductor.ts`, `src/conductor/src/engine/build-review-inputs.ts`

**Dependencies:** Tasks 1, 4, 5, 6

## Task Dependency Graph

```
Task 1 ──▶ Task 8
   │
   └────────────┐
Task 4 ─────────┤
Task 5 ─────────┼──▶ Task 7
Task 6 ─────────┘
Task 2, Task 3 (independent)
```

Task 7 depends on Task 1 (both edit `.ai-conductor/config.yml`) and on Tasks 4–6 (its repository-wide
grep check covers their skill edits).

## Integration Points

- After Task 1: a maintenance spec carrying `Inapplicable: acceptance_specs — <class>: …` validates
  through this repository's `land-spec`; a marker naming any gating or custom step is refused.
- After Task 3: `/explore` authors that marker for an operator-confirmed maintenance change.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given this repository's committed project config, when the engine loads it, then `feature_applicability.enabled` resolves to `true`. | 1 | "asserts `loadConfig(repoRoot)` succeeds and `resolveFeatureApplicabilityConfig` reports `enabled === true` for this repository's committed config" | diff-local |
| Story 1 happy: Given a merged spec with no `.docs/applicability/<stem>.md` marker, when the daemon runs it, then the same steps run and skip as before the toggle was enabled (no `step_inapplicable` event is emitted for it). | 2 | "asserts neither run persists any `step_inapplicable`, `step_inapplicable_ignored`, or `step_inapplicable_refused` event to `.pipeline/events.jsonl`" | diff-local |
| Story 1 negative: Given a spec whose applicability marker declares `test_suite` (or `build_review`, or `finish`) inapplicable, when `land-spec` validates it, then landing is refused with an `applicability-invalid` error naming `not-declarable`, and the step still runs and blocks for that feature. | 8 | "rejects with code `applicability-invalid`, a message naming `not-declarable` and the step, and creates no land commit" | diff-local |
| Story 2 happy: Given an operator-confirmed change whose only acceptance criterion is that existing behavior is unchanged (refactor, dependency upgrade) or that a named capability is gone and everything else still passes (deletion), and the target project enables `feature_applicability`, when DECIDE confirms the track, then it records the `technical` track and writes `.docs/applicability/<stem>.md` declaring `acceptance_specs` inapplicable with a reason that names the change class (for example `Inapplicable: acceptance_specs — dependency upgrade: the existing suite is the specification`). | 3 | "instructs writing `.docs/applicability/<slug>.md` with an `Inapplicable: acceptance_specs — <class>: …` line whose reason begins with the class name, only after operator confirmation, only on the `technical` track, and only when the target config sets `feature_applicability.enabled: true`" | diff-local |
| Story 2 happy: Given that maintenance spec is landed, when `land-spec` validates it, then the marker passes validation and is committed in the spec PR alongside the track marker. | 8 | "the land commit includes both `.docs/applicability/applicability-landing.md` and `.docs/track/applicability-landing.md`" | diff-local |
| Story 2 negative: Given a change that introduces or changes observable behavior, including a dependency upgrade that also adds a feature, when DECIDE classifies it, then it is not recorded as maintenance and no applicability marker is written; the normal flow applies. | 3 | "a change adding or changing observable behavior (including an upgrade bundled with a feature) gets no applicability marker and the normal flow" | diff-local |
| Story 2 negative: Given the operator has not confirmed the maintenance classification, when DECIDE reaches the track decision, then an interactive run waits for confirmation, an autonomous run HALTs, and no applicability marker is written in either case. | 3 | "without confirmation interactive runs wait and autonomous runs HALT, writing no marker in either case" | diff-local |
| Story 2 negative: Given the target project does not enable `feature_applicability`, when DECIDE handles a maintenance change, then it writes no applicability marker (which `land-spec` would refuse) and directs the change through `acceptance_specs`' existing disposition-only outcome, citing the existing tests that cover each criterion. | 3 | "citing for each criterion the existing test that covers it" | diff-local |
| Story 3 happy: Given a dependency-upgrade or refactor maintenance spec, when its plan is authored, then each task that changes no observable behavior is marked `**Verify-only:** yes` and its Done-when names the existing suite (or the scoped existing tests) passing as the evidence. | 4 | "refactor/upgrade tasks with no observable behavior change are `**Verify-only:** yes` with a `Done when:` naming the existing suite or scoped existing tests passing" | diff-local |
| Story 3 happy: Given a deletion maintenance spec, when its plan is authored, then removal tasks follow `code-removal` (deletion diff plus passing scoped survivor tests) and are not marked Verify-only. | 4 | "deletion removal tasks follow `/code-removal` (deletion diff plus passing scoped survivor tests) and are never Verify-only" | diff-local |
| Story 3 happy: Given a maintenance task under build, when TDD ordering is applied, then the skill directs the builder to the existing no-legitimate-RED or removal-boundary path rather than requiring a new failing test. | 5 | "states that Verify-only refactor and dependency-upgrade maintenance tasks follow that section and deletion tasks follow **Removal Boundary**, rather than requiring a new failing test" | diff-local |
| Story 3 negative: Given a maintenance plan task that adds or changes behavior (for example adapting code to a changed dependency API in a way callers can observe), when the plan is authored, then that task is not marked Verify-only and follows normal test-first ordering. | 4 | "any task that adds or changes observable behavior is not Verify-only and follows normal test-first ordering" | diff-local |
| Story 3 negative: Given a maintenance spec, when it reaches SHIP, then `test_suite`, the integrity checks, and the release-disposition contract run exactly as for a feature and a failure still blocks; the recipe declares none of them inapplicable. | 4, 1 | "`test_suite` (with integrity checks), `build_review`, `prd_audit`, release disposition, and `finish` are never declared inapplicable by the recipe and their failures still block" | diff-local |
| Story 4 happy: Given the shipped `plan`, `pipeline`, and `tdd` skills, when they describe what reads Verify-only evidence, satisfied-by tasks, or tests that pass before a change, then they name the current owner (`prd_audit` for plan completion, the `testQuality` rubric for test signal) instead of the retired completeness or tautology rubrics. | 4, 5, 6 | "§3b names `prd_audit` as the completion judge for Verify-only evidence" | diff-local |
| Story 4 happy: Given the engine source and project config comments describing track skips, when they describe the technical track, then they state that it skips only `prd`. | 7 | "lists only comments that name `prd` as the sole technical-track skip" | diff-local |
| Story 4 negative: Given a search of the shipped skills and engine comments for instructions that rely on the `scope`, `completeness`, or `tautology` rubric, when it runs, then the only matches are statements that those rubrics are retired. | 7 | "prints only lines that state the rubric is retired, removed, or replaced (none otherwise)" | diff-local |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks; no unbounded quality word is left without its closed enumeration or named mechanism
- [ ] Dependencies are explicit and acyclic
