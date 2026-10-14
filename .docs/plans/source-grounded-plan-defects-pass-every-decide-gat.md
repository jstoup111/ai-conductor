# Implementation Plan: Source-grounded adversarial plan review before land (#3038)

**Date:** 2026-10-10
**Design:** `.docs/decisions/adr-2026-10-10-source-grounded-adversarial-plan-review-step.md`
**Stories:** `.docs/stories/source-grounded-plan-defects-pass-every-decide-gat.md`
**Conflict check:** Clean as of 2026-10-10 (`.docs/conflicts/source-grounded-plan-defects-pass-every-decide-gat.md`)

## Summary

This plan adds the Medium/Large `plan_review` DECIDE step: deterministic candidate lenses, one
bounded, read-only, cross-provider reviewer dispatch with schema-validated findings, a committed
review artifact and a model-free land rung. It also retires plan §7b at M/L and coherence-check §4a
re-run and §4d. 24 tasks.

## Technical Approach

- **One engine module family, two entry points (ADR D1).** New flat modules under
  `src/conductor/src/engine/`:
  - `plan-review-contract.ts`: findings schema and validator.
  - `plan-review-artifact.ts`: render, parse, digests and integrity.
  - `plan-review-candidates.ts`: the three lenses.
  - `plan-review-provider.ts`: host and reviewer selection.
  - `plan-review-runner.ts`: rounds, dispatch, operator actions and events.
  - `engineer/plan-review-gate.ts`: the land rung.

  `ai-conductor compose plan-review` (in `engineer-cli.ts`) and the `plan_review` branch in
  `step-runners.ts` both call `runPlanReview`.
- **Dependency graph (ADR D2).** The `**Dependencies:**` parsing inside `validatePlanSlices` moves
  into a new exported `plan-dependencies.ts`, and `plan-slices.ts` consumes it.
  - **Source constraint (verified, `src/conductor/test/engine/plan-slices-consumer-boundary.test.ts`):**
    only `engine/engineer/land-spec.ts` and `engine/step-runners.ts` may import `plan-slices.js`.
    Only `engine/plan-slices.ts` may contain the word `Slices`. Only an enumerated set may contain
    `stacked_prs`.
  - So no new module may import `plan-slices.js`, or contain the word `Slices` or `stacked_prs`.
- **Candidates are grep-level text search (D2).** They use repo-relative paths and backticked
  identifiers from the plan, so they work in any language. They are inputs to the reviewer, and
  never findings on their own.
- **Reviewer dispatch (D3) follows the `prd_audit` one-shot precedent,** but with
  `readOnlyReview: true` instead of `dangerouslySkipPermissions`.
  - *Precedent traits to preserve:* a fresh session, a native output schema, engine-side
    validation, and an engine write of the verdict artifact.
  - *Rediscovery hints:* `executeProviderCandidates` in `engine/provider-execution.ts`;
    `executeProviderAwareSkillOneShot` and the `prd_audit` branch of `runDispatch` in
    `engine/step-runners.ts`; `PRD_AUDIT_JUDGMENT_SCHEMA` and `validatePrdAuditJudgment` in
    `engine/prd-audit-contract.ts`.
  - *Allowed variation:* the composer entry point builds its own runtime set the way
    `engine/project-prelude.ts` does (`createProviderRuntimeSet`, `ProviderSessionStore`).
- **Schema (D5)** is authored in the codex strict-compatible subset (`codex-strict-schema.ts`):
  every property required, nullable where optional, and no `oneOf`.
- **Provider selection (D4):** host markers come from `BUILT_IN_PROVIDERS[i].interactiveLaunch.sessionMarkers`
  (`execution/provider-catalog.ts`). The launcher sets `AI_CONDUCTOR_AUTHORING_PROVIDER` on the
  `spawnInteractiveHost` env.
- **Daemon legacy (D9):** a generic `StepDefinition.absentArtifactDisposition` rule lands in
  `decide-entry-policy.ts` (Task 7) before `plan_review` is registered (Task 8). This satisfies
  architecture-review Condition 1.
- **Events (D8)** are new `ConductorEvent` variants registered in `EVENT_SINKS`. Under compose they
  are persisted with the existing `composer-events.jsonl` emitter pattern from `engineer-cli.ts`.
- **Skill text (D10).** Shared test files are edited in a strict order to avoid task-vs-task
  interference over `plan-interference-check-skill-contract.test.ts`:
  1. Task 18 (new brief)
  2. Task 19 (coherence-check and conflict-check)
  3. Task 20 (plan)

## Prerequisites

- None. There is no new package and no migration.

## Tasks

### Task 1: Export a plan dependency graph parser and move plan-slices onto it
**Story:** Story 3 (negative path 2; foundation for happy paths 1 and 2)
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/plan-dependencies.test.ts` for `parsePlanDependencyGraph(planText)` and `transitiveDependencies(graph, taskId)`. Cover:
   - `none`;
   - `Task 1, Tasks 2, 3`;
   - a missing line;
   - a malformed value;
   - an unknown id;
   - a 3-hop transitive closure.
2. Verify RED.
3. Implement `src/conductor/src/engine/plan-dependencies.ts` by moving the `DEPENDENCIES_LINE` parsing out of `validatePlanSlices`. Reuse `parsePlanTaskBodies` and `resolvePlanTaskReference`, and keep the violation codes `dependencies-line`, `malformed-dependencies` and `unknown-dependency`.
4. Change `validatePlanSlices` to call the parser and keep its own `later-slice-dependency` check.
5. The new module must not contain the word `Slices` or `stacked_prs`.
6. Verify GREEN, including the existing `plan-slices*.test.ts` files unchanged.
7. Commit.

**Done when:**
- [test] `parsePlanDependencyGraph` returns each task's direct dependency ids and reports `malformed-dependencies` naming the task for a malformed `**Dependencies:**` value, as asserted in `plan-dependencies.test.ts`.
- [test] `transitiveDependencies` returns the full 3-hop closure for the chained fixture.
- `validatePlanSlices` imports its dependency parsing from `plan-dependencies.ts`, and every existing `src/conductor/test/engine/plan-slices*.test.ts` assertion passes unmodified.

**Files likely touched:**
- `src/conductor/src/engine/plan-dependencies.ts` — new exported parser
- `src/conductor/src/engine/plan-slices.ts` — consume the parser
- `src/conductor/test/engine/plan-dependencies.test.ts` — new tests

**Dependencies:** none

### Task 2: Findings schema and evidence validator
**Story:** Story 4 (happy paths 1 and 2; negative path 1)
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/plan-review-contract.test.ts` for `validatePlanReviewResult`.
   - A valid finding per lens is accepted.
   - A test-impact, reachability or feasibility finding with no `file:line` evidence is rejected with a message naming the finding id and `evidence`.
   - A contradiction finding needs two quoted passages.
   - A severity outside `blocking | significant | advisory` (for example `oscillation`) is rejected.
2. Verify RED.
3. Implement `src/conductor/src/engine/plan-review-contract.ts`:
   - `PLAN_REVIEW_RESULT_SCHEMA` (deep-frozen; fields id, severity, lens, artifact, reference, summary, evidence; each finding also carries a required, nullable `relatedReference` (the second task of a task-versus-task or dependency-order finding) and a required, nullable `resolvesPrior` for round 2, so the codex strict rewrite leaves the schema unchanged);
   - `validatePlanReviewResult`;
   - the `PlanReviewFinding` types.
4. Pass the schema through `toCodexStrictSchema` (or the module's exported rewrite) in a test and assert it is accepted unchanged in shape. Assert the pi path writes it as the `--conduct-output-schema` file content.
5. Verify GREEN. Commit.

**Done when:**
- [test] `validatePlanReviewResult` accepts one valid finding per lens carrying id, severity, lens, artifact path, a reference written as `task <id>`, a story id, or `<adr-stem>#D<n>`, summary, and evidence, and rejects any other reference form.
- [test] `validatePlanReviewResult` rejects any finding with no worktree `file:line` evidence, and a test-impact or feasibility finding whose only `file:line` is not in a source file outside `.docs/`, with a message naming the finding id and the missing field, and rejects a dependency-order finding whose `relatedReference` names no second task.
- [test] `validatePlanReviewResult` rejects a contradiction finding unless its evidence carries two quoted passages that each occur verbatim in the full plan, stories, or in-scope ADR texts or in a cited worktree source file, and rejects any severity outside blocking, significant, advisory.
- [test] `PLAN_REVIEW_RESULT_SCHEMA` survives the codex strict-schema rewrite with every property required and no `oneOf`, and is accepted by the claude `--json-schema` and pi `--conduct-output-schema` argument builders.

**Files likely touched:**
- `src/conductor/src/engine/plan-review-contract.ts` — new
- `src/conductor/test/engine/plan-review-contract.test.ts` — new

**Dependencies:** none

### Task 3: Review artifact render, parse, reviewed digest and integrity digest
**Story:** Story 4 (happy path 1); Story 6 (Done When fields); Story 7 (negative path 3); Story 8 (negative path 3)
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/plan-review-artifact.test.ts`:
   - `renderPlanReviewArtifact` and `parsePlanReviewArtifact` round-trip a fixture holding round count, authoring-host, reviewer-provider, independence, findings, dispositions and the reviewed digest.
   - A one-character hand edit makes `parsePlanReviewArtifact` report `integrity-mismatch`.
   - Unparseable text reports `unparseable`.
   - `computeReviewedDigest` returns an overall digest plus component digests per plan task (`planTaskDigests`), per story, per in-scope ADR decision, and per artifact file; each changes only when its own text changes.
2. Verify RED.
3. Implement `src/conductor/src/engine/plan-review-artifact.ts`:
   - Markdown with a fenced JSON payload, plus an integrity sha256 over the whole file content except the integrity line itself, so an edit anywhere in the file is detected.
   - The in-scope ADR set is ADRs in the change set plus ADR stems the plan cites.
4. Verify GREEN. Commit.

**Done when:**
- [test] `parsePlanReviewArtifact(renderPlanReviewArtifact(x))` deep-equals `x` for a fixture carrying round count, authoring-host, reviewer-provider, independence, findings, and operator dispositions.
- [test] `parsePlanReviewArtifact` returns `integrity-mismatch` for a fixture whose payload was edited after rendering, and `unparseable` for non-artifact text.
- [test] `computeReviewedDigest` returns component digests per plan task, per story, per in-scope ADR decision, and per artifact file, and `diffReviewedDigests` names exactly the tasks, stories, decisions, and artifact files whose text changed, ignoring out-of-scope ADRs.

**Files likely touched:**
- `src/conductor/src/engine/plan-review-artifact.ts` — new
- `src/conductor/test/engine/plan-review-artifact.test.ts` — new

**Dependencies:** Task 2

### Task 4: Test-impact candidate lens
**Story:** Story 1 (happy paths 1 and 2; negative path 2)
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/plan-review-candidates-test-impact.test.ts` against a temp git worktree fixture that reproduces #3036. In it, a test file asserts that only `engine/config.ts` and `types/config.ts` reference `stacked_prs`, and a plan task lists `src/conductor/src/engine/engineer/land-spec.ts` and adds a `stacked_prs` reference.
2. Cover three cases:
   - When no task lists the test, the candidate names the test `file:line` and the task id.
   - When a task lists the test, there is no candidate.
   - A worktree with no test files produces zero candidates and no throw.
3. Verify RED.
4. Implement `testImpactCandidates({ worktreePath, planText })` in `src/conductor/src/engine/plan-review-candidates.ts`. Use `parsePlanTaskPaths` and backticked identifiers. Test files are those matching `isTestFilePath` (`engine/test-path.ts`), plus any file under a top-level `test/` or `tests/` directory (so shell suites such as `test/test_provider_skill_contracts.sh` are seen), searched for each path basename or identifier.
5. Verify GREEN. Commit.

**Done when:**
- [test] `testImpactCandidates` on the #3036 `stacked_prs` fixture returns a candidate naming the test file's `file:line` and the task id that changes the referenced identifier.
- [test] `testImpactCandidates` returns no candidate for a test listed in some task's files.
- [test] `testImpactCandidates` returns an empty list without throwing for a worktree containing no test files.
- [test] `testImpactCandidates` treats a shell suite under `test/` that references a planned path as a test file and returns a candidate for it.

**Files likely touched:**
- `src/conductor/src/engine/plan-review-candidates.ts` — new (test-impact lens)
- `src/conductor/test/engine/plan-review-candidates-test-impact.test.ts` — new

**Dependencies:** none

### Task 5: Reachability candidate lens and Wiring Surface parser
**Story:** Story 2 (happy paths 1 and 2; negative paths 1 and 2)
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/plan-review-candidates-reachability.test.ts` covering:
   - an export introduced by a task with no caller in source and no task naming a caller (the #3036 `projectChildOwnership` shape), which gives a candidate naming the export, the task and the files searched;
   - an export whose Done-when observes it through an existing CLI command, which gives no candidate;
   - a Wiring Surface item that already has a production caller in source, which gives no candidate;
   - an architecture review with no `## Wiring Surface`, where candidates are still derived from the plan's backticked exports.
2. Verify RED.
3. Implement `parseWiringSurface(reviewText)` and `reachabilityCandidates({ worktreePath, planText, architectureReviewText })` in `plan-review-candidates.ts`. Search excludes test files and the defining file. Each candidate carries the `file:line` of the plan line that introduces the export, plus the searched paths, so a confirmed reachability finding has `file:line` evidence even though the export does not exist in source yet.
4. Verify GREEN. Commit.

**Done when:**
- [test] `reachabilityCandidates` on the `projectChildOwnership` fixture returns a candidate naming the export, the introducing task id, the `file:line` of the plan line introducing it, and the searched source paths.
- [test] `reachabilityCandidates` returns no candidate when a non-test source file other than the defining file references the export, or when a task's Done-when names an existing entry point that reaches it.
- [test] `reachabilityCandidates` derives candidates from the plan's backticked exports when `parseWiringSurface` finds no `## Wiring Surface` section, without throwing.

**Files likely touched:**
- `src/conductor/src/engine/plan-review-candidates.ts` — reachability lens
- `src/conductor/test/engine/plan-review-candidates-reachability.test.ts` — new

**Dependencies:** Task 4

### Task 6: Dependency-order candidate lens and malformed-dependency refusal
**Story:** Story 3 (happy paths 1 and 2; negative paths 1 and 2)
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/plan-review-candidates-order.test.ts` covering:
   - Task 7's Done-when cites an export only Task 8 introduces, and Task 8 depends on Task 7, giving a candidate naming Task 7 and Task 8;
   - Task 12 cites a config key introduced by Task 4 with no direct or transitive dependency, giving a candidate naming Task 12 and Task 4;
   - a citation satisfied through a transitive closure gives no candidate;
   - a malformed `**Dependencies:**` line makes `dependencyOrderCandidates` throw `PlanReviewInputError` naming the task.
2. Verify RED.
3. Implement `dependencyOrderCandidates` in `plan-review-candidates.ts` using `parsePlanDependencyGraph` and `transitiveDependencies` from Task 1. An identifier is introduced by a task when it appears backticked in that task's Steps or files and in no earlier task's.
4. Verify GREEN. Commit.

**Done when:**
- [test] `dependencyOrderCandidates` returns a candidate naming Task 7 and Task 8 for the #3036 Task 7 and Task 8 fixture, and one naming Task 12 and Task 4 for the missing-dependency fixture.
- [test] `dependencyOrderCandidates` returns no candidate when the introducing task is in the citing task's `transitiveDependencies` closure.
- [test] `dependencyOrderCandidates` throws `PlanReviewInputError` naming the task for a malformed `**Dependencies:**` line or one citing an unknown task id, instead of treating the task as dependency-free.

**Files likely touched:**
- `src/conductor/src/engine/plan-review-candidates.ts` — dependency-order lens
- `src/conductor/test/engine/plan-review-candidates-order.test.ts` — new

**Dependencies:** Tasks 1, 5

### Task 7: Structural absent-artifact disposition in DECIDE entry
**Story:** Story 9 (happy path 2 foundation; negative path 4)
**Type:** infrastructure

**Steps:**
1. Write failing cases in `src/conductor/test/engine/decide-entry-policy.test.ts` with a synthetic DECIDE step declaring `absentArtifactDisposition: 'skipped'`:
   - daemon, contract present, artifact wholly absent, no grant: `fast-forward` as `skipped`;
   - daemon, artifact wholly absent, a valid in-scope grant naming the step: `enter` (the grant still wins);
   - daemon, artifact present but `satisfied === false`: `halt`;
   - non-daemon: `enter`;
   - a step without the field and the artifact absent: still `halt`.
2. Verify RED.
3. Add the optional `absentArtifactDisposition?: 'skipped'` and `absentArtifactReason?: string` to `StepDefinition` in `src/conductor/src/types/steps.ts`.
4. Add an `artifactPresent: boolean` input to `decideEntryDisposition`. The rule is placed after the operator-grant rule and immediately before the final `halt`, and returns `fast-forward` as `skipped` with `reason` set to `absentArtifactReason` (default `artifact-absent`).
5. Thread `artifactPresent` from the `Conductor.resolveDecideEntryDisposition` call sites using the step's artifact contract globs, and carry the reason onto the step's skipped record.
6. Verify GREEN, including the existing decide-entry acceptance tests unchanged. Commit.

**Done when:**
- [test] `decideEntryDisposition` returns `fast-forward` as `skipped` with the step's `absentArtifactReason` for a daemon DECIDE step declaring `absentArtifactDisposition: 'skipped'` whose artifact is wholly absent.
- [test] `decideEntryDisposition` returns `halt` for that step when its artifact is present but unsatisfied, returns `enter` when not in daemon mode, and still returns `halt` for an absent-artifact step without the field.
- [test] `decideEntryDisposition` returns `enter` for an absent-artifact step declaring the field when a valid in-scope grant names it, and every existing `src/conductor/test/acceptance/decide-entry-*.acceptance.test.ts` assertion passes.

**Files likely touched:**
- `src/conductor/src/types/steps.ts` — new optional field
- `src/conductor/src/engine/decide-entry-policy.ts` — new rule and input
- `src/conductor/src/engine/conductor.ts` — pass `artifactPresent`
- `src/conductor/test/engine/decide-entry-policy.test.ts` — new cases

**Dependencies:** none

### Task 8: Register the `plan_review` step
**Story:** Story 9 (happy paths 1, 2 and 3; negative path 4)
**Type:** infrastructure

**Steps:**
1. Write failing tests:
   - `steps.test.ts`: the order has `plan_review` immediately after `coherence_check`; 22 steps; the S-tier skippable set is 7 steps including `plan_review`.
   - `decide-entry-healthy-fast-forward.acceptance.test.ts`: daemon forward walk. An M spec with no `.docs/plan-review/` artifact fast-forwards `plan_review` as skipped. One with a clean artifact fast-forwards as done. One with a standing unaccepted blocking finding halts naming `plan_review`.
2. Verify RED.
3. Add `'plan_review'` to the `StepName` union. Add the `ALL_STEPS` entry after `coherence_check`: `{name:'plan_review', label:'Plan Review', phase:'DECIDE', enforcement:'gating', prerequisites:['coherence_check'], skippableForTiers:['S'], isCheckpoint:false, skillName:'plan-review', absentArtifactDisposition:'skipped', absentArtifactReason:'landed-before-plan-review'}`.
4. Add the artifact contract `{pattern:'.docs/plan-review/*.md', scope:'feature', identity:{strategy:'plan-stem'}}`.
5. Add a `CUSTOM_COMPLETION_PREDICATES.plan_review` that is done only when `parsePlanReviewArtifact` is valid and no blocking finding is unresolved or unaccepted.
6. Add entries to `CLAUDE_STEP_MODELS`, `CODEX_STEP_MODELS`, `STEP_EFFORTS`, `STEP_RATIONALE`, `DEFAULT_STEP_RETRIES`, `DEFAULT_STEP_REVIEW`, and `STEP_SKILL_INVOCATIONS` (kind `skill`, `plan-review`). Set `DEFAULT_STEP_RETRIES.plan_review` to 0, so a blocking round 1 never auto-dispatches round 2 before the author edits.
7. Regenerate the `ARCHITECTURE.md` model-selection table with `src/conductor/src/tools/generate-model-table.ts`.
8. Update the pinned step lists:
   - `steps-declaration-invariance.test.ts`
   - `artifacts.test.ts` expected map
   - `skill-invocation.test.ts` `EXPECTED_INVOCATIONS`
   - `provider-model-policy.test.ts`
   - `provider-aware-model-resolution.acceptance.test.ts`
   - `resolved-config.test.ts`
   - `model-table-metadata.test.ts`
   - `step-runners.test.ts` Codex prompt case list
   - `conductor-feature-applicability.test.ts`
   - `conductor-step-events.test.ts`
   - `operator-park-boundary` tests
   - the five `test/fixtures/n1-golden/*-conduct-state.golden` files
9. Verify GREEN. Commit.

**Done when:**
- [test] `ALL_STEPS` lists `plan_review` immediately after `coherence_check`, `getSkippableSteps('S')` contains `plan_review`, and the S-tier skippable set test pins exactly 7 steps.
- [test] The daemon forward walk in `decide-entry-healthy-fast-forward.acceptance.test.ts` fast-forwards `plan_review` as skipped with reason `landed-before-plan-review` for an M spec with no review artifact and lets the build proceed.
- [test] The same forward walk fast-forwards `plan_review` as done for a clean review artifact and halts naming `plan_review` when the artifact has a standing unaccepted blocking finding.
- The `ARCHITECTURE.md` generated model-selection table contains a `plan_review` row and `generate-model-table.test.ts` passes.

**Files likely touched:**
- `src/conductor/src/types/steps.ts`; `src/conductor/src/engine/steps.ts`; `src/conductor/src/engine/artifacts.ts`; `src/conductor/src/engine/provider-model-policy-defaults.ts`; `src/conductor/src/engine/model-table-metadata.ts`; `src/conductor/src/engine/resolved-config.ts`; `src/conductor/src/engine/skill-invocation.ts`; `ARCHITECTURE.md`
- `src/conductor/test/engine/steps.test.ts`; `src/conductor/test/engine/steps-declaration-invariance.test.ts`; `src/conductor/test/engine/artifacts.test.ts`; `src/conductor/test/engine/skill-invocation.test.ts`; `src/conductor/test/engine/provider-model-policy.test.ts`; `src/conductor/test/acceptance/provider-aware-model-resolution.acceptance.test.ts`; `src/conductor/test/engine/resolved-config.test.ts`; `src/conductor/test/model-table-metadata.test.ts`; `src/conductor/test/engine/step-runners.test.ts`; `src/conductor/test/engine/conductor-feature-applicability.test.ts`; `src/conductor/test/engine/conductor-step-events.test.ts`; `src/conductor/test/engine/operator-park-boundary.test.ts`; `src/conductor/test/acceptance/operator-park-boundary.acceptance.test.ts`; `src/conductor/test/acceptance/decide-entry-healthy-fast-forward.acceptance.test.ts`; `src/conductor/test/acceptance/decide-entry-forward-walk.acceptance.test.ts`; `src/conductor/test/acceptance/decide-entry-resume-clamp.acceptance.test.ts`; `src/conductor/test/acceptance/decide-entry-fixture.ts`; `src/conductor/test/fixtures/n1-golden/flag-off-unsliced-conduct-state.golden`; `src/conductor/test/fixtures/n1-golden/flag-off-sliced-conduct-state.golden`; `src/conductor/test/fixtures/n1-golden/flag-on-ineligible-conduct-state.golden`; `src/conductor/test/fixtures/n1-golden/flag-on-unsliced-conduct-state.golden`; `src/conductor/test/fixtures/n1-golden/flag-on-single-slice-conduct-state.golden`; the five `src/conductor/test/fixtures/n1-golden/*-events.golden` files (step indexes shift); `src/conductor/test/engine/n1-golden-state.test.ts`; `src/conductor/test/integration/config-flow.test.ts` (custom-step offset `customIdx + 3` becomes `+ 4`); `src/conductor/test/engine/selector.test.ts` (fixtures gain `plan_review: 'done'`)

**Dependencies:** Tasks 3, 7, 18

### Task 9: Plan-review event variants
**Story:** Story 11 (foundation for happy paths 1, 2 and 3)
**Type:** infrastructure

**Steps:**
1. Write failing tests. `event-sinks.test.ts` `PINNED_PERSISTED_EVENT_TYPES` includes `plan_review_dispatched`, `plan_review_completed` and `plan_review_finding_accepted`. `audit-trail-completeness.integration.test.ts` classifies and fixtures each one.
2. Verify RED.
3. Add the three variants to `ConductorEventBody` in `src/conductor/src/types/events.ts`:
   - dispatched: round, reviewerProvider, independence;
   - completed: those fields plus blocking, significant and advisory counts;
   - finding_accepted: findingId and reason.
4. Register them in `EVENT_SINKS` with persist enabled.
5. Verify GREEN. Commit.

**Done when:**
- [test] `EVENT_SINKS` declares `plan_review_dispatched`, `plan_review_completed`, and `plan_review_finding_accepted` as persisted, and `PINNED_PERSISTED_EVENT_TYPES` pins all three.
- [test] `audit-trail-completeness.integration.test.ts` classifies and fixtures all three variants, and `plan_review_completed` carries round, reviewer provider, independence, and finding counts by severity.

**Files likely touched:**
- `src/conductor/src/types/events.ts`; `src/conductor/src/engine/event-sinks.ts`
- `src/conductor/test/engine/event-sinks.test.ts`; `src/conductor/test/integration/audit-trail-completeness.integration.test.ts`

**Dependencies:** none

### Task 10: Compose launcher exports the authoring provider
**Story:** Story 6 (Done When: launcher exports the variable)
**Type:** happy-path

**Steps:**
1. Write a failing test in `src/conductor/test/engine/engineer/engineer-cli-launch-host.test.ts`. When `ai-conductor compose` launches the claude host, the `spawnHost` dependency receives an env whose `AI_CONDUCTOR_AUTHORING_PROVIDER` is `claude`. With `--provider codex` it is `codex`. Other inherited env keys are preserved.
2. Verify RED.
3. Extend the `spawnHost` call and `spawnInteractiveHost(executable, argv, cwd, env)` in `src/conductor/src/engine/engineer-cli.ts` to pass `{...process.env, AI_CONDUCTOR_AUTHORING_PROVIDER: host.id}`.
4. Update `src/conductor/test/cli-engineer.test.ts` for the new argument.
5. Verify GREEN. Commit.

**Done when:**
- [test] Launching `ai-conductor compose` with the claude host passes `AI_CONDUCTOR_AUTHORING_PROVIDER=claude` to the spawned session env, and with `--provider codex` passes `codex`, as asserted on the `spawnHost` dependency.
- [test] The spawned env still carries the caller's inherited environment keys.

**Files likely touched:**
- `src/conductor/src/engine/engineer-cli.ts` — spawn env
- `src/conductor/test/engine/engineer/engineer-cli-launch-host.test.ts`; `src/conductor/test/cli-engineer.test.ts`

**Dependencies:** none

### Task 11: Authoring-host resolution and reviewer provider ordering
**Story:** Story 6 (happy paths 1, 2 and 3; negative paths 1, 2 and 3)
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/plan-review-provider.test.ts`.
   - For `resolveAuthoringHost(env)`:
     - `AI_CONDUCTOR_AUTHORING_PROVIDER` wins;
     - otherwise a `CLAUDECODE` or `CODEX_THREAD_ID` marker from `BUILT_IN_PROVIDERS` session markers;
     - otherwise `unknown`.
   - For `orderReviewerCandidates({ config, host })`:
     - claude host with `[codex, claude, pi]` configured gives codex first, then pi, then claude last;
     - `steps.plan_review.llm_provider: pi` gives pi first regardless of host;
     - only the host provider configured gives host only;
     - an `unknown` host gives the configured order.
   - For `classifyIndependence(host, used)`:
     - a provider different from the host gives `cross-provider`;
     - the same provider gives `same-provider`;
     - an unknown host gives `unknown-host`.
2. Verify RED.
3. Implement `src/conductor/src/engine/plan-review-provider.ts`.
4. Verify GREEN. Commit.

**Done when:**
- [test] `resolveAuthoringHost` returns the `AI_CONDUCTOR_AUTHORING_PROVIDER` value when set, else the provider whose catalog session marker is present, else `unknown`.
- [test] `orderReviewerCandidates` puts every configured non-host provider before the host provider, honors `steps.plan_review.llm_provider` first for every authoring host, and returns the configured order for an `unknown` host.
- [test] `classifyIndependence` returns `cross-provider`, `same-provider`, or `unknown-host` for the three host/reviewer combinations.

**Files likely touched:**
- `src/conductor/src/engine/plan-review-provider.ts` — new
- `src/conductor/test/engine/plan-review-provider.test.ts` — new

**Dependencies:** Task 8

### Task 12: Round-1 reviewer dispatch and artifact write
**Story:** Story 1; Story 2; Story 4; Story 5; Story 6 (dispatch, validation, fallback and read-only criteria)
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/plan-review-runner.test.ts`, using a fake `providerExecutor` and temp worktree fixtures, for `runPlanReview({ worktreePath, planStem, config, runtimes, sessions, env, emit })`:
   - Inputs:
     - The dispatch receives `readOnlyReview: true`, `interactive: false`, the native schema and `cwd` set to the worktree.
     - Its prompt holds the stories, every task verbatim, in-scope ADR `## Decision` sections, the coherence artifact and candidate rows, plus the `plan-review` skill invocation.
   - Provider selection:
     - Candidates follow `orderReviewerCandidates`.
     - When the first provider fails, the runner falls through to the next and records `same-provider` when that is the host.
     - A schema-invalid response falls through and leaves round count 1 for the eventual valid response.
   - Findings:
     - Only validated reviewer findings are written. A candidate the reviewer omits is not written.
     - A malformed Dependencies line refuses before dispatch with the `PlanReviewInputError` message.
   - After the run:
     - The worktree is byte-identical apart from `.docs/plan-review/<stem>.md`.
     - `plan_review_dispatched` and `plan_review_completed` are emitted.
2. Verify RED.
3. Implement `src/conductor/src/engine/plan-review-runner.ts`:
   - Call the Task 4–6 lenses and assemble the prompt.
   - Own the provider fall-through in the runner. `executeProviderCandidates` advances only on run-wide provider unavailability (verified: `engine/provider-execution.ts`, the `!candidateUnavailable` early return), not on an ordinary failure or a schema-invalid success. So iterate `orderReviewerCandidates` yourself: call `executeProviderCandidates` with step `plan_review` and `configuredProviders` set to that single provider, validate the result with `validatePlanReviewResult`. Only a failed dispatch, or a response that fails the schema as a whole, moves on to the next provider. An individual finding that fails its evidence rule is dropped, not written, and reported in the command output; it does not trigger fall-through.
   - Pass `nativeSchemaScratch: { worktreeRoot, repository, featureSlug }` on every call, the way `executeProviderAwareOneShotCore` does in `engine/step-runners.ts`. The codex adapter refuses a native-schema request with no owned scratch home (`execution/codex-provider.ts`, "requested native schema requires an owned … scratch home").
   - Write the artifact with `renderPlanReviewArtifact` and `computeReviewedDigest`.
   - Print a one-line notice when independence is not `cross-provider`.
4. Verify GREEN. Commit.

**Done when:**
- [test] On the success path `runPlanReview` makes one counted reviewer dispatch, in a fresh session, on the first provider of `orderReviewerCandidates` (pi when `steps.plan_review.llm_provider` is pi, whatever the authoring host) with `readOnlyReview: true` and the plan-review native schema, with `nativeSchemaScratch` set and `configuredProviders` holding only that provider, and its prompt contains every plan task, the stories, the in-scope ADR decisions, and the candidate rows.
- [test] `runPlanReview` writes only reviewer findings that pass `validatePlanReviewResult` to `.docs/plan-review/<stem>.md`, so a rejected finding is not written and a candidate the reviewer did not report never appears as a finding.
- [test] When only the host provider is configured, or the first candidate provider fails or returns a schema-invalid response, `runPlanReview` dispatches the next provider in a fresh session, records `same-provider` with a one-line notice when that provider is the host, records `unknown-host` when `resolveAuthoringHost` returns `unknown`, and the artifact's round count stays 1.
- [test] After `runPlanReview` the worktree differs only by the review artifact, and `plan_review_dispatched` and `plan_review_completed` were emitted with round, reviewer provider, independence, and finding counts by severity.
- [test] Each built-in provider adapter's argument builder turns `readOnlyReview: true` into its read-only mode (claude read-only policy args without `--dangerously-skip-permissions`, codex `sandbox_mode="read-only"`, pi read-only tool list), so a reviewer write is refused and no worktree file has changed when the dispatch returns.

**Files likely touched:**
- `src/conductor/src/engine/plan-review-runner.ts` — new
- `src/conductor/test/engine/plan-review-runner.test.ts` — new

**Dependencies:** Tasks 2, 3, 6, 9, 11

### Task 13: Round-2 re-check and hard bound
**Story:** Story 7 (happy path 1; negative path 1)
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/plan-review-runner-bound.test.ts`.
   - A second `runPlanReview` after a round 1 with blocking findings and a changed task dispatches with only the changed tasks (by `planTaskDigests`), changed stories and changed ADR decisions, plus the prior blocking and significant findings.
   - It records each prior finding as resolved or standing, and the artifact round count becomes 2.
   - A third invocation dispatches nothing, exits non-zero with "bound reached", and lists each standing blocking finding's id and summary.
2. Verify RED.
3. Implement round tracking in `plan-review-runner.ts`.
4. Verify GREEN. Commit.

**Done when:**
- [test] A round-2 `runPlanReview` prompt contains only the tasks, stories, and ADR decisions whose digests changed since round 1 plus every prior blocking and significant finding, and the artifact marks each prior finding resolved or standing with round count 2.
- [test] A third `runPlanReview` invocation makes zero provider dispatches and reports that the bound is reached, listing each standing blocking finding's id and summary.

**Files likely touched:**
- `src/conductor/src/engine/plan-review-runner.ts` — rounds
- `src/conductor/test/engine/plan-review-runner-bound.test.ts` — new

**Dependencies:** Task 12

### Task 14: Operator accept and acknowledge actions
**Story:** Story 7 (happy path 2; negative paths 2 and 4); Story 11 (happy path 3)
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/plan-review-operator-actions.test.ts`:
   - `acceptPlanReviewFinding({ findingId, reason })` records the acceptance with its reason, so the finding no longer counts as blocking, and emits `plan_review_finding_accepted` naming the id.
   - An empty reason or unknown id refuses with a message naming the problem and leaves the artifact bytes unchanged.
   - `acknowledgePlanReviewChanges({ reason })` re-stamps the reviewed digest over the current plan, stories and ADRs with zero dispatches.
2. Verify RED.
3. Implement both functions in `plan-review-runner.ts`.
4. Verify GREEN. Commit.

**Done when:**
- [test] `acceptPlanReviewFinding` records the acceptance and reason in the artifact so the finding no longer blocks, and emits `plan_review_finding_accepted` naming the finding id.
- [test] `acceptPlanReviewFinding` with an empty reason or an unknown finding id refuses with a message naming the problem and leaves the artifact byte-for-byte unchanged.
- [test] `acknowledgePlanReviewChanges` makes zero provider dispatches and re-stamps the artifact's reviewed digest to `computeReviewedDigest` of the current plan, stories, and in-scope ADRs.
- [test] `acceptPlanReviewFinding` and `acknowledgePlanReviewChanges` refuse while fewer than two review rounds have run, naming the remaining round, and leave the artifact unchanged.

**Files likely touched:**
- `src/conductor/src/engine/plan-review-runner.ts` — operator actions
- `src/conductor/test/engine/plan-review-operator-actions.test.ts` — new

**Dependencies:** Task 13

### Task 15: `ai-conductor compose plan-review` subcommand
**Story:** Story 6 (happy path 1); Story 7 (happy path 3); Story 11 (happy path 1; negative paths 1 and 2)
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/engineer/engineer-cli-plan-review.test.ts`:
   - Parsing: `compose plan-review --project <n> --worktree <p> [--source-ref <r>] [--accept <id> --reason <t>] [--acknowledge --reason <t>]` parses to `{kind:'plan-review', …}`.
   - Unknown flags reject. `ENGINEER_SUBCOMMANDS`, `SUBCOMMAND_HELP` and the commander mirror in `src/conductor/src/cli.ts` list it.
   - Through the dispatcher with `AI_CONDUCTOR_AUTHORING_PROVIDER=claude` and codex configured, the fake executor is called with codex first. The written artifact records claude, codex and cross-provider.
   - Events are appended to `<canonical>/.pipeline/composer-events.jsonl`.
   - A clean round 1 exits 0 printing "plan review clean" with no prompt.
   - A failing event write still leaves the artifact written and reports the event-write failure.
2. Verify RED.
3. Implement the handler in `src/conductor/src/engine/engineer-cli.ts`. Build the built-in provider runtimes with `new PluginRegistry()`, `registerBuiltInLlmProviders` (Task 24), `markInitialized()`, `createProviderRuntimeSet` and `ProviderSessionStore` (from `engine/provider-session.ts`), but do NOT import `engine/plugin-loader.ts` (`discoverPlugins`): it would pull `engine/finish-publication.ts` and about 40 more modules into the engineer import closure that `src/conductor/test/engine/engineer/non-autonomy.test.ts` polices. Never import `engine/conductor.ts`, `engine/step-runners.ts` or `engine/daemon-runner.ts` from the compose path. plus the `ConductorEventEmitter` and `EventPersister` pattern used by the land handler. Then call `runPlanReview`, `acceptPlanReviewFinding` or `acknowledgePlanReviewChanges`.
4. Update `subcommandArgs` in `src/conductor/test/cli-engineer.test.ts` and the help-sync and CLI subtree tests.
5. Verify GREEN. Commit.

**Done when:**
- [test] `ai-conductor compose plan-review --project <n> --worktree <p>` with `AI_CONDUCTOR_AUTHORING_PROVIDER=claude` and codex configured dispatches the reviewer on codex and writes an artifact recording authoring host claude, reviewer provider codex, and independence cross-provider.
- [test] The subcommand appends `plan_review_dispatched` (round, reviewer provider, independence) and `plan_review_completed` (those fields plus finding counts by severity) to `.pipeline/composer-events.jsonl`, and when that write fails it still writes the review artifact and reports the event-write failure.
- [test] A clean round 1 exits 0 with no operator prompt, and the worktree's changed and untracked files after the run are only the review artifact.
- [test] `ENGINEER_SUBCOMMANDS`, `SUBCOMMAND_HELP`, and the `src/conductor/src/cli.ts` engineer subtree list `plan-review`, and an unknown flag is rejected.
- [test] `non-autonomy.test.ts` passes with the engineer import closure containing no `engine/plugin-loader.ts`, `engine/conductor.ts`, `engine/step-runners.ts`, `engine/daemon-runner.ts`, or push-capable finish module.

**Files likely touched:**
- `src/conductor/src/engine/engineer-cli.ts`; `src/conductor/src/cli.ts`
- `src/conductor/test/engine/engineer/engineer-cli-plan-review.test.ts` — new; `src/conductor/test/cli-engineer.test.ts`; `src/conductor/test/engine/engineer/engineer-cli-help.test.ts`; `src/conductor/test/cli/index.test.ts`; `src/conductor/test/engine/engineer/non-autonomy.test.ts`

**Dependencies:** Tasks 10, 14, 24

### Task 16: `plan_review` step runner under interactive conduct
**Story:** Story 9 (negative path 1); Story 11 (happy path 2)
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/step-runners-plan-review.test.ts`. An interactive (non-daemon) conduct forward walk of an M spec with no review artifact reaches `plan_review` and runs `runPlanReview` through the step runner. It does not skip. The three event variants are persisted to that run's `.pipeline/events.jsonl` through the runner's emitter.
2. Verify RED.
3. Add the `plan_review` branch to `runDispatch` in `src/conductor/src/engine/step-runners.ts`. It calls `runPlanReview` with the runner's `providerRuntimes`, sessions and emitter. Per the plan-slices boundary test, the branch must not reference `validatePlanSlices`.
4. Verify GREEN. Commit.

**Done when:**
- [test] An interactive conduct forward walk of an M spec without a review artifact dispatches `plan_review` through `runDispatch` and calls `runPlanReview` rather than fast-forwarding it.
- [test] That run persists `plan_review_dispatched` and `plan_review_completed` to its `.pipeline/events.jsonl`.

**Files likely touched:**
- `src/conductor/src/engine/step-runners.ts` — `plan_review` branch
- `src/conductor/test/engine/step-runners-plan-review.test.ts` — new

**Dependencies:** Tasks 8, 12

### Task 17: Plan-review land rung
**Story:** Story 8 (happy paths 1 and 2; negative paths 1, 2, 3 and 4); Story 9 (happy path 1; negative paths 2 and 3); Story 10 (negative path 2)
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/engineer/land-spec-plan-review.test.ts` through `landSpec` on temp worktrees. Cases:
   - M spec, current clean artifact: lands, and the artifact is in the landed commit.
   - Standing blocking finding: refuses with gate id `plan-review`, naming each finding's id, reference and summary.
   - No artifact (including a spec authored before this feature): refuses stating plan review has not run.
   - Plan edited after the final round with no acknowledgement: refuses naming the changed artifact.
   - Unparseable or integrity-mismatched artifact: refuses.
   - S spec, with or without an artifact: lands, and the rung neither requires nor evaluates it.
   - A provider executor spy: zero invocations.
2. Verify RED.
3. Implement `runPlanReviewGate` in `src/conductor/src/engine/engineer/plan-review-gate.ts`, with no provider imports.
3a. Existing M/L land-success fixtures have no review artifact, so they will fail the new rung (verified by source review). Add a shared fixture helper, `writePlanReviewArtifact(worktree, planStem)`, that renders a clean, current artifact. Call it in every M/L success path of `land-spec-applicability.test.ts`, `land-spec-stacked-delivery.test.ts`, `land-spec.test.ts`, `engineer-agent-hosted.test.ts` (`writeDecideExtras`) and `decide-artifact-coherence-check.acceptance.test.ts`. Its legacy M-tier land-success case now expects the plan-review refusal, because the rung has no legacy disengagement.
4. Add `'plan-review'` to `LandGateIdentifier`. Call the gate in `landSpec` after the coherence gate (section 4e2), wrapped as `landGateError('plan-review', …)`. It engages only when the tier is not S, with no legacy disengagement.
5. Register `plan_review` in `validateFeatureArtifactStems` and the `resolveFeatureFiles` families.
6. Verify GREEN. Commit.

**Done when:**
- [test] `landSpec` lands an M spec whose review artifact matches `computeReviewedDigest` and has no unresolved blocking finding, regardless of the recorded independence value, and the landed commit contains `.docs/plan-review/<stem>.md`.
- [test] `landSpec` refuses an M spec with gate `plan-review` when the artifact is missing (stating that plan review has not run, including for a spec authored before this feature), unparseable, integrity-mismatched, digest-stale without acknowledgement (naming the changed artifact), or carries a standing blocking finding (naming each finding's id, reference, and summary).
- [test] `landSpec` on an S spec neither requires nor evaluates a review artifact, whether or not one exists.
- [test] A provider executor spy records zero invocations across every `runPlanReviewGate` case, and `plan-review-gate.ts` imports no provider module.
- [test] The existing M/L land-success cases in `land-spec.test.ts`, `land-spec-applicability.test.ts`, `land-spec-stacked-delivery.test.ts`, `engineer-agent-hosted.test.ts`, and `decide-artifact-coherence-check.acceptance.test.ts` pass using `writePlanReviewArtifact`, and that file's legacy M-tier case expects the `plan-review` refusal.

**Files likely touched:**
- `src/conductor/src/engine/engineer/plan-review-gate.ts` — new
- `src/conductor/src/engine/engineer/land-spec.ts` — rung, gate id, stem families
- `src/conductor/test/engine/engineer/land-spec-plan-review.test.ts` — new; `src/conductor/test/engine/engineer/plan-review-artifact-fixture.ts` — new helper
- `src/conductor/test/engine/engineer/land-spec-applicability.test.ts`; `src/conductor/test/engine/engineer/land-spec-stacked-delivery.test.ts`; `src/conductor/test/engine/engineer/land-spec.test.ts`; `src/conductor/test/acceptance/engineer-agent-hosted.test.ts`; `src/conductor/test/acceptance/decide-artifact-coherence-check.acceptance.test.ts`

**Dependencies:** Tasks 3, 8

### Task 18: `skills/plan-review` reviewer brief
**Story:** Story 5 (Done When: brief lenses); Story 1; Story 2; Story 3 (reviewer rulings on candidates)
**Type:** happy-path

**Steps:**
1. Write a failing contract test in `src/conductor/test/engine/plan-review-skill-contract.test.ts`. `skills/plan-review/SKILL.md` has frontmatter `name`, `description`, `enforcement` and `phase`, plus `disable-model-invocation: true`. Its body enumerates:
   - the test-impact, reachability, dependency-order and feasibility lenses;
   - the static contradiction, oscillation, task-versus-task, preserved-behavior and criterion-conflict lenses;
   - ADR-versus-story as a cross-layer pair;
   - the both-directions task question, and that pairs with nothing shared need no finding;
   - the rule that a merely uncovered criterion is not a contradiction;
   - the rule that an ungrounded suspicion is advisory at most;
   - a verification item for the task-versus-task sweep;
   - the shared layer-ownership statement (story versus story to `/conflict-check`; cross-layer and task versus task to plan review at Medium and Large tier and to the plan's §7b at Small tier);
   - the read-only rule.
2. Update `plan-interference-check-skill-contract.test.ts` so the task-versus-task skill set is `['coherence-check','conflict-check','plan-review']`.
3. Verify RED.
4. Author `skills/plan-review/SKILL.md` and `skills/plan-review/agents/openai.yaml` (`allow_implicit_invocation: false`).
5. Run `test/test_harness_integrity.sh` §2 and §4 targeted checks. Verify GREEN. Commit.

**Done when:**
- [test] `plan-review-skill-contract.test.ts` finds every enumerated lens, the both-directions task question, the directive to record a feasibility finding citing the source `file:line` when a planned input differs from what production passes, the directive that a merely uncovered criterion yields no contradiction finding, the advisory-at-most rule for ungrounded suspicions, the task-versus-task verification item, and the shared layer-ownership statement in `skills/plan-review/SKILL.md`.
- `test/check_skill_invocation_policy.sh` and the frontmatter checks of `test/test_harness_integrity.sh` pass with the new skill directory.
- [test] `plan-interference-check-skill-contract.test.ts` expects `plan-review` in its task-versus-task skill set and passes.

**Files likely touched:**
- `skills/plan-review/SKILL.md` — new; `skills/plan-review/agents/openai.yaml` — new
- `src/conductor/test/engine/plan-review-skill-contract.test.ts` — new; `src/conductor/test/engine/plan-interference-check-skill-contract.test.ts`

**Dependencies:** none

### Task 19: Retire coherence-check §4a re-run and §4d; align layer ownership
**Story:** Story 10 (happy path 3; Done When); Story 5 (contradiction ownership)
**Type:** refactor

**Steps:**
1. Update the skill-contract tests first (RED against the current text):
   - `coherence-check-task-sweep-skill-contract.test.ts`: coherence-check has no task-versus-task sweep, no §4d heading, and no §4a paragraph re-running the plan §7a judge. Its §4b `covered` definition and §4e FR tie-out do not reference §4d. The verdict vocabulary is still exactly `covered`, `gap` and `fail`.
   - `conflict-check-layer-ownership-skill-contract.test.ts`: the `**Layer ownership.**` paragraph in conflict-check, coherence-check and plan-review names plan review for cross-layer and task versus task at Medium and Large, and the plan's §7b at Small.
2. Edit `skills/coherence-check/SKILL.md`. Remove the §4a re-run paragraph and §4d. Repoint §4b and §4e. Keep a `**Layer ownership.**` paragraph with the shared statement. Renumber nothing that integrity §7 would flag as a duplicate.
3. Edit `skills/conflict-check/SKILL.md`'s ownership paragraph to the shared statement.
4. In `plan-interference-check-skill-contract.test.ts`, keep the mentioning-skill set `['coherence-check','conflict-check','plan-review']`. Coherence-check still mentions task versus task in its retained `**Layer ownership.**` paragraph, and that test's discovery (lines 51–56) matches any mention. Move its coherence-check sweep assertion and its conflict-check ownership assertion (the `Task-versus-task … checked in both directions` match on coherence-check and the `task↔task … /coherence-check` match on conflict-check) so that they target plan-review and the plan-review owner instead.
5. Verify GREEN. Commit.

**Done when:**
- [test] `coherence-check-task-sweep-skill-contract.test.ts` asserts `skills/coherence-check/SKILL.md` contains no §4d section, no §4a paragraph re-running the plan §7a coverage judge, no contradiction, oscillation, or criterion-conflict sweep instruction, and no `covered` or FR tie-out reference to §4d, while keeping the `adr` row class and the §4f ADR tie-out, with verdicts exactly `covered`, `gap`, `fail`.
- [test] `conflict-check-layer-ownership-skill-contract.test.ts` asserts conflict-check, coherence-check, and plan-review carry the same layer-ownership statement naming conflict-check for story versus story, plan review at Medium and Large and plan §7b at Small for cross-layer and task versus task.
- [test] `plan-interference-check-skill-contract.test.ts` passes with the mentioning-skill set `['coherence-check','conflict-check','plan-review']` and its sweep assertion targeting plan-review rather than coherence-check.

**Files likely touched:**
- `skills/coherence-check/SKILL.md`; `skills/conflict-check/SKILL.md`
- `src/conductor/test/engine/coherence-check-task-sweep-skill-contract.test.ts`; `src/conductor/test/engine/conflict-check-layer-ownership-skill-contract.test.ts`; `src/conductor/test/engine/plan-interference-check-skill-contract.test.ts`

**Dependencies:** Task 18

### Task 20: Restrict plan §7b to Small tier and point M/L to plan review
**Story:** Story 10 (happy paths 1 and 2; Done When)
**Type:** refactor

**Steps:**
1. Write a failing contract test in `src/conductor/test/engine/plan-contradiction-tier-skill-contract.test.ts`:
   - §7b's gate applies only at tier S;
   - §7b's inputs, conflict rule and three-round limit text are unchanged;
   - the sentence saying coherence-check repeats §7b is gone, and §7a no longer says coherence-check repeats it;
   - §7 names plan review as the Medium and Large contradiction owner.
2. Update `plan-interference-check-skill-contract.test.ts`'s `nonInterferenceItem` regex, and its plan-skill assertion that matches `/coherence-check … Medium and Large`, so both point to plan review at Medium and Large, with Small gaining no required step.
3. Verify RED.
4. Edit `skills/plan/SKILL.md`, both Verification sections included.
5. Verify GREEN. Commit.

**Done when:**
- [test] `plan-contradiction-tier-skill-contract.test.ts` asserts `skills/plan/SKILL.md` §7b gates only tier S with unchanged inputs, conflict rule, and three-round limit, and names plan review as the Medium and Large contradiction owner.
- [test] `plan-contradiction-tier-skill-contract.test.ts` asserts §7a dispatches the coverage judge at every tier and no sentence says `coherence-check` repeats §7a or §7b.
- [test] `plan-interference-check-skill-contract.test.ts` finds in both plan Verification sections a non-interference item pointing to plan review at Medium and Large tier.

**Files likely touched:**
- `skills/plan/SKILL.md`
- `src/conductor/test/engine/plan-contradiction-tier-skill-contract.test.ts` — new; `src/conductor/test/engine/plan-interference-check-skill-contract.test.ts`

**Dependencies:** Task 19

### Task 21: Composer, conduct and HARNESS DECIDE sequence call plan review
**Story:** Story 9 (happy path 1 sequence); Story 6 (happy path 1 entry point)
**Type:** happy-path

**Steps:**
1. Extend the failing check in `test/test_provider_skill_contracts.sh` (the composer DECIDE list) to require `ai-conductor compose plan-review` after `/coherence-check` in `skills/composer/SKILL.md`.
2. Add a check that `skills/conduct/SKILL.md` lists a plan-review step after Step 10b.
3. Verify RED.
4. Edit `skills/composer/SKILL.md` step 3 to add item 10: Medium and Large only, run `ai-conductor compose plan-review --project <name> --worktree <worktreePath> [--source-ref <ref>]`, resolve or `--accept` blocking findings, `--acknowledge` post-bound edits.
5. Edit `skills/conduct/SKILL.md`, and the DECIDE row in `HARNESS.md` to read `… → coherence-check → plan-review (M/L only, skipped for S)`.
6. Verify GREEN. Commit.

**Done when:**
- `test/test_provider_skill_contracts.sh` passes while asserting `skills/composer/SKILL.md` runs `ai-conductor compose plan-review` after `/coherence-check` for Medium and Large specs.
- `test/test_provider_skill_contracts.sh` passes while asserting `skills/conduct/SKILL.md` lists the plan-review step after coherence-check.
- The `HARNESS.md` DECIDE sequence row lists plan-review after coherence-check, marked M/L only.

**Files likely touched:**
- `skills/composer/SKILL.md`; `skills/conduct/SKILL.md`; `HARNESS.md`; `test/test_provider_skill_contracts.sh`

**Dependencies:** Task 15

### Task 22: Coherence land gate accepts artifacts without contradiction rows
**Story:** Story 10 (negative path 1)
**Type:** verification

**Steps:**
1. Confirm with an existing or added focused case in the coherence-validator tests that `runCoherenceGate` accepts an M-tier coherence artifact whose rows are all `covered` and carry no `CONTRADICTS:` notes. Existing coverage may satisfy this.
2. If no existing case covers it, add the case.
3. Commit with an `Evidence:` trailer.

**Done when:**
- [test] `runCoherenceGate` accepts an M-tier coherence artifact with only `covered` rows and no `CONTRADICTS:` notes or contradiction-derived fail rows.
- [test] `runCoherenceGate` reports no gap id for that artifact, so no coherence waiver is needed to land it.

**Files likely touched:**
- `src/conductor/test/engine/engineer/coherence-validator.test.ts`

**Verify-only:** yes

**Dependencies:** none

### Task 23: Lens findings and reviewer rulings flow end to end through `runPlanReview`
**Story:** Story 1 (happy paths 1 and 2; negative path 2); Story 2 (happy paths 1 and 2; negative path 1); Story 3 (happy paths 1 and 2; negative paths 1 and 2); Story 5 (happy paths 1, 2 and 3)
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/plan-review-runner-lenses.test.ts`, reusing the Task 4–6 fixtures. Use a fake reviewer that confirms every supplied candidate as a finding of the same lens, and that returns nothing when given no candidates.
2. Assert that the artifact carries the confirmed findings for the #3036 test-impact, reachability and dependency-order fixtures. Assert that the no-candidate fixtures produce no finding of their lens.
3. Assert that an unknown-id Dependencies line refuses before dispatch.
4. Use a second fake reviewer that returns a feasibility finding citing a source `file:line`, an ADR contradiction finding, and a task-versus-task contradiction finding. Assert that each is written with its fields intact.
5. Verify RED; wire any gap in `plan-review-runner.ts`; verify GREEN; commit.

**Done when:**
- [test] With a reviewer confirming every candidate, `runPlanReview` on the #3036 fixtures writes a test-impact finding naming the test file's `file:line` and the task id, a reachability finding naming the export, the introducing task id, the `file:line` of the plan line introducing it, and the searched source paths, and dependency-order findings naming Task 7 and Task 8 and naming Task 12 and Task 4.
- [test] For the fixtures where a task lists the test, the export is wired, a Wiring Surface item already has a caller, or the citation is inside the transitive closure, the artifact records no test-impact, reachability, or dependency-order finding respectively.
- [test] On a worktree with no test files, `runPlanReview` completes and writes an artifact with zero test-impact findings.
- [test] A plan whose `**Dependencies:**` line cites an unknown task id makes `runPlanReview` refuse before any dispatch with a message naming the task and its Dependencies line.
- [test] A reviewer-returned feasibility finding citing a source `file:line`, a contradiction finding citing a story criterion with a task and both quoted passages, a contradiction finding citing `<adr-stem>#D<n>` and a task with both quoted passages, and a task-versus-task contradiction naming both tasks with both Done-when passages are each written to the artifact with those fields intact.

**Files likely touched:**
- `src/conductor/src/engine/plan-review-runner.ts` — wiring fixes only if needed
- `src/conductor/test/engine/plan-review-runner-lenses.test.ts` — new

**Dependencies:** Task 12

### Task 24: Shared built-in LLM provider registration
**Story:** Story 6 (foundation for happy path 1)
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/builtin-llm-providers.test.ts`.
   - `registerBuiltInLlmProviders(registry, { installed, codexDoctorTimeoutMs })` registers one `llm_provider` per installed `BUILT_IN_PROVIDERS` entry.
   - A `createProviderRuntimeSet` built over the registry after `markInitialized()` lists those providers.
   - Its module's import closure excludes `engine/plugin-loader.ts` and `engine/finish-publication.ts`.
2. Verify RED.
3. Extract the built-in `llm_provider` loop from `registerBuiltins` in `src/conductor/src/engine/plugin-loader.ts` into new `src/conductor/src/engine/builtin-llm-providers.ts`, and have `registerBuiltins` call it. The compose handler (Task 15) is its second production caller.
4. Verify GREEN, including existing plugin-loader tests unchanged. Commit.

**Done when:**
- [test] `registerBuiltInLlmProviders` registers an `llm_provider` for each installed built-in provider, and `createProviderRuntimeSet` over that initialized registry lists them.
- [test] `registerBuiltins` in `plugin-loader.ts` delegates to `registerBuiltInLlmProviders`, and the existing plugin-loader tests pass.
- [test] The import closure of `builtin-llm-providers.ts` contains neither `engine/plugin-loader.ts` nor `engine/finish-publication.ts`.

**Files likely touched:**
- `src/conductor/src/engine/builtin-llm-providers.ts` — new; `src/conductor/src/engine/plugin-loader.ts`
- `src/conductor/test/engine/builtin-llm-providers.test.ts` — new

**Dependencies:** none

## Task Dependency Graph

```
1 ──► 6
2 ──► 3 ──► 8 ──► 11 ──► 12 ──► 13 ──► 14 ──► 15 ──► 21
4 ──► 5 ──► 6 ──► 12          8 ──► 16 ◄── 12
7 ──► 8                       3, 8 ──► 17
9 ──► 12      10 ──► 15
18 ──► 8;  18 ──► 19 ──► 20;  12 ──► 23;  24 ──► 15
22 (independent)
```

## Integration Points

- After Task 8: the daemon forward walk handles `plan_review` (skip, done, halt).
- After Task 15: `ai-conductor compose plan-review` runs end to end with a fake executor.
- After Task 16: interactive conduct runs plan review in sequence.
- After Task 17: land enforces the review.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given an M-tier plan whose task adds a reference to `stacked_prs` in `land-spec.ts` and a target test that asserts only `engine/config.ts` and `types/config.ts` reference `stacked_prs`, and no task lists that test, when plan review runs, then the review artifact records a test-impact finding naming that test file with its `file:line` and naming the task id. | 23, 4 | "writes a test-impact finding naming the test file's `file:line` and the task id" | diff-local |
| Story 1 happy: Given the same plan with a task whose files list includes that test file and whose Done-when updates the assertion, when plan review runs, then the review artifact records no test-impact finding for that test. | 23, 4 | "the artifact records no test-impact, reachability, or dependency-order finding respectively" | diff-local |
| Story 1 negative: Given an existing test that references a planned file path only in a comment or an unrelated string and that no task change can affect, when plan review runs, then no blocking test-impact finding is recorded for it, because a candidate that the reviewer rules not to be a defect is never reported as blocking. | 12 | "so a rejected finding is not written and a candidate the reviewer did not report never appears as a finding" | diff-local |
| Story 1 negative: Given a target repository with no test files at all, when plan review runs, then it completes with zero test-impact findings and does not fail. | 23, 4 | "completes and writes an artifact with zero test-impact findings" | diff-local |
| Story 2 happy: Given an M-tier plan that introduces an exported function whose only named reader is a future ticket and no task wires it into a production entry point, when plan review runs, then the review artifact records a reachability finding naming the export, the introducing task id, the `file:line` of the plan line that introduces it, and the source paths that were searched for a caller. | 23, 5 | "a reachability finding naming the export, the introducing task id, the `file:line` of the plan line introducing it, and the searched source paths" | diff-local |
| Story 2 happy: Given a plan that introduces an export and a task whose Done-when observes it through an existing CLI command or step runner caller in source, when plan review runs, then no reachability finding is recorded for that export. | 23, 5 | "the artifact records no test-impact, reachability, or dependency-order finding respectively" | diff-local |
| Story 2 negative: Given a plan whose architecture review lists a Wiring Surface item that already has a production caller in the target source, when plan review runs, then no reachability finding is recorded for that item. | 23, 5 | "the artifact records no test-impact, reachability, or dependency-order finding respectively" | diff-local |
| Story 2 negative: Given an architecture review with no `## Wiring Surface` section, when plan review runs, then reachability candidates are still derived from the plan's own exported identifiers and plan review does not fail for the missing section. | 5 | "derives candidates from the plan's backticked exports when `parseWiringSurface` finds no `## Wiring Surface` section, without throwing" | diff-local |
| Story 3 happy: Given a plan where Task 7's Done-when asserts an export that only Task 8 creates and Task 8 depends on Task 7, when plan review runs, then the review artifact records a dependency-order finding naming both Task 7 and Task 8. | 23, 6 | "dependency-order findings naming Task 7 and Task 8 and naming Task 12 and Task 4" | diff-local |
| Story 3 happy: Given a plan where Task 12 needs a config key that Task 4 introduces and Task 12's Dependencies line omits Task 4 directly and transitively, when plan review runs, then a dependency-order finding names Task 12 and Task 4. | 23, 6 | "dependency-order findings naming Task 7 and Task 8 and naming Task 12 and Task 4" | diff-local |
| Story 3 negative: Given a task whose Done-when cites an identifier introduced by a task reachable through its transitive Dependencies closure, when plan review runs, then no dependency-order finding is recorded for it. | 23, 6 | "the artifact records no test-impact, reachability, or dependency-order finding respectively" | diff-local |
| Story 3 negative: Given a task whose Dependencies line is malformed or cites an unknown task id, when plan review runs, then plan review reports the malformed Dependencies line naming the task instead of silently treating the task as having no dependencies. | 23, 6, 1 | "refuse before any dispatch with a message naming the task and its Dependencies line" | diff-local |
| Story 4 happy: Given plan review produces findings, when the review artifact is written, then each finding shows an id, a severity of blocking or significant or advisory, a lens, the artifact path, a reference written as `task <id>` or a story id or `<adr-stem>#D<n>`, a summary, and its evidence. | 2, 3 | "a reference written as `task <id>`, a story id, or `<adr-stem>#D<n>`, summary, and evidence" | diff-local |
| Story 4 happy: Given any finding, when the review artifact is written, then its evidence includes at least one `file:line` in the worktree, which is a source file outside `.docs/` for a test-impact or feasibility finding; and a contradiction finding's evidence also quotes both opposing passages verbatim. | 2, 12 | "rejects any finding with no worktree `file:line` evidence, and a test-impact or feasibility finding whose only `file:line` is not in a source file outside `.docs/`" | diff-local |
| Story 4 negative: Given the reviewer returns a finding with no `file:line` evidence, or a test-impact or feasibility finding whose only `file:line` is not a source file outside `.docs/`, when the engine validates the result, then that finding is rejected and is not written as a finding. | 2, 12 | "rejects any finding with no worktree `file:line` evidence, and a test-impact or feasibility finding whose only `file:line` is not in a source file outside `.docs/`" | diff-local |
| Story 4 negative: Given the reviewer's response does not satisfy the findings schema at all, when the engine validates it, then the response counts as a failed dispatch that falls through to the next provider candidate and is not counted as a review round. | 12 | "the artifact's round count stays 1" | diff-local |
| Story 5 happy: Given a plan that says a runner reads config from a directory that is the feature worktree in the daemon (per the source), when plan review runs, then a feasibility finding cites the source `file:line` that shows the directory passed in production. | 23, 12, 18 | "A reviewer-returned feasibility finding citing a source `file:line`" | diff-local |
| Story 5 happy: Given a plan whose task's Done-when contradicts an accepted story criterion or an in-scope ADR decision, when plan review runs, then a contradiction finding names the task and the criterion text or `<adr-stem>#D<n>` and quotes both passages. | 23, 18 | "a contradiction finding citing a story criterion with a task and both quoted passages" | diff-local |
| Story 5 happy: Given two tasks where fully completing one invalidates the other's Done-when, when plan review runs, then a contradiction finding names both tasks and quotes both Done-when passages. | 23, 18 | "a task-versus-task contradiction naming both tasks with both Done-when passages" | diff-local |
| Story 5 negative: Given a story criterion that is merely uncovered by any task, when plan review runs, then no contradiction finding is recorded for it. | 18 | "the directive that a merely uncovered criterion yields no contradiction finding" | diff-local |
| Story 5 negative: Given the reviewer session attempts to write or edit a file in the worktree, when the dispatch runs, then the write is refused by the provider's read-only mode and no worktree file has changed when the dispatch returns, before the engine writes the review artifact. | 12 | "so a reviewer write is refused and no worktree file has changed when the dispatch returns" | diff-local |
| Story 6 happy: Given a composer session launched by `ai-conductor compose` with Claude as host and codex also configured, when plan review runs with no `steps.plan_review.llm_provider` set, then the reviewer runs on codex and the review artifact records authoring host claude, reviewer provider codex, and independence cross-provider. | 15, 11, 10 | "dispatches the reviewer on codex and writes an artifact recording authoring host claude, reviewer provider codex, and independence cross-provider" | diff-local |
| Story 6 happy: Given `steps.plan_review.llm_provider` is set to pi, when plan review runs, then the reviewer runs on pi regardless of the authoring host. | 11, 12 | "pi when `steps.plan_review.llm_provider` is pi, whatever the authoring host" | diff-local |
| Story 6 happy: Given a session started without the launcher but whose environment carries a host session marker, when plan review runs, then the authoring host is resolved from that marker. | 11 | "else the provider whose catalog session marker is present" | diff-local |
| Story 6 negative: Given only the authoring host's provider is configured, when plan review runs, then the review runs in a fresh session of that provider, the artifact records independence same-provider, the operator sees a one-line notice, and land is not blocked on that ground. | 12, 11, 17 | "When only the host provider is configured" | diff-local |
| Story 6 negative: Given the other provider fails or is unavailable at dispatch time, when plan review runs, then it falls back to a fresh same-provider session and records same-provider independence. | 12 | "the first candidate provider fails or returns a schema-invalid response" | diff-local |
| Story 6 negative: Given neither the launcher variable nor any host marker resolves the authoring host, when plan review runs, then the reviewer runs on the first configured provider and the artifact records independence unknown-host. | 11, 12 | "records `unknown-host` when `resolveAuthoringHost` returns `unknown`" | diff-local |
| Story 7 happy: Given round 1 recorded blocking findings and the author changed the plan, when plan review runs again, then round 2 re-checks only the prior blocking and significant findings and the tasks, stories, and ADR decisions whose text changed since round 1, and marks each prior finding resolved or still standing. | 13 | "contains only the tasks, stories, and ADR decisions whose digests changed since round 1 plus every prior blocking and significant finding" | diff-local |
| Story 7 happy: Given round 2 left a blocking finding standing, when the operator runs `ai-conductor compose plan-review --accept <finding-id> --reason "<text>"`, then the review artifact records the acceptance with its reason and that finding no longer blocks land. | 14, 15 | "records the acceptance and reason in the artifact so the finding no longer blocks" | diff-local |
| Story 7 happy: Given round 1 records no blocking findings, when plan review completes, then no operator prompt or decision is requested. | 15 | "A clean round 1 exits 0 with no operator prompt" | diff-local |
| Story 7 negative: Given two review rounds have already run, when plan review is invoked again, then no reviewer is dispatched and the command reports that the bound is reached and lists each standing blocking finding for operator disposition. | 13 | "makes zero provider dispatches and reports that the bound is reached, listing each standing blocking finding's id and summary" | diff-local |
| Story 7 negative: Given an `--accept` invocation with an empty reason or an unknown finding id, when the command runs, then it refuses with a message naming the problem and the review artifact is unchanged. | 14 | "with an empty reason or an unknown finding id refuses with a message naming the problem and leaves the artifact byte-for-byte unchanged" | diff-local |
| Story 7 negative: Given an author hand-edits the review artifact to mark a finding accepted, when land runs, then land refuses because the artifact no longer matches what the primitive wrote. | 17, 3 | "integrity-mismatched" | diff-local |
| Story 7 negative: Given the bound is reached and the operator edits the plan to fix a standing finding, when the operator runs `ai-conductor compose plan-review --acknowledge --reason "<text>"`, then no reviewer is dispatched and the artifact's reviewed digest is re-stamped over the current plan, stories, and in-scope ADRs. | 14, 15 | "makes zero provider dispatches and re-stamps the artifact's reviewed digest" | diff-local |
| Story 8 happy: Given an M-tier spec whose review artifact matches the current plan, stories, and in-scope ADRs and has no unresolved blocking finding, when `ai-conductor compose land` runs, then the plan-review rung passes and land proceeds. | 17 | "lands an M spec whose review artifact matches `computeReviewedDigest` and has no unresolved blocking finding" | diff-local |
| Story 8 happy: Given an M-tier spec whose review artifact has a standing blocking finding, when land runs, then land refuses with a plan-review error naming each blocking finding's id, reference, and summary. | 17 | "or carries a standing blocking finding (naming each finding's id, reference, and summary)" | diff-local |
| Story 8 negative: Given an M-tier spec with no review artifact, when land runs, then land refuses with a plan-review error stating that plan review has not run. | 17 | "stating that plan review has not run" | diff-local |
| Story 8 negative: Given the plan was edited after the final review round and the operator recorded no acknowledgement, when land runs, then land refuses naming the changed artifact. | 17 | "digest-stale without acknowledgement (naming the changed artifact)" | diff-local |
| Story 8 negative: Given a review artifact that cannot be parsed, when land runs, then land refuses rather than treating it as clean. | 17 | "unparseable" | diff-local |
| Story 8 negative: Given land evaluates the plan-review rung, when it runs, then no provider or model is invoked by land. | 17 | "A provider executor spy records zero invocations across every `runPlanReviewGate` case" | diff-local |
| Story 9 happy: Given an S-tier spec, when the DECIDE steps run and land runs, then plan review is skipped, no review artifact is required, and land behaves exactly as before this feature. | 8, 17 | "`getSkippableSteps('S')` contains `plan_review`" | diff-local |
| Story 9 happy: Given an M-tier merged spec whose `.docs/plan-review/` artifact is absent and whose build is dispatched by the daemon, when the daemon walks DECIDE, then `plan_review` is fast-forwarded as skipped with reason `landed-before-plan-review` and the build proceeds. | 8, 7 | "fast-forwards `plan_review` as skipped with reason `landed-before-plan-review` for an M spec with no review artifact and lets the build proceed" | diff-local |
| Story 9 happy: Given an M-tier spec with a clean review artifact merged and dispatched by the daemon, when the daemon walks DECIDE, then `plan_review` is fast-forwarded as done. | 8 | "fast-forwards `plan_review` as done for a clean review artifact" | diff-local |
| Story 9 negative: Given an M-tier spec run under interactive `conduct` with no review artifact, when the forward walk reaches `plan_review`, then the step runs plan review rather than skipping it. | 16 | "calls `runPlanReview` rather than fast-forwarding it" | diff-local |
| Story 9 negative: Given an M-tier spec authored before this feature but landed after it, when land runs without a review artifact, then land refuses through the plan-review rung, because the rung has no legacy disengagement. | 17 | "including for a spec authored before this feature" | diff-local |
| Story 9 negative: Given an S-tier spec whose worktree happens to contain a review artifact, when land runs, then the plan-review rung neither requires nor evaluates it. | 17 | "neither requires nor evaluates a review artifact, whether or not one exists" | diff-local |
| Story 9 negative: Given a merged M-tier spec whose review artifact is present but still has a standing unaccepted blocking finding, when the daemon walks DECIDE, then `plan_review` is not fast-forwarded and the run halts naming the step. | 8, 7 | "halts naming `plan_review` when the artifact has a standing unaccepted blocking finding" | diff-local |
| Story 10 happy: Given an M-tier spec, when `/plan` completes, then it dispatches the §7a coverage judge and does not dispatch the §7b contradiction judge. | 20 | "§7b gates only tier S" | diff-local |
| Story 10 happy: Given an S-tier spec, when `/plan` completes, then it still dispatches the §7b contradiction judge with the same inputs, conflict rule, and round limit as before this feature. | 20 | "with unchanged inputs, conflict rule, and three-round limit" | diff-local |
| Story 10 happy: Given an M-tier spec, when `/coherence-check` runs, then it records coverage verdicts without re-running the plan §7a coverage judge and without running any contradiction or oscillation sweep. | 19 | "no contradiction, oscillation, or criterion-conflict sweep instruction" | diff-local |
| Story 10 negative: Given an M-tier coherence artifact recorded under the new instructions, when the land coherence gate runs, then it accepts the artifact without requiring `CONTRADICTS:` notes or contradiction-derived fail rows. | 22 | "accepts an M-tier coherence artifact with only `covered` rows and no `CONTRADICTS:` notes or contradiction-derived fail rows" | diff-local |
| Story 10 negative: Given an M-tier plan that skipped §7b, when plan review has not yet run, then land refuses via the plan-review rung, so no M/L spec lands with no contradiction review at all. | 17 | "when the artifact is missing" | diff-local |
| Story 11 happy: Given plan review dispatches a reviewer under `ai-conductor compose`, when the dispatch starts and completes, then a `plan_review_dispatched` event carrying round, reviewer provider, and independence and a `plan_review_completed` event carrying those fields plus finding counts by severity are appended to the composer event ledger. | 15 | "appends `plan_review_dispatched` (round, reviewer provider, independence) and `plan_review_completed` (those fields plus finding counts by severity)" | diff-local |
| Story 11 happy: Given plan review runs under interactive `conduct`, when it completes, then the same event variants are persisted to that run's `.pipeline/events.jsonl`. | 16 | "persists `plan_review_dispatched` and `plan_review_completed` to its `.pipeline/events.jsonl`" | diff-local |
| Story 11 happy: Given the operator accepts a finding, when the acceptance is recorded, then a `plan_review_finding_accepted` event names the finding id. | 14 | "emits `plan_review_finding_accepted` naming the finding id" | diff-local |
| Story 11 negative: Given the event ledger cannot be written, when plan review completes, then the review artifact is still written and the command reports the event-write failure rather than failing the review. | 15 | "when that write fails it still writes the review artifact and reports the event-write failure" | diff-local |
| Story 11 negative: Given plan review completes, when the worktree's changed and untracked files are listed, then the only files plan review created or changed are the review artifact and the existing event ledgers, with no other log or sidecar file. | 15 | "the worktree's changed and untracked files after the run are only the review artifact" | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-10-10-source-grounded-adversarial-plan-review-step#D1 | task | task-8, task-15, task-16 | `ALL_STEPS` lists `plan_review` immediately after `coherence_check` |
| adr-2026-10-10-source-grounded-adversarial-plan-review-step#D2 | task | task-1, task-4, task-5, task-6, task-12, task-23 | a candidate the reviewer did not report never appears as a finding |
| adr-2026-10-10-source-grounded-adversarial-plan-review-step#D3 | task | task-12, task-18 | with `readOnlyReview: true` and the plan-review native schema |
| adr-2026-10-10-source-grounded-adversarial-plan-review-step#D4 | task | task-10, task-11, task-12 | puts every configured non-host provider before the host provider |
| adr-2026-10-10-source-grounded-adversarial-plan-review-step#D5 | task | task-2 | rejects any finding with no worktree `file:line` evidence |
| adr-2026-10-10-source-grounded-adversarial-plan-review-step#D6 | task | task-13, task-14 | makes zero provider dispatches and reports that the bound is reached |
| adr-2026-10-10-source-grounded-adversarial-plan-review-step#D7 | task | task-3, task-17 | `landSpec` refuses an M spec with gate `plan-review` |
| adr-2026-10-10-source-grounded-adversarial-plan-review-step#D8 | task | task-9, task-15, task-16 | declares `plan_review_dispatched`, `plan_review_completed`, and `plan_review_finding_accepted` as persisted |
| adr-2026-10-10-source-grounded-adversarial-plan-review-step#D9 | task | task-7, task-8, task-17 | fast-forwards `plan_review` as skipped with reason `landed-before-plan-review` |
| adr-2026-10-10-source-grounded-adversarial-plan-review-step#D10 | task | task-19, task-20 | §7b gates only tier S |
| adr-2026-08-09-adr-contradiction-detection-in-two-halves#D1 | no-change | none | The early-and-late split is preserved; this feature only relocates the late half, which is implemented under the D4 row. |
| adr-2026-08-09-adr-contradiction-detection-in-two-halves#D2 | existing | none | skills/conflict-check/SKILL.md §1 Inventory already loads approved ADRs from .docs/decisions/ as a comparison party; this feature does not change conflict-check's corpus. |
| adr-2026-08-09-adr-contradiction-detection-in-two-halves#D3 | existing | none | skills/coherence-check/SKILL.md §4a already declares the `adr` row class and the land coherence validator already enforces it; this feature leaves that accounting unchanged. |
| adr-2026-08-09-adr-contradiction-detection-in-two-halves#D4 | task | task-18, task-19 | finds every enumerated lens |
| adr-2026-08-03-fail-closed-decide-entry#D1 | task | task-7 | returns `halt` for that step when its artifact is present but unsatisfied |
| adr-2026-08-03-fail-closed-decide-entry#D2 | no-change | none | plan_review adds no DECIDE preseed; its completion predicate keeps the engine as the single satisfaction authority. |
| adr-2026-08-03-fail-closed-decide-entry#D3 | no-change | none | The new rule lives inside decideEntryDisposition and is consulted only at the existing enforcement seams; no seam is added or removed. |
| adr-2026-08-03-fail-closed-decide-entry#D4 | no-change | none | Unresolvable targets still halt by rule 2; the new rule applies only to a resolved DECIDE step. |
| adr-2026-08-03-fail-closed-decide-entry#D5 | no-change | none | The HALT payload shape is unchanged; a present-but-unsatisfied plan_review halts through the existing rule 8 payload. |
| adr-2026-08-03-fail-closed-decide-entry#D6 | no-change | none | Operator grants are unchanged; the absent-artifact rule is structural and is never inferred as a grant. |
| adr-2026-08-03-fail-closed-decide-entry#D7 | task | task-7 | returns `enter` for an absent-artifact step declaring the field when a valid in-scope grant names it |
| adr-2026-08-03-fail-closed-decide-entry#D8 | task | task-7 | returns `halt` for that step when its artifact is present but unsatisfied |
| adr-2026-07-22-coherence-gate-placement-and-validation-split#D1 | task | task-8, task-21 | `ALL_STEPS` lists `plan_review` immediately after `coherence_check` |
| adr-2026-07-22-coherence-gate-placement-and-validation-split#D2 | no-change | none | The CoherenceValidator land rung is unchanged; the plan-review rung is added after it as a separate rung. |
| adr-2026-07-22-coherence-gate-placement-and-validation-split#D3 | task | task-17 | A provider executor spy records zero invocations across every `runPlanReviewGate` case |
| adr-2026-07-22-coherence-gate-placement-and-validation-split#D4 | no-change | none | The orphan-task rule is unchanged; every task in this plan cites a story id on its Story line. |
| adr-2026-07-22-coherence-gate-placement-and-validation-split#D5 | no-change | none | Layer requirements still derive from committed markers; this feature adds no coherence layer. |
| adr-2026-07-22-coherence-gate-placement-and-validation-split#D6 | no-change | none | The tier-S exemption is unchanged; plan_review is also S-skipped and its land rung engages only when the tier is not S. |
| adr-2026-07-22-coherence-gate-placement-and-validation-split#D7 | no-change | none | Intake outcome staging and the plan-stem intake marker are unchanged. |
| adr-2026-07-22-coherence-gate-placement-and-validation-split#D8 | no-change | none | The coherence mapping model selection and the model-free land validator are unchanged; the new land rung is also model-free. |

## Verification
- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks; no unbounded quality word is left without its closed enumeration or named mechanism (3c)
- [ ] Dependencies are explicit and acyclic
- [ ] Tasks do not invalidate each other's fixtures or assertions; plan review sweeps this at Medium and Large tier, and Small tier gains no required step for it

### Task rem-prd-audit-R1: plan-review-contract.ts + plan-review-runner.ts + plan-review-candidates: make evidence validation lens-specific (any worktree file:line incl. .docs plan/story/ADR lines for reachability, dependency-order, contradiction; source outside .docs only for test-impact/feasibility), include .docs artifact files in the runner evidence map, require dependency-order relatedReference to name a second task, emit reachability candidate paths as .docs/plans/<stem>.md:<n>; add per-lens accept/reject tests in plan-review-contract.test.ts
**Gate:** prd-audit
**Rationale:** Verified against plan Task 2 Done-when: only test-impact and feasibility findings require a source file:line outside .docs/; every other lens needs only worktree file:line evidence. Applying the source requirement to every lens is implementation drift from the approved contract, so it is BUILD work. Confidence 90%.
**Criterion:** S2.1
**Parent task:** 2
**Done when:**
- [test] S2.1 is satisfied by this task.
- The repair for task rem-prd-audit-R1 is committed and its targeted tests pass.

### Task rem-prd-audit-R1-2: plan-review-contract.ts: accept plan-line evidence for dependency-order findings (with second-task relatedReference); test the Task 7/Task 8 fixture finding validates and is written
**Gate:** prd-audit
**Rationale:** Same validator defect as S2.1: a dependency-order finding is plan-grounded, and Task 2 does not require source-outside-.docs evidence for it. Repair lives in Task 2's validator.
**Criterion:** S3.1
**Parent task:** 2
**Done when:**
- [test] S3.1 is satisfied by this task.
- The repair for task rem-prd-audit-R1-2 is committed and its targeted tests pass.

### Task rem-prd-audit-R1-3: plan-review-contract.ts: test that the Task 12/Task 4 missing-dependency finding with plan-only evidence validates and is written
**Gate:** prd-audit
**Rationale:** Same validator defect as S3.1 for the missing-dependency (Task 12/Task 4) fixture; the candidate lens is correct, only Task 2's validator rejects the finding.
**Criterion:** S3.2
**Parent task:** 2
**Done when:**
- [test] S3.2 is satisfied by this task.
- The repair for task rem-prd-audit-R1-3 is committed and its targeted tests pass.

### Task rem-prd-audit-R2: plan-review-runner.ts: validate each provider response inside the provider loop; fall through to the next candidate provider in a fresh session on a schema-invalid response; filter out individual findings failing validatePlanReviewResult and write only passing ones; tests in plan-review-runner.test.ts for a dropped invalid finding and schema-invalid fallthrough
**Gate:** prd-audit
**Rationale:** Task 12 Done-when requires writing only findings that pass validatePlanReviewResult, so a rejected finding is dropped rather than aborting the round. The runner throws on any rejection instead. Clear implementation drift within Task 12.
**Criterion:** S4.3
**Parent task:** 12
**Done when:**
- [test] S4.3 is satisfied by this task.
- The repair for task rem-prd-audit-R2 is committed and its targeted tests pass.

### Task rem-prd-audit-R2-2: plan-review-runner.ts: move result validation into the provider loop so a schema-invalid response falls through; add a test where the first provider returns a contract-violating structured result and the second provider is dispatched in a fresh session
**Gate:** prd-audit
**Rationale:** Task 12 Done-when explicitly requires fallthrough to the next provider on a schema-invalid response. The loop breaks before validating, and the only test covers success:false. This is BUILD under Task 12.
**Criterion:** S4.4
**Parent task:** 12
**Done when:**
- [test] S4.4 is satisfied by this task.
- The repair for task rem-prd-audit-R2-2 is committed and its targeted tests pass.

### Task rem-prd-audit-R1-4: plan-review-contract.ts: accept a task-vs-criterion/ADR contradiction grounded by two verbatim quotes and artifact file:line only; add a test
**Gate:** prd-audit
**Rationale:** Task 2 requires two verbatim-grounded quotes from plan, stories, ADR or a cited source for contradiction findings. It does not require extra source-outside-.docs evidence. Validator repair in Task 2.
**Criterion:** S5.2
**Parent task:** 2
**Done when:**
- [test] S5.2 is satisfied by this task.
- The repair for task rem-prd-audit-R1-4 is committed and its targeted tests pass.

### Task rem-prd-audit-R1-5: plan-review-contract.ts: accept a task-vs-task contradiction quoting two plan Done-when passages with plan file:line evidence; add a test
**Gate:** prd-audit
**Rationale:** Same as S5.2 for task-vs-task contradictions quoting two plan Done-when passages; validator repair in Task 2.
**Criterion:** S5.3
**Parent task:** 2
**Done when:**
- [test] S5.3 is satisfied by this task.
- The repair for task rem-prd-audit-R1-5 is committed and its targeted tests pass.

### Task rem-prd-audit-R3: plan-review-runner.ts + engineer-cli.ts: return/emit a one-line operator notice when independence is same-provider or unknown-host and print it from the compose plan-review handler; tests in plan-review-runner.test.ts and engineer-cli-plan-review.test.ts
**Gate:** prd-audit
**Rationale:** Task 12 Done-when requires recording same-provider with a one-line notice. Independence is recorded, but no notice is surfaced. This is BUILD under Task 12, with the CLI print as its surface.
**Criterion:** S6.4
**Parent task:** 12
**Done when:**
- [test] S6.4 is satisfied by this task.
- The repair for task rem-prd-audit-R3 is committed and its targeted tests pass.

### Task rem-prd-audit-R7: conductor.ts forward walk: persist the fast-forward disposition reason through the existing step-status state/event spine (no new channel); extend decide-entry-healthy-fast-forward.acceptance.test.ts to assert reason landed-before-plan-review
**Gate:** prd-audit
**Rationale:** Task 8 Done-when requires the forward walk to fast-forward plan_review as skipped with reason landed-before-plan-review. decideEntryDisposition returns the reason, but conductor.ts discards it, and the acceptance test asserts only status. Wiring within Task 8.
**Criterion:** S9.2
**Parent task:** 8
**Done when:**
- [test] S9.2 is satisfied by this task.
- The repair for task rem-prd-audit-R7 is committed and its targeted tests pass.

### Task rem-prd-audit-R8: engineer-cli.ts plan-review handler: wrap event emission so ledger write failures (including before dispatch) are captured and reported without aborting dispatch or artifact write; add a test with composer-events.jsonl unwritable from the start asserting the artifact is written and the failure reported
**Gate:** prd-audit
**Rationale:** Task 15 Done-when requires the subcommand to still write the artifact and report the failure when an event write fails. emitOrThrow before dispatch aborts the run when the ledger is unwritable from the outset. Handler fix in Task 15.
**Criterion:** S11.4
**Parent task:** 15
**Done when:**
- [test] S11.4 is satisfied by this task.
- The repair for task rem-prd-audit-R8 is committed and its targeted tests pass.

### Task rem-prd-audit-R8-2: engineer-cli.ts plan-review handler: resolve the active feature plan by the worktree's feature slug (.docs/plans/<slug>.md) instead of requiring exactly one plan file; test with historical plans present
**Gate:** prd-audit
**Rationale:** Conforming implementation drift under ADR D1. The compose handler must select the active feature plan, not require that one plan exist repository-wide. Task 15 owns the handler and no architecture change is needed.
**Governing clause:** adr-2026-10-10-source-grounded-adversarial-plan-review-step decision 1
**Done when:**
- adr-2026-10-10-source-grounded-adversarial-plan-review-step decision 1 is satisfied by this task.
- The repair for task rem-prd-audit-R8-2 is committed and its targeted tests pass.

### Task rem-prd-audit-R3-2: plan-review-provider.ts orderReviewerCandidates: place an explicit steps.plan_review.llm_provider first even when it is the host or absent from llm_provider; add tests in plan-review-provider.test.ts; same-provider/unknown-host one-line notice surfaced via engineer-cli
**Gate:** prd-audit
**Rationale:** ADR D4 and Task 11 Done-when say steps.plan_review.llm_provider wins for every authoring host, but the code demotes a host preference and ignores one absent from the global list. The missing notices duplicate S6.4. Conforming fixes in Tasks 11/12.
**Governing clause:** adr-2026-10-10-source-grounded-adversarial-plan-review-step decision 4
**Done when:**
- adr-2026-10-10-source-grounded-adversarial-plan-review-step decision 4 is satisfied by this task.
- The repair for task rem-prd-audit-R3-2 is committed and its targeted tests pass.

### Task rem-prd-audit-R2-3: plan-review-runner.ts: validate inside provider loop and fall through on invalid structured output
**Gate:** prd-audit
**Rationale:** Same defect as S4.4 against ADR D5 invalid-response fallback; fix in Task 12's runner loop.
**Governing clause:** adr-2026-10-10-source-grounded-adversarial-plan-review-step decision 5
**Done when:**
- adr-2026-10-10-source-grounded-adversarial-plan-review-step decision 5 is satisfied by this task.
- The repair for task rem-prd-audit-R2-3 is committed and its targeted tests pass.

### Task rem-prd-audit-R1-6: plan-review-contract.ts + plan-review-runner.ts: lens-specific evidence rules, .docs artifact files in the evidence map, reject dependency-order findings lacking a second-task relatedReference
**Gate:** prd-audit
**Rationale:** ADR D5 permits plan-line reachability evidence and requires dependency closure for dependency-order findings. Task 2 Done-when matches the ADR. Validator and evidence-map drift is BUILD.
**Governing clause:** adr-2026-10-10-source-grounded-adversarial-plan-review-step decision 5
**Done when:**
- adr-2026-10-10-source-grounded-adversarial-plan-review-step decision 5 is satisfied by this task.
- The repair for task rem-prd-audit-R1-6 is committed and its targeted tests pass.

### Task rem-as-built-R4: plan-review-runner.ts round-1 inputs: load only ADRs cited by the plan (in-scope) and include only their parsed Decision sections; test that unrelated decision/review files are excluded from the prompt
**Gate:** as-built
**Rationale:** ADR D3 and Task 12 Done-when require the in-scope ADR decisions, not every decision-directory document. The runner over-includes inputs, which is conforming implementation drift.
**Governing clause:** adr-2026-10-10-source-grounded-adversarial-plan-review-step decision 3
**Done when:**
- adr-2026-10-10-source-grounded-adversarial-plan-review-step decision 3 is satisfied by this task.
- The repair for task rem-as-built-R4 is committed and its targeted tests pass.

### Task rem-as-built-R5: plan-review-runner.ts round 2: supply only candidates for changed components plus prior blocking/significant findings, not the full regenerated candidate set; extend plan-review-runner-bound.test.ts to assert unchanged-surface candidates are absent
**Gate:** as-built
**Rationale:** ADR D6 and Task 13 Done-when limit round 2 to changed tasks, stories and decisions plus prior blocking and significant findings. Regenerating all candidates breaks that scope. BUILD under Task 13.
**Governing clause:** adr-2026-10-10-source-grounded-adversarial-plan-review-step decision 6
**Done when:**
- adr-2026-10-10-source-grounded-adversarial-plan-review-step decision 6 is satisfied by this task.
- The repair for task rem-as-built-R5 is committed and its targeted tests pass.

### Task rem-as-built-R6: plan-review-artifact.ts + plan-review-runner.ts: replace the local D<n>. decisionSections parsers with artifacts.ts parseAdrDecisions; test that numbered-Markdown ADR decisions (incl. this feature's governing ADR) produce digests, and that a changed decision makes plan-review-gate stale and appears in round-2 inputs
**Gate:** as-built
**Rationale:** Verified: plan-review-artifact.ts decisionSections matches only ^D<n>. lines, while artifacts.ts exports parseAdrDecisions for numbered, bold and heading forms. Task 3 requires per-in-scope-ADR-decision digests. Reusing the established parser is conforming BUILD work.
**Governing clause:** adr-2026-10-10-source-grounded-adversarial-plan-review-step decision 7
**Done when:**
- adr-2026-10-10-source-grounded-adversarial-plan-review-step decision 7 is satisfied by this task.
- The repair for task rem-as-built-R6 is committed and its targeted tests pass.

### Task rem-prd-audit-R7-2: conductor.ts: persist fast-forward reason landed-before-plan-review via existing step-status state/event; assert in acceptance test
**Gate:** prd-audit
**Rationale:** Same defect as S9.2 against ADR D9: the provenance reason is computed but dropped by conductor.ts. Persist it via the existing spine under Task 8.
**Governing clause:** adr-2026-10-10-source-grounded-adversarial-plan-review-step decision 9
**Done when:**
- adr-2026-10-10-source-grounded-adversarial-plan-review-step decision 9 is satisfied by this task.
- The repair for task rem-prd-audit-R7-2 is committed and its targeted tests pass.
