# Implementation Plan: Custom steps without engine-reserved names or paths

**Date:** 2026-09-20
**Stories:** .docs/stories/custom-steps-work-only-in-this-repo-engine-hardcod.md
**Conflict check:** Clean as of 2026-09-20

## Summary

Removes the four places the engine binds custom-step behavior to this repository: the reserved
step name at FINISH, the skill-path literal that activates the release-metadata flow, dispatch by
step key instead of configured skill, and release actions on the package main entry. No
configuration key is added. 17 tasks.

## Technical Approach

- **FINISH prerequisite (Tasks 1 to 7).** A pure selector reads the ordered step registry and
  returns the custom steps that gate FINISH: not built-in, `gating`, declaring `completion_artifact`,
  ordered before `finish`. The production observer evaluates each one with today's rules — recorded
  status `done`, marker a regular file, modification time not before the feature run start read from
  persisted state — and aggregates with the fixed precedence missing, malformed, stale, unavailable.
  Any status other than `done` is `missing`, including `skipped`. The observation port gains an object
  form carrying the unsatisfied keys; the three existing blocked conditions carry them to the
  operator. No condition code, disposition, observation dimension, or event type is added.
- **Dispatch (Tasks 8 to 10).** A custom step's skill identity is the frontmatter `name` of the file
  its `skill` setting names. The provider step runner renders it with the shared auxiliary invocation
  helper so each provider gets its own prefix, on both the direct path and the per-candidate
  fallback path. Whether the provider can find that name stays the repository's responsibility;
  installed-catalog resolution is out of scope (#2615). Failures are typed and name step and path.
- **Self-host confinement (Tasks 11 to 13).** A closed-result resolver replaces the path-literal
  predicate: `inactive`, `active`, `step-missing`. Self-build still comes from the existing detector
  seam. The snapshot and restore move out of the conductor class into the self-host area with their
  GitHub runner injected. `step-missing` halts through the existing self-host halt writer.
- **Public surface (Tasks 14 to 17).** The release action modules stay where they are; a new
  self-host entry module re-exports them and becomes a bundler entry, following the existing
  secondary-entry precedent. The main entry drops them and its export names are pinned by a
  recorded list. A static test proves every release workflow import resolves to a bundler entry that
  exports the names the workflow uses — this is the pre-merge proof for the two workflows that only
  run after merge. The shared release-metadata parser is not moved.
- **Sequencing.** The four groups are independent of each other and can build concurrently. Draft
  PR #2523 edits the conductor class and the provider step runner; tasks here touch small named
  regions of those files so a rebase stays mechanical.
- **Pattern context.** Table-driven membership: resolve from the passed step table, never from a
  name list (search hint: the DECIDE-phase kickback resolution in the daemon). Secondary bundler
  entry: a named entry emitted at a path mirroring its source (search hint: the bundler
  configuration's existing second entry). Each affected task repeats what it needs.

## Prerequisites

- None. No migration, package, or configuration change precedes Task 1.

## Tasks

### Task 1: Select the custom steps that gate FINISH
**Story:** 2
**Type:** infrastructure

**Steps:**
1. Write failing unit tests for a pure selector that takes the loaded project configuration and its ordered step registry and returns the keys of custom steps that are FINISH prerequisites.
2. Verify the tests fail (RED).
3. Implement `selectFinishPrerequisiteSteps` in a new module. A step qualifies only when its key is not a built-in step, its enforcement is `gating`, it declares `completion_artifact`, and the registry orders it before `finish`. Follow the table-driven precedent used for DECIDE-phase resolution: read membership from the passed step table, never from a list of names. Return plain string keys; do not cast a key to the built-in step-name type.
4. Verify the tests pass (GREEN).
5. Commit: "feat(finish): select gating custom steps that are FINISH prerequisites".

**Done when:**
- `selectFinishPrerequisiteSteps` returns an empty list for a configuration with no custom steps and for one whose only custom steps are advisory or lack `completion_artifact`, asserted by the selector unit tests.
- `selectFinishPrerequisiteSteps` returns both keys, in registry order, for a configuration declaring two gating custom steps with markers before `finish`, and omits a third declared with `after: finish`.
- The selector module contains no string literal naming a specific custom step and no cast of a step key to the built-in step-name type, asserted by a source-text test over the module.

**Files:**
- src/conductor/src/engine/finish-custom-step-prerequisites.ts — new selector
- src/conductor/test/engine/finish-custom-step-prerequisites.test.ts — new

**Dependencies:** none

### Task 2: Carry unsatisfied step keys on the release-readiness blocker
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing tests for the FINISH coordinator: the release-readiness observation port may return an observation together with the keys of unsatisfied steps, and each blocked release-readiness condition exposes those keys.
2. Verify the tests fail (RED).
3. Extend the release-readiness observation port in the FINISH coordinator to accept `{ observation, steps }` as well as the bare observation string. Thread `steps` through the publication snapshot to the three blocked conditions `release_readiness_missing`, `release_readiness_invalid`, and `release_readiness_indeterminate`: add a `steps` field and append the keys to the operator-visible message. Keep every condition `code`, `nextAction`, and disposition exactly as it is; add no condition and no disposition. The `releaseReadiness` dimension stays the only dimension this observation feeds.
4. Verify the tests pass (GREEN).
5. Commit: "feat(finish): name unsatisfied custom steps on release-readiness blockers".

**Done when:**
- With the port returning `missing` for step `compliance-gate`, the coordinator reports condition code `release_readiness_missing` whose message contains `compliance-gate` and whose `steps` field equals that one key.
- With the port returning two unsatisfied keys, the blocked condition message and `steps` field carry both `compliance-gate` and `notes-gate`.
- With the port returning `unavailable` and keys, the coordinator reports `release_readiness_indeterminate` carrying those keys, and never `release_readiness_missing` or `release_readiness_invalid`.
- With the port returning `present`, the coordinator reports no release-readiness blocked condition and completes publication, and a test enumerating the blocked condition codes and dispositions finds the same sets as on the base commit.

**Files:**
- src/conductor/src/engine/finish-publication.ts — port, snapshot, three blocked conditions
- src/conductor/test/engine/finish-publication-blocked-steps.test.ts — new

**Dependencies:** none

### Task 3: Generalize the production observer to every prerequisite step
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing tests for the production release-readiness observer using fixture configurations whose custom step is named `compliance-gate`, never `release-disposition`.
2. Verify the tests fail (RED).
3. Rewrite `createProductionReleaseReadinessObserver` to build the ordered step registry from the configuration, call `selectFinishPrerequisiteSteps`, and evaluate each selected step. Return `present` without touching the filesystem when the selection is empty. Return the Task 2 object form, listing unsatisfied keys. Remove the lookup of the reserved step name.
4. Verify the tests pass (GREEN).
5. Commit: "feat(finish): observe every gating custom step as a FINISH prerequisite".

**Done when:**
- For a fixture repository whose single gating custom step `compliance-gate` is `done` with a marker newer than the feature run start, the production observer returns `present` with no unsatisfied steps.
- For a fixture declaring two gating custom steps, both `done` with fresh markers, the production observer returns `present`.
- For a configuration with no custom steps the production observer returns `present` and a spy on the filesystem stat call records zero calls.
- Loaded from this repository's own checked-in project configuration with `maintain-documentation` and `release-disposition` both `done` and fresh, the production observer returns `present`.
- Through the production FINISH coordinator, a single gating custom step `compliance-gate` that is `done` with a marker newer than the feature run start yields a valid release-readiness verification and the publication transition proceeds, asserted by the coordinator test.
- Through the production FINISH coordinator, two gating custom steps both `done` with fresh markers yield a valid release-readiness verification.

**Files:**
- src/conductor/src/engine/finish-publication-production.ts — observer
- src/conductor/test/engine/finish-release-readiness-custom-steps.test.ts — new

**Dependencies:** Task 1, Task 2

### Task 4: Report a prerequisite step that has not passed
**Story:** 1
**Type:** negative-path

**Steps:**
1. Add failing tests to the observer suite for steps that are declared but not passed.
2. Verify the tests fail (RED).
3. In the per-step evaluation, treat any recorded status other than `done` as `missing`, including `skipped`, because a gating custom step cannot be disabled or made conditional by configuration. Treat an absent marker file as `missing`. Aggregate across steps with the fixed precedence missing, then malformed, then stale, then unavailable, and list every unsatisfied key.
4. Verify the tests pass (GREEN).
5. Commit: "feat(finish): block FINISH on a custom gate that has not passed".

**Done when:**
- The production observer returns `missing` naming `compliance-gate` for each of the recorded statuses `pending`, `in_progress`, and `failed`, asserted by a table-driven test.
- With one step `done` and fresh and a second step whose marker file is absent, the production observer returns `missing` naming only the second step.
- With a gating custom step whose recorded status is `skipped`, the production observer returns `missing` naming that step.
- Through the production FINISH coordinator, `compliance-gate` recorded as `pending`, `in_progress`, or `failed` yields a missing release-readiness verification and no publication transition is attempted, asserted for each status.
- Through the production FINISH coordinator, one step `done` and fresh alongside a second step whose marker file is absent yields a missing release-readiness verification and no publication transition is attempted.

**Files:** same as Task 3

**Dependencies:** Task 3

### Task 5: Judge marker freshness from the feature run start
**Story:** 1
**Type:** negative-path

**Steps:**
1. Add failing tests to the observer suite for stale, malformed, and undatable markers, and for a process restart.
2. Verify the tests fail (RED).
3. Evaluate each marker with a no-follow stat. A marker that is not a regular file is `malformed`. A marker whose modification time precedes the feature run start recorded in conductor state is `stale`. A non-finite feature run start is `unavailable`. Read the floor from persisted state on every observation so a new observer instance in a new process uses the same floor.
4. Verify the tests pass (GREEN).
5. Commit: "feat(finish): date custom-step markers from the feature run start".

**Done when:**
- A marker whose modification time is earlier than the feature run start makes the production observer return `stale`, which the coordinator maps to invalid release readiness.
- A marker path that is a directory, and one that is a symbolic link, each make the production observer return `malformed`.
- With a `done` step and no finite feature run start in state, the production observer returns `unavailable` naming the step.
- A second observer instance constructed after the first is discarded, reading the same persisted state, returns `present` for a marker written after the feature run start and before the restart.
- Through the production FINISH coordinator, a second observer instance constructed after a simulated restart yields a valid release-readiness verification for a marker written after the feature run start and before the restart.
- Through the production FINISH coordinator, a marker older than the feature run start yields an invalid release-readiness verification and no publication transition is attempted.
- Through the production FINISH coordinator, a marker path that is a directory or a symbolic link yields an invalid release-readiness verification and no publication transition is attempted.
- Through the production FINISH coordinator, a `done` step with no finite feature run start in state yields an indeterminate release-readiness verification and no publication transition is attempted.

**Files:** same as Task 3

**Dependencies:** Task 4

### Task 6: Prove excluded steps never block or mask
**Story:** 2
**Type:** negative-path

**Steps:**
1. Add failing observer tests for configurations mixing excluded and required steps.
2. Verify the tests fail (RED).
3. No new production logic is expected beyond Tasks 1 and 3 to 5; fix the observer only if a mixed fixture exposes a defect in how the selection and the evaluation compose.
4. Verify the tests pass (GREEN).
5. Commit: "test(finish): excluded custom steps neither block nor mask FINISH".

**Done when:**
- With a gating custom step declared `after: finish` whose marker is absent, the production observer returns `present`, so FINISH is not blocked by a step that runs after it.
- With an `enforcement: advisory` custom step whose marker is absent, the production observer returns `present`.
- With a gating custom step that declares no `completion_artifact` and is `done`, the production observer returns `present`.
- With one gating step declared `after: finish` and one ordered before `finish` whose marker is stale, the production observer returns `stale` naming only the step ordered before `finish`.

**Files:** same as Task 3

**Dependencies:** Task 5

### Task 7: Drive a custom-gate refusal through the production FINISH coordinator
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write a failing integration test that constructs the production FINISH publication coordinator with a fixture configuration and conductor state, with GitHub and git ports mocked at the process boundary, and lets it observe an unsatisfied custom gate.
2. Verify the test fails (RED).
3. Wire whatever the coordinator needs so the observer's unsatisfied keys reach the emitted blocked event. The refusal rides the existing blocked event; add no event type. The step key travels in the condition's `steps` field as a string and is never written to a field typed as a built-in step name.
4. Verify the test passes (GREEN).
5. Commit: "test(finish): custom-gate refusal reaches the persisted event stream".

**Done when:**
- Through `createProductionFinishPublicationCoordinator`, an unsatisfied gating custom step `compliance-gate` produces a `finish_publication_blocked` event whose condition names `compliance-gate`, and no publication transition after readiness verification is attempted.
- That event, written by the event persister and read back from the run's persisted event log, still carries `compliance-gate` in the condition's `steps` field, and no field typed as a built-in step name holds that key.

**Files:**
- src/conductor/test/engine/finish-publication-custom-gate-integration.test.ts — new
- src/conductor/src/engine/finish-publication-production.ts — only if wiring is missing

**Dependencies:** Task 6

### Task 8: Resolve a custom step's skill identity from its configured file
**Story:** 4
**Type:** negative-path

**Steps:**
1. Write failing unit tests for resolving the skill a custom step should run.
2. Verify the tests fail (RED).
3. Add `resolveCustomStepSkill` to the skill resolver module. It reads the file named by the step's configured `skill` setting, reuses the existing frontmatter parsing used for skill overrides, and returns the frontmatter `name`. It returns a typed failure, not an exception with free text, carrying the step key, the configured path, and one of the reasons `file-missing` or `name-missing`.
4. Verify the tests pass (GREEN).
5. Commit: "feat(steps): resolve a custom step's skill identity from its configured file".

**Done when:**
- `resolveCustomStepSkill` returns the frontmatter `name` for a valid skill file whose directory name and step key both differ from that name.
- For a skill file with frontmatter but no `name`, `resolveCustomStepSkill` returns a `name-missing` failure carrying both the step key and the configured skill path.
- For a configured path whose file does not exist at resolution time, `resolveCustomStepSkill` returns a `file-missing` failure carrying both the step key and the configured skill path.

**Files:**
- src/conductor/src/engine/skill-resolver.ts — new export
- src/conductor/test/engine/custom-step-skill-resolution.test.ts — new

**Dependencies:** none

### Task 9: Dispatch a custom step by its configured skill
**Story:** 4
**Type:** happy-path

**Steps:**
1. Write failing tests against the provider step runner's dispatch entry with a mocked provider, capturing the prompt it is given.
2. Verify the tests fail (RED).
3. In the provider step runner, replace the literal slash-plus-step-key prompt for steps absent from the skill invocation registry. Resolve the step with `resolveCustomStepSkill` and render the prompt with the shared auxiliary skill invocation helper and the active provider key, so Claude receives the slash form and Codex the dollar form. On a resolution failure, fail the step with a reason naming the step key and the configured skill path, before any provider call. Leave registry-rendered built-in steps untouched, including built-ins that carry a `skill` override.
4. Verify the tests pass (GREEN).
5. Commit: "fix(steps): dispatch a custom step by its configured skill, not its key".

**Done when:**
- For custom step `docs-gate` configured with a skill file named `maintain-documentation`, the Claude provider mock receives the prompt `/maintain-documentation` and conductor state is updated under the key `docs-gate`.
- The same step routed to Codex gives the provider mock the prompt `$maintain-documentation`.
- For this repository's `maintain-documentation` and `release-disposition` steps the captured Claude prompts equal the prompts captured on the base commit, asserted against recorded strings.
- In no captured prompt for `docs-gate` does the string `docs-gate` appear as the invoked skill, and a resolution failure produces zero provider mock calls and a failure reason containing both `docs-gate` and the configured path.
- A built-in step configured with a `skill` override yields the same captured prompt as on the base commit.
- Dispatching a custom step whose configured skill file exists but declares no `name` fails closed with a reason containing both the step key and the configured skill path, and the provider mock records zero calls.
- Dispatching a custom step whose configured skill file was removed after configuration load fails closed with a reason containing both the step key and the configured skill path, and the provider mock records zero calls.

**Files:**
- src/conductor/src/engine/step-runners.ts — custom-step prompt construction
- src/conductor/test/engine/custom-step-dispatch.test.ts — new

**Dependencies:** Task 8

### Task 10: Re-render the custom step prompt for each fallback provider
**Story:** 4
**Type:** happy-path

**Steps:**
1. Add a failing test that runs a custom step through provider fallback, first candidate Claude failing over to Codex.
2. Verify the test fails (RED).
3. Extend the per-candidate prompt option in the provider step runner, which today re-renders only registry steps, so a custom step's prompt is re-rendered from its resolved skill name for each candidate provider key.
4. Verify the test passes (GREEN).
5. Commit: "fix(steps): render a custom step's skill per fallback provider".

**Done when:**
- Through the provider step runner's dispatch entry with two candidates, the first mock receives `/maintain-documentation` and, after it fails over, the second receives `$maintain-documentation`.
- Both candidates are asked for the same resolved skill name, and neither prompt contains the step key `docs-gate` as the invoked skill.

**Files:** same as Task 9

**Dependencies:** Task 9

### Task 11: Decide release-metadata flow activation without a path literal
**Story:** 5
**Type:** happy-path

**Steps:**
1. Write failing unit tests for a pure activation resolver in the self-host area.
2. Verify the tests fail (RED).
3. Add `resolveReleaseMetadataFlow` to a new self-host module. Inputs: whether this is a self-build as answered by the existing self-host detector seam, whether the release-artifact gate is enabled, and the configured steps. Result is a closed set: `inactive`, `active`, or `step-missing`. It is `inactive` unless self-build and gate are both true; then `active` when a `release-disposition` step is declared, else `step-missing`. It never compares a skill path.
4. Verify the tests pass (GREEN).
5. Commit: "feat(self-host): activate the release-metadata flow without a skill path literal".

**Done when:**
- `resolveReleaseMetadataFlow` returns `active` for a self-build with the gate enabled and a `release-disposition` step whose `skill` setting points at a renamed directory.
- `resolveReleaseMetadataFlow` returns `inactive` for a repository that is not a self-build even when it declares a step named `release-disposition`.
- `resolveReleaseMetadataFlow` returns `inactive` for a self-build with the release-artifact gate disabled, with and without the step declared.
- `resolveReleaseMetadataFlow` returns `step-missing` for a self-build with the gate enabled and no `release-disposition` step, and the module source contains no skills-directory path literal.

**Files:**
- src/conductor/src/engine/self-host/release-metadata-flow.ts — new
- src/conductor/test/engine/self-host/release-metadata-flow.test.ts — new

**Dependencies:** none

### Task 12: Move the release-metadata snapshot and restore into the self-host area
**Story:** 5
**Type:** refactor

**Steps:**
1. Write failing tests for snapshot and restore functions exported from the self-host module, with the GitHub CLI runner mocked at the process boundary.
2. Verify the tests fail (RED).
3. Move the pre-finish snapshot, the persisted-snapshot read, and the post-rewrite restore out of the conductor class into the Task 11 module as functions that take their GitHub runner, project root, and pull request identity as inputs. Keep every GitHub call routed through the same injected runner the conductor already uses, so the typed-error seam and the guarded operation inventory still see them; add no new GitHub write path. The conductor methods become thin delegates. Behavior is unchanged.
4. Verify the tests pass (GREEN).
5. Commit: "refactor(self-host): own the release-metadata snapshot and restore".

**Done when:**
- Given a draft body holding a valid release block, `snapshotReleaseMetadata` then `restoreReleaseMetadata` around a simulated body rewrite leaves a body containing the original block byte-for-byte, asserted on the mocked GitHub edit call's body argument.
- Given a draft body whose release block is malformed, `snapshotReleaseMetadata` rejects with the existing pre-finish snapshot error and the mocked GitHub runner records no edit call.
- Every GitHub invocation made by the moved functions goes through the injected runner argument, asserted by the mock receiving all calls and by the module importing no process-spawning API.

**Files:**
- src/conductor/src/engine/self-host/release-metadata-flow.ts — snapshot and restore
- src/conductor/src/engine/conductor.ts — delegate
- src/conductor/test/engine/self-host/release-metadata-snapshot.test.ts — new

**Dependencies:** Task 11

### Task 13: Wire activation and the missing-step halt into the self-host finish gates
**Story:** 5
**Type:** negative-path

**Steps:**
1. Write failing tests that drive the conductor's self-host finish gates with the self-host detector, GitHub runner, and halt writer mocked at their boundaries.
2. Verify the tests fail (RED).
3. Replace every use of the conductor's path-literal activation predicate with `resolveReleaseMetadataFlow`, and delete the predicate. In the self-host finish gates, on `step-missing` call the existing self-host halt writer with a reason naming the `release-disposition` step; that writer already records class needs-human through the central halt marker seam, which also produces the committed halt record and the central halt event. Return a failed gate verdict so the ready flip does not happen. On `active`, pass the retained draft's metadata to the release gate as today.
4. Verify the tests pass (GREEN).
5. Commit: "fix(self-host): halt by name when the release step is missing".

**Done when:**
- Driving the conductor's self-host finish gates on a self-build with the gate enabled and the step declared, the release gate mock receives the retained draft's parsed release metadata and the gates run before any ready-for-review call.
- On a self-build with the gate enabled and no `release-disposition` step, the self-host halt writer mock is called once with a reason containing `release-disposition`, the gates return a failed verdict, and the GitHub mock records no ready-for-review call.
- A test over the real halt writer with a temporary project root shows that halt is written with class `needs-human` and yields a committed halt record, and the conductor source no longer contains the skills-directory path literal for the release step.
- Driving the self-host finish gates on a self-build with the `release-disposition` skill directory renamed and the step's `skill` setting updated to match, the restored body still contains the `Release-*` block byte-for-byte and the release gate mock receives its parsed metadata.
- Driving `finish` on a repository that is not a self-build that declares a step named `release-disposition`, the snapshot and restore functions are never called and the step reaches the FINISH prerequisite observer only as an ordinary gating custom step.
- Driving `finish` on a self-build with the release-artifact gate disabled, the snapshot and restore functions are never called and the halt writer mock records no call for a missing step.

**Files:**
- src/conductor/src/engine/conductor.ts — activation call sites and self-host finish gates
- src/conductor/test/engine/self-host/release-metadata-flow-wiring.test.ts — new

**Dependencies:** Task 12

### Task 14: Give the release actions their own build entry and record the public exports
**Story:** 6
**Type:** happy-path

**Steps:**
1. Write a failing test that imports the package main entry module and compares its sorted export names with a committed list; and a failing test that the release actions entry module exports the seven release action names.
2. Verify the tests fail (RED).
3. Add a self-host entry module that re-exports `runReleaseMetadataCheckAction`, `runReleasePrAction`, `collectReleaseCandidates`, `renderReleaseCandidate`, `renderReleaseCandidateAudit`, `classifyReleasePublication`, and `runReleasePublisherAction` from their existing modules, which stay where they are. Register it as a bundler entry next to the existing secondary entry, following that precedent: a named entry emitted at a path mirroring its source path. Remove those seven re-exports from the main entry. Commit the recorded export list as a JSON file beside the test. Per the code-removal rule, the test asserts the surviving public surface, not the absence of particular names.
4. Verify the tests pass (GREEN).
5. Commit: "refactor(package): move release actions off the main entry".

**Done when:**
- The sorted export names of the package main entry module equal the committed recorded export list, asserted by the public-exports test.
- Adding an export to the main entry without updating the recorded list makes the public-exports test fail with a message naming the unexpected export, demonstrated by a test that feeds the comparer a synthetic extra name.
- The bundler configuration lists the release actions module as an entry, and importing that module yields functions for all seven release action names.
- The committed recorded export list contains none of the seven release action names, asserted by the public-exports test.

**Files:**
- src/conductor/src/index.ts — remove seven re-exports
- src/conductor/src/engine/self-host/release-actions.ts — new entry
- src/conductor/tsup.config.ts — entry
- src/conductor/test/public-exports.test.ts — new
- src/conductor/test/public-exports.json — new recorded list

**Dependencies:** none

### Task 15: Repoint the release workflows and prove their imports before merge
**Story:** 6
**Type:** happy-path

**Steps:**
1. Write a failing test that reads the three release workflow files, extracts each dynamic import specifier under the built output directory and the names destructured from it, maps the specifier to its bundler entry source, and checks that source module exports every name.
2. Verify the test fails (RED).
3. Change the dynamic imports in the release-metadata, release-pr, and release workflows from the main built entry to the built release actions entry. The check is static: it needs no build, so it runs in the ordinary suite before merge and covers the two workflows that only execute after merge.
4. Verify the test passes (GREEN).
5. Commit: "ci: import release actions from their own entry".

**Done when:**
- For each of the three release workflows, the workflow-import test resolves every built-output import specifier to a module registered as a bundler entry and finds every destructured name among that module's exports.
- Fed a synthetic workflow that destructures a name the entry does not export, the workflow-import checker fails with a message containing both the workflow file name and the missing name.
- No release workflow imports a release action from the main built entry, asserted by the same test over the real workflow files.

**Files:**
- .github/workflows/release-metadata.yml — import path
- .github/workflows/release-pr.yml — import path
- .github/workflows/release.yml — import paths
- src/conductor/test/release-workflow-imports.test.ts — new

**Dependencies:** Task 14

### Task 16: Keep the release-metadata check identical through the new entry
**Story:** 6
**Type:** negative-path

**Steps:**
1. Write failing tests that import the release-metadata check action from the release actions entry and run it over pull request bodies.
2. Verify the tests fail (RED).
3. Expected to pass once Task 14 lands; fix only a defect in how the entry re-exports the action. The action module itself is unchanged.
4. Verify the tests pass (GREEN).
5. Commit: "test(release): metadata check behaves identically through its new entry".

**Done when:**
- Imported from the release actions entry, `runReleaseMetadataCheckAction` accepts a body with a valid note disposition and a body with the no-note disposition, returning success for both.
- Imported from the release actions entry, `runReleaseMetadataCheckAction` fails closed for a body with no release metadata section and for one with a category outside the six allowed values, with the same error text as when imported from its own module.

**Files:**
- src/conductor/test/release-actions-entry.test.ts — new

**Dependencies:** Task 14

### Task 17: Confirm the consumer-facing release boundary still holds
**Story:** 6
**Type:** verification

**Steps:**
1. Confirm existing coverage rather than adding code: the engineer hand-off release-metadata tests, and the shipped consumer pull request template.
2. If either observation does not hold on this branch, stop and report it as a defect in the task that caused it; this task lands no production change.
3. Complete with an empty commit carrying `Evidence: skipped` and the observations.

**Done when:**
- The shipped consumer pull request template under the templates directory contains no `Release-Disposition` text, observed by reading the file on this branch.
- The existing engineer hand-off release-metadata tests, which cover injection for a repository whose pull request template opts in, are unmodified by this branch and their subject module still imports the shared release-metadata parser from the general engine, observed from the branch diff and the import line.

**Files:** none

**Verify-only:** yes

**Dependencies:** Task 14

## Task Dependency Graph

```text
1 ─┐
2 ─┴─> 3 ─> 4 ─> 5 ─> 6 ─> 7
8 ─> 9 ─> 10
11 ─> 12 ─> 13
14 ─┬─> 15
    ├─> 16
    └─> 17
```

## Integration Points

- After Task 7: a custom-gate refusal is observable end to end through the production FINISH coordinator and the persisted event log. Task 7 owns this boundary.
- After Task 10: custom-step dispatch is observable through the provider step runner's dispatch entry on both paths. Tasks 9 and 10 own this boundary.
- After Task 13: release-flow activation and the missing-step halt are observable through the conductor's self-host finish gates. Task 13 owns this boundary.
- After Task 15: the release workflows resolve against the bundler entries. Task 15 owns this boundary.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: **Given** a repository other than ai-conductor declares gating custom step `compliance-gate` with `completion_artifact: .pipeline/compliance-pass`, the step is `done`, and the marker was written during this feature run, **When** FINISH observes its publication prerequisites, **Then** release readiness is valid and publication proceeds. | 3 | "Through the production FINISH coordinator, a single gating custom step `compliance-gate` that is `done` with a marker newer than the feature run start yields a valid release-readiness verification and the publication transition proceeds, asserted by the coordinator test." | diff-local |
| Story 1 happy: **Given** a repository declares two such gating custom steps and both are `done` with markers written during this feature run, **When** FINISH observes its publication prerequisites, **Then** release readiness is valid. | 3 | "Through the production FINISH coordinator, two gating custom steps both `done` with fresh markers yield a valid release-readiness verification." | diff-local |
| Story 1 happy: **Given** a gating custom step's marker was written during this feature run and the conductor process restarted before FINISH, **When** the resumed FINISH observes its publication prerequisites, **Then** the marker is still accepted as fresh and release readiness is valid. | 5 | "Through the production FINISH coordinator, a second observer instance constructed after a simulated restart yields a valid release-readiness verification for a marker written after the feature run start and before the restart." | diff-local |
| Story 1 negative: **Given** gating custom step `compliance-gate` is declared with a marker and its state is `pending`, `in_progress`, or `failed`, **When** FINISH observes its publication prerequisites, **Then** release readiness is missing and publication does not proceed. | 4 | "Through the production FINISH coordinator, `compliance-gate` recorded as `pending`, `in_progress`, or `failed` yields a missing release-readiness verification and no publication transition is attempted, asserted for each status." | diff-local |
| Story 1 negative: **Given** two such gating custom steps where one is `done` with a fresh marker and the other's marker file is absent, **When** FINISH observes its publication prerequisites, **Then** release readiness is missing and publication does not proceed. | 4 | "Through the production FINISH coordinator, one step `done` and fresh alongside a second step whose marker file is absent yields a missing release-readiness verification and no publication transition is attempted." | diff-local |
| Story 1 negative: **Given** a gating custom step is `done` and its marker's modification time is earlier than this feature run's start, **When** FINISH observes its publication prerequisites, **Then** release readiness is invalid and publication does not proceed. | 5 | "Through the production FINISH coordinator, a marker older than the feature run start yields an invalid release-readiness verification and no publication transition is attempted." | diff-local |
| Story 1 negative: **Given** a gating custom step is `done` and its marker path is a directory or symbolic link rather than a regular file, **When** FINISH observes its publication prerequisites, **Then** release readiness is invalid and publication does not proceed. | 5 | "Through the production FINISH coordinator, a marker path that is a directory or a symbolic link yields an invalid release-readiness verification and no publication transition is attempted." | diff-local |
| Story 1 negative: **Given** a gating custom step is `done` with a marker and the feature run start is unavailable in state, **When** FINISH observes its publication prerequisites, **Then** release readiness is indeterminate and publication does not proceed. | 5 | "Through the production FINISH coordinator, a `done` step with no finite feature run start in state yields an indeterminate release-readiness verification and no publication transition is attempted." | diff-local |
| Story 2 happy: **Given** a repository declares no custom steps, **When** FINISH observes its publication prerequisites, **Then** release readiness is valid exactly as before this change and no marker is read. | 3 | "For a configuration with no custom steps the production observer returns `present` and a spy on the filesystem stat call records zero calls." | diff-local |
| Story 2 happy: **Given** a gating custom step with a marker that is ordered after `finish`, **When** FINISH observes its publication prerequisites, **Then** that step is not required and FINISH can complete. | 6 | "With a gating custom step declared `after: finish` whose marker is absent, the production observer returns `present`, so FINISH is not blocked by a step that runs after it." | diff-local |
| Story 2 negative: **Given** a custom step declared with `enforcement: advisory` and a marker that is absent, **When** FINISH observes its publication prerequisites, **Then** that step is not required and release readiness is valid. | 6 | "With an `enforcement: advisory` custom step whose marker is absent, the production observer returns `present`." | diff-local |
| Story 2 negative: **Given** a gating custom step declared without `completion_artifact` whose state is `done`, **When** FINISH observes its publication prerequisites, **Then** that step is not required and release readiness is valid. | 6 | "With a gating custom step that declares no `completion_artifact` and is `done`, the production observer returns `present`." | diff-local |
| Story 2 negative: **Given** a gating custom step with a marker whose recorded status is `skipped`, **When** FINISH observes its publication prerequisites, **Then** release readiness is missing because of that step, since a gating custom step can never be legitimately skipped. | 4 | "With a gating custom step whose recorded status is `skipped`, the production observer returns `missing` naming that step." | diff-local |
| Story 2 negative: **Given** a gating custom step ordered after `finish` and a gating custom step ordered before `finish` whose marker is stale, **When** FINISH observes its publication prerequisites, **Then** release readiness is invalid because of the step ordered before `finish` only. | 6 | "With one gating step declared `after: finish` and one ordered before `finish` whose marker is stale, the production observer returns `stale` naming only the step ordered before `finish`." | diff-local |
| Story 3 happy: **Given** gating custom step `compliance-gate` is the only unsatisfied prerequisite, **When** FINISH reports the blocked release-readiness condition, **Then** the operator-visible reason contains the step key `compliance-gate` and the existing condition code is unchanged. | 2 | "With the port returning `missing` for step `compliance-gate`, the coordinator reports condition code `release_readiness_missing` whose message contains `compliance-gate` and whose `steps` field equals that one key." | diff-local |
| Story 3 happy: **Given** gating custom steps `compliance-gate` and `notes-gate` are both unsatisfied, **When** FINISH reports the blocked release-readiness condition, **Then** the operator-visible reason names both step keys. | 2 | "With the port returning two unsatisfied keys, the blocked condition message and `steps` field carry both `compliance-gate` and `notes-gate`." | diff-local |
| Story 3 negative: **Given** every gating custom step prerequisite is satisfied, **When** FINISH completes publication, **Then** no blocked release-readiness condition is reported and no step key appears in a refusal. | 2 | "With the port returning `present`, the coordinator reports no release-readiness blocked condition and completes publication, and a test enumerating the blocked condition codes and dispositions finds the same sets as on the base commit." | diff-local |
| Story 3 negative: **Given** release readiness is indeterminate because the feature run start is unavailable, **When** FINISH reports the blocked condition, **Then** the reason names the affected step keys and keeps the indeterminate condition code rather than reporting missing or invalid. | 2 | "With the port returning `unavailable` and keys, the coordinator reports `release_readiness_indeterminate` carrying those keys, and never `release_readiness_missing` or `release_readiness_invalid`." | diff-local |
| Story 3 negative: **Given** a custom step key that is not a built-in step name is named in a refusal, **When** the refusal is emitted and persisted as an event, **Then** the event is accepted by the existing event pipeline without the key being recorded as a built-in step. | 7 | "That event, written by the event persister and read back from the run's persisted event log, still carries `compliance-gate` in the condition's `steps` field, and no field typed as a built-in step name holds that key." | diff-local |
| Story 4 happy: **Given** custom step `docs-gate` whose `skill` points at a valid skill file named `maintain-documentation`, **When** the step is dispatched to Claude, **Then** the provider is asked to run the `maintain-documentation` skill and pipeline state stays keyed by `docs-gate`. | 9 | "For custom step `docs-gate` configured with a skill file named `maintain-documentation`, the Claude provider mock receives the prompt `/maintain-documentation` and conductor state is updated under the key `docs-gate`." | diff-local |
| Story 4 happy: **Given** the same custom step is routed to Codex, **When** the step is dispatched, **Then** the provider is asked to run the `maintain-documentation` skill using Codex's invocation form rather than Claude's. | 9 | "The same step routed to Codex gives the provider mock the prompt `$maintain-documentation`." | diff-local |
| Story 4 happy: **Given** ai-conductor's own `maintain-documentation` and `release-disposition` steps, whose keys equal their skill names, **When** each is dispatched, **Then** the provider receives the same invocation it received before this change. | 9 | "For this repository's `maintain-documentation` and `release-disposition` steps the captured Claude prompts equal the prompts captured on the base commit, asserted against recorded strings." | diff-local |
| Story 4 happy: **Given** a custom step dispatched through provider fallback to a second provider, **When** the second candidate is tried, **Then** it is asked for the same configured skill in that provider's own invocation form. | 10 | "Through the provider step runner's dispatch entry with two candidates, the first mock receives `/maintain-documentation` and, after it fails over, the second receives `$maintain-documentation`." | diff-local |
| Story 4 negative: **Given** custom step `docs-gate` whose configured skill is named differently from the step key, **When** the provider prompt is built, **Then** the step key is never substituted as the skill to run. | 9 | "In no captured prompt for `docs-gate` does the string `docs-gate` appear as the invoked skill, and a resolution failure produces zero provider mock calls and a failure reason containing both `docs-gate` and the configured path." | diff-local |
| Story 4 negative: **Given** a custom step whose configured skill file exists but declares no skill name, **When** configuration is validated or the step is dispatched, **Then** the run fails closed with a reason naming both the step key and the configured skill path, and no provider call is made. | 9 | "Dispatching a custom step whose configured skill file exists but declares no `name` fails closed with a reason containing both the step key and the configured skill path, and the provider mock records zero calls." | diff-local |
| Story 4 negative: **Given** a custom step whose configured skill file is removed after configuration was loaded, **When** the step is dispatched, **Then** the run fails closed with a reason naming both the step key and the configured skill path, and no provider call is made. | 9 | "Dispatching a custom step whose configured skill file was removed after configuration load fails closed with a reason containing both the step key and the configured skill path, and the provider mock records zero calls." | diff-local |
| Story 4 negative: **Given** a built-in step with a `skill` override, **When** it is dispatched, **Then** its invocation is unchanged by this work. | 9 | "A built-in step configured with a `skill` override yields the same captured prompt as on the base commit." | diff-local |
| Story 5 happy: **Given** an ai-conductor self-build with the release-artifact gate enabled and the `release-disposition` step declared, **When** `finish` rewrites the retained draft pull request body, **Then** the `Release-*` metadata block written by the step is present afterward, byte-for-byte. | 12 | "Given a draft body holding a valid release block, `snapshotReleaseMetadata` then `restoreReleaseMetadata` around a simulated body rewrite leaves a body containing the original block byte-for-byte, asserted on the mocked GitHub edit call's body argument." | diff-local |
| Story 5 happy: **Given** the same self-build and the `release-disposition` skill directory has been renamed with the step's `skill` setting updated to match, **When** `finish` rewrites the body, **Then** the `Release-*` metadata block is still preserved and the release gate still receives it. | 13 | "Driving the self-host finish gates on a self-build with the `release-disposition` skill directory renamed and the step's `skill` setting updated to match, the restored body still contains the `Release-*` block byte-for-byte and the release gate mock receives its parsed metadata." | diff-local |
| Story 5 happy: **Given** the same self-build, **When** the self-host finish gates run, **Then** the release gate receives the retained draft's release metadata as it does today and the draft is not marked ready before those gates pass. | 13 | "Driving the conductor's self-host finish gates on a self-build with the gate enabled and the step declared, the release gate mock receives the retained draft's parsed release metadata and the gates run before any ready-for-review call." | diff-local |
| Story 5 negative: **Given** an ai-conductor self-build with the release-artifact gate enabled and no `release-disposition` step declared, **When** the self-host finish gates run, **Then** the run halts for a human with a reason naming the `release-disposition` step, a committed halt record is produced, and the pull request is not marked ready. | 13 | "On a self-build with the gate enabled and no `release-disposition` step, the self-host halt writer mock is called once with a reason containing `release-disposition`, the gates return a failed verdict, and the GitHub mock records no ready-for-review call." | diff-local |
| Story 5 negative: **Given** a repository that is not an ai-conductor self-build and that declares a step named `release-disposition`, **When** `finish` runs, **Then** no release-metadata snapshot or restore is attempted and FINISH treats that step only as an ordinary gating custom step. | 13 | "Driving `finish` on a repository that is not a self-build that declares a step named `release-disposition`, the snapshot and restore functions are never called and the step reaches the FINISH prerequisite observer only as an ordinary gating custom step." | diff-local |
| Story 5 negative: **Given** an ai-conductor self-build with the release-artifact gate disabled, **When** `finish` runs, **Then** no release-metadata snapshot or restore is attempted and no halt is raised for a missing step. | 13 | "Driving `finish` on a self-build with the release-artifact gate disabled, the snapshot and restore functions are never called and the halt writer mock records no call for a missing step." | diff-local |
| Story 5 negative: **Given** an active release flow whose retained draft body holds a malformed `Release-*` block, **When** the pre-finish snapshot is taken, **Then** the run refuses as it does today rather than publishing without metadata. | 12 | "Given a draft body whose release block is malformed, `snapshotReleaseMetadata` rejects with the existing pre-finish snapshot error and the mocked GitHub runner records no edit call." | diff-local |
| Story 6 happy: **Given** the built conductor package, **When** its main entry point's exports are listed, **Then** they equal the recorded consumer-facing export list, which contains no ai-conductor release-policy action. | 14 | "The committed recorded export list contains none of the seven release action names, asserted by the public-exports test." | diff-local |
| Story 6 happy: **Given** the built package, **When** each of `release-metadata.yml`, `release-pr.yml`, and `release.yml` resolves its import, **Then** the imported file exists in the build output and exports every name that workflow uses. | 15 | "For each of the three release workflows, the workflow-import test resolves every built-output import specifier to a module registered as a bundler entry and finds every destructured name among that module's exports." | diff-local |
| Story 6 happy: **Given** a pull request in this repository with valid release metadata, **When** the release-metadata check runs from its repository-local entry, **Then** it passes exactly as before. | 16 | "Imported from the release actions entry, `runReleaseMetadataCheckAction` accepts a body with a valid note disposition and a body with the no-note disposition, returning success for both." | diff-local |
| Story 6 negative: **Given** a change that adds a new export to the main entry point without updating the recorded consumer-facing list, **When** the export-list check runs, **Then** it fails naming the unexpected export. | 14 | "Adding an export to the main entry without updating the recorded list makes the public-exports test fail with a message naming the unexpected export, demonstrated by a test that feeds the comparer a synthetic extra name." | diff-local |
| Story 6 negative: **Given** a change that renames or drops a name one of the three release workflows imports, **When** the pre-merge workflow-import check runs, **Then** it fails naming the workflow and the missing name, before merge. | 15 | "Fed a synthetic workflow that destructures a name the entry does not export, the workflow-import checker fails with a message containing both the workflow file name and the missing name." | diff-local |
| Story 6 negative: **Given** a pull request in this repository with missing or malformed release metadata, **When** the release-metadata check runs from its repository-local entry, **Then** it fails closed exactly as before. | 16 | "Imported from the release actions entry, `runReleaseMetadataCheckAction` fails closed for a body with no release metadata section and for one with a category outside the six allowed values, with the same error text as when imported from its own module." | diff-local |
| Story 6 negative: **Given** a freshly bootstrapped consumer repository, **When** its generated pull request template is inspected, **Then** it contains no `Release-Disposition` contract, as today. | 17 | "The shipped consumer pull request template under the templates directory contains no `Release-Disposition` text, observed by reading the file on this branch." | diff-local |
| Story 6 negative: **Given** a registered repository whose own pull request template opts into release metadata, **When** the composer opens a spec pull request there, **Then** the release disposition is still injected as it is today. | 17 | "The existing engineer hand-off release-metadata tests, which cover injection for a repository whose pull request template opts in, are unmodified by this branch and their subject module still imports the shared release-metadata parser from the general engine, observed from the branch diff and the import line." | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-07-25-custom-step-completion-artifacts#D1 | no-change | none | This feature adds no configuration key and does not touch `completion_artifact` path validation; decision 1 keeps governing it unchanged. |
| adr-2026-07-25-custom-step-completion-artifacts#D2 | existing | none | Completion-check detection for a custom step with a configured marker already exists and is reused unmodified; this feature reads the same key for a second consumer. |
| adr-2026-07-25-custom-step-completion-artifacts#D3 | task | task-5 | A marker whose modification time is earlier than the feature run start makes the production observer return `stale` |
| adr-2026-07-25-custom-step-completion-artifacts#D4 | no-change | none | Marker creation stays owned by the step's skill; the engine still only observes the marker and never writes it. |
| adr-2026-07-25-custom-step-completion-artifacts#D5 | no-change | none | No built-in completion predicate or artifact glob is changed; only the custom-step FINISH prerequisite is generalized. |
| adr-2026-07-25-custom-step-completion-artifacts#D6 | task | task-3, task-4 | With a gating custom step whose recorded status is `skipped`, the production observer returns `missing` naming that step. |

## Verification

- [x] All happy path criteria covered by at least one task
- [x] All negative path criteria covered by at least one task
- [x] Every task has a `Done when:` block of falsifiable checks naming a mechanism
- [x] Every story is cited by at least one task
- [x] Each changed cross-boundary behavior has one integration-owning task (7, 9 and 10, 13, 15)
- [x] No terminal catch-all validation task
- [x] Dependencies are explicit and acyclic
