# Implementation Plan: Per-feature step applicability (#1789)

**Date:** 2026-10-03
**Design:** .docs/specs/step-applicability-is-fixed-repo-wide-decide-canno.md
**Stories:** .docs/stories/step-applicability-is-fixed-repo-wide-decide-canno.md
**Conflict check:** Clean as of 2026-10-03

## Summary

A project-only, default-off toggle lets a feature's merged DECIDE marker declare `acceptance_specs` or `manual_test` inapplicable, each with a reason. The land gate validates the marker. The daemon reads it only from the base branch and honors it only for steps still `pending`, recording a distinct cause, decider, and event. 16 tasks.

## Technical Approach

- **Config (Task 1):** `feature_applicability.enabled` (default false) is resolved from the project file only, so a user-level value never changes a project's pipeline. It is registered in the config-consumer registry.
- **Metadata (Task 2):** `StepDefinition.featureInapplicableAllowed` is set only on `acceptance_specs` and `manual_test`. `isFeatureDeclarable` rejects every other built-in and every custom step. This is the single declarability authority.
- **Marker and validator (Tasks 3-5):** `parseApplicability` in `artifacts.ts` beside `parseTrack`, and `validateApplicability` in a new `engine/feature-applicability.ts`, which composes parse, declarability, duplicate, and toggle checks into one closed failure set. `landSpec` and the daemon backlog both call this one validator. `landSpec` adds the `applicability-invalid` gate and reuses `pickIdeaFile` for the stem contract.
- **Attribution (Task 7):** `resolveMarkerDecider` beside `firstAppearanceTime` reads the latest first-parent base commit touching the marker and returns author, committer, and sha, or `unknown`. It is an audit label only.
- **Seeding (Task 8):** `discoverBacklog` reads the marker through `BacklogTreeSource` with `readFeatureMarker`, which supplies the stem and undated fallback and the ambiguity refusal. It validates the marker, attributes it, and carries it on `BacklogItem`. `deriveDaemonBaseState` seeds `ConductState.applicability_declarations` (declarations, or an ignored cause, plus a base-content hash) through the mutation port. Interactive runs never get this field.
- **Dispatch (Tasks 9-13):** the conductor's skip resolution, beside tier, track, and config skips, honors a seeded declaration only when the toggle is on and the step is `pending`. Honoring calls `recordStepSkip` with cause `inapplicable: <reason>`, appends to `ConductState.feature_inapplicable`, and emits `step_inapplicable`. Other cases:
  - a step not `pending` emits `step_inapplicable_refused`;
  - a step already in `feature_inapplicable` is left skipped;
  - a worktree or base hash mismatch emits `branch-only`, an absent seed emits `interactive`, and seeded ignored causes are emitted as they are.

  The same check runs before validation-group membership is computed.
- **Events (Task 6):** three `ConductorEvent` variants with total sink-registry rows and metrics-listener cases. Reasons and identities stay off metric labels.
- **Rendering (Tasks 14-15):** a dedicated dashboard icon with the reason, and per-feature `inapplicable:` lines in daemon status.
- **Downstream (Task 16):** verification that prerequisites, finish ship evidence, and coverage_binding's model-free layers treat the skip as satisfied.

## Prerequisites

- None. ADR adr-2026-10-03-per-feature-step-applicability is APPROVED in this change set.

## Tasks

### Task 1: Project-only `feature_applicability.enabled` config toggle, default off
**Story:** 1
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/feature-applicability-config.test.ts`. Cover: an absent block resolves disabled; `feature_applicability: { enabled: true }` in the project config resolves enabled; `enabled: "yes"` fails validation naming `feature_applicability.enabled` and the boolean type; an unknown key `enabeld` fails naming that key; a user-level config with `enabled: true` and a project config without the block resolves disabled for that project.
2. Verify RED.
3. Implement in `src/conductor/src/types/config.ts` (a `FeatureApplicabilityConfig` type with `enabled?: boolean`), `src/conductor/src/engine/config.ts` (add `feature_applicability` to the top-level consumer key set, validate the block like the existing `build_progress` block, and resolve it from the project file only), and `src/conductor/src/engine/resolved-config.ts` (resolved `featureApplicability.enabled`, default false). Pattern: the `spec_owner` handling in `engine/config.ts` (search `spec_owner can only have come from the USER`) is the precedent for a key whose source layer is restricted. This key is the inverse: project-only. Ignore a user-layer value rather than erroring, so that a user config never changes a project's pipeline.
4. Declare the production consumers (the land gate and the conductor dispatch skip resolution) in `src/conductor/test/engine/config-consumer-registry.ts`.
5. Verify GREEN and commit.

**Done when:**
- Resolved config returns `featureApplicability.enabled === false` for a project config with no `feature_applicability` block and `true` for a project config setting `feature_applicability: { enabled: true }`, as asserted in `test/engine/feature-applicability-config.test.ts`.
- `validateConfig` rejects `feature_applicability.enabled: "yes"` with an error naming `feature_applicability.enabled` and the expected boolean type, and rejects an unknown key inside the block with an error naming that unknown key.
- With a user-level config setting `feature_applicability.enabled: true` and a project config without the block, the resolved config for that project returns `featureApplicability.enabled === false`.
- `test/engine/config-consumer-registry.ts` declares the land gate and conductor dispatch as consumers of `feature_applicability.enabled`, and the registry completeness test passes.

**Files:** src/conductor/src/types/config.ts; src/conductor/src/engine/config.ts; src/conductor/src/engine/resolved-config.ts; src/conductor/test/engine/config-consumer-registry.ts; src/conductor/test/engine/feature-applicability-config.test.ts

**Dependencies:** none

### Task 2: Per-step declarability metadata for exactly two built-ins
**Story:** 4
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/steps.test.ts`. Assert that `isFeatureDeclarable(name, customStepNames)` returns true for exactly `acceptance_specs` and `manual_test` across `ALL_STEPS`. It returns false, with a `not-declarable` result naming the step, for `test_suite`, `build_review`, `finish`, `prd_audit`, `architecture_review_as_built`, `coverage_binding`, `build`, `rebase`, `plan`, `stories`, and a custom step name passed in `customStepNames`.
2. Verify RED.
3. Implement: add `featureInapplicableAllowed?: true` to `StepDefinition` in `src/conductor/src/types/steps.ts`. Set it on the `acceptance_specs` and `manual_test` definitions in `src/conductor/src/engine/steps.ts`. Add `isFeatureDeclarable` beside `getSkippableSteps`; it returns `{ ok: true }` or `{ ok: false, step, reason: "not-declarable" }`. Custom step definitions never carry the flag, and the function rejects any name in `customStepNames` before consulting built-ins.
4. Verify GREEN and commit.

**Done when:**
- `isFeatureDeclarable` returns ok for exactly `acceptance_specs` and `manual_test` when iterated over every built-in in `ALL_STEPS`, as asserted in `test/engine/steps.test.ts`.
- `isFeatureDeclarable` returns a `not-declarable` result naming the step for `test_suite`, `build_review`, `finish`, `prd_audit`, `architecture_review_as_built`, and `coverage_binding`.
- `isFeatureDeclarable` returns a `not-declarable` result naming the step for the structural steps `build` and `rebase` and the DECIDE-phase steps `plan` and `stories`.
- `isFeatureDeclarable` returns a `not-declarable` result naming the custom step for a name supplied in `customStepNames`, even when the name collides with nothing built in.

**Files:** src/conductor/src/types/steps.ts; src/conductor/src/engine/steps.ts; src/conductor/test/engine/steps.test.ts

**Dependencies:** none

### Task 3: Parse the applicability marker into ordered declarations
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/feature-applicability-marker.test.ts` for `parseApplicability(content)`. Cover:
   - one line `Inapplicable: acceptance_specs — no new behavior to specify` yields one declaration with that step and reason;
   - two declaration lines (manual_test, then acceptance_specs) surrounded by prose lines yield two declarations in file order;
   - a declaration line with an empty or whitespace-only reason yields an `empty-reason` error naming the 1-based line number;
   - a line starting `Inapplicable:` with no ` — ` separator yields a `malformed-line` error naming the line number.
2. Verify RED.
3. Implement `parseApplicability` in `src/conductor/src/engine/artifacts.ts` beside `parseTrack`. It returns `{ ok: true, declarations: { step: string, reason: string, line: number }[] }` or `{ ok: false, error: { kind: "empty-reason" | "malformed-line", line: number } }`. Only lines starting with `Inapplicable:` are declarations; every other line is prose. Accept an em dash or a plain ` - ` hyphen as the separator. Trim the step and the reason.
4. Verify GREEN and commit.

**Done when:**
- `parseApplicability` returns exactly one declaration `{ step: "acceptance_specs", reason: "no new behavior to specify" }` for a marker with that single declaration line, as asserted in `test/engine/feature-applicability-marker.test.ts`.
- `parseApplicability` returns two declarations in file order, manual_test then acceptance_specs, for a marker whose two declaration lines are surrounded by prose, and returns no entry for any prose line.
- `parseApplicability` returns an `empty-reason` error carrying the offending line number for a declaration whose reason is empty or whitespace only.
- `parseApplicability` returns a `malformed-line` error carrying the offending line number for an `Inapplicable:` line with no separator between step and reason.

**Files:** src/conductor/src/engine/artifacts.ts; src/conductor/test/engine/feature-applicability-marker.test.ts

**Dependencies:** none

### Task 4: Shared declaration validator and land acceptance of a valid marker
**Story:** 5
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/engineer/land-spec-applicability.test.ts` using the existing `land-spec.test.ts` fixture style (a real temporary git worktree with a complete Tier M artifact set). In an enabled project, a marker declaring `manual_test` with a non-empty reason lands, and the land commit contains the marker path alongside the plan, stories, and other DECIDE artifact paths. In an enabled project with no marker, land produces the same commit file list as without this feature.
2. Verify RED.
3. Implement `validateApplicability(content, { enabled, customStepNames })` in a new `src/conductor/src/engine/feature-applicability.ts`. It composes `parseApplicability` (Task 3) and `isFeatureDeclarable` (Task 2), and returns `{ ok: true, declarations }` or the first typed failure with its line: `capability-disabled`, `unknown-step` (the name is not in `ALL_STEPS` or `customStepNames`), `not-declarable`, `empty-reason`, `malformed-line`, or `duplicate-declaration`. The same validator is reused by the daemon backlog in Task 8.
4. In `src/conductor/src/engine/engineer/land-spec.ts`, after the tier-conditional block, resolve the applicability marker with `pickIdeaFile(join(worktreePath, ".docs", "applicability"), featureFiles)`. Run the validator with the project-only resolved toggle. Continue on ok; a failure is handled in Task 5.
5. Verify GREEN and commit.

**Done when:**
- `landSpec` succeeds for an enabled project whose idea worktree carries a marker declaring `manual_test` inapplicable with a non-empty reason, and the single land commit it creates lists the marker file in the same committed file list as the feature's plan, stories, and other DECIDE artifacts, as asserted in `test/engine/engineer/land-spec-applicability.test.ts`.
- `landSpec` for an enabled project whose idea worktree has no applicability marker succeeds with the same committed file list it produces when the capability is disabled, so markerless land behaves exactly as before this feature, as asserted in `land-spec-applicability.test.ts`.
- `validateApplicability` in `engine/feature-applicability.ts` returns ok with the parsed declarations for a valid marker and is the only validator imported by both `landSpec` and the daemon backlog.

**Files:** src/conductor/src/engine/feature-applicability.ts; src/conductor/src/engine/engineer/land-spec.ts; src/conductor/test/engine/engineer/land-spec-applicability.test.ts

**Dependencies:** Task 1, Task 2, Task 3

### Task 5: Land refuses every invalid declaration with a typed error
**Story:** 5
**Type:** negative-path

**Steps:**
1. Extend `land-spec-applicability.test.ts` with one case each. In an enabled project, the marker declares an unknown step `nonexistent_step`, declares `test_suite`, has an empty reason, or declares `manual_test` twice. In a disabled project, the worktree carries any marker. In an enabled project, the marker is filed under a stem that differs from the plan stem.
2. Verify RED.
3. In `src/conductor/src/engine/engineer/land-spec.ts`, add `applicability-invalid` to `LandGateIdentifier`. When `validateApplicability` fails, throw `landGateError("applicability-invalid", ...)`; the message names the failure kind, the step when there is one, and the marker line number. The stem mismatch keeps flowing through `pickIdeaFile`'s existing `artifact-stem-mismatch` error.
4. Verify GREEN and commit.

**Done when:**
- `landSpec` throws a `LandGateError` with gate `applicability-invalid` whose message names `unknown-step`, the step `nonexistent_step`, and the marker line for an enabled project declaring an unknown step.
- `landSpec` throws gate `applicability-invalid` naming `not-declarable` and `test_suite` for a marker declaring test_suite, and naming `empty-reason` and the line for a declaration with an empty reason.
- `landSpec` throws gate `applicability-invalid` naming `duplicate-declaration` and `manual_test` for a marker declaring manual_test twice.
- `landSpec` throws gate `applicability-invalid` naming `capability-disabled` and the marker path when the project has the capability disabled and the worktree carries a marker.
- `landSpec` throws the existing `artifact-stem-mismatch` gate error for an applicability marker filed under a stem other than the plan stem, and no refused land creates a commit.

**Files:** src/conductor/src/engine/engineer/land-spec.ts; src/conductor/test/engine/engineer/land-spec-applicability.test.ts

**Dependencies:** Task 4

### Task 6: Three applicability event variants on the spine with sink rows and metrics export
**Story:** 9
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/event-sinks.test.ts` and `src/conductor/test/engine/otel/metrics-listener.test.ts`. The tests cover:
   - sink rows `{ render: true, persist: true, audit: false, otel: true }` for `step_inapplicable`, `step_inapplicable_ignored`, and `step_inapplicable_refused`;
   - the metrics listener recording one counter increment per event, labelled only by event type, step, and cause or prior status;
   - no reason, decider, or commit text appearing as a metric label.
2. Verify RED.
3. Add to the `ConductorEvent` union in `src/conductor/src/types/events.ts`:
   - `step_inapplicable { step, reason, decider: { author, committer } | "unknown", commit?: string }`;
   - `step_inapplicable_ignored { cause: "branch-only" | "toggle-off" | "invalid" | "interactive", step?: string, detail?: string }`;
   - `step_inapplicable_refused { step, reason, priorStatus: StepStatus }`.

   Add the three rows to `EVENT_SINKS` in `src/conductor/src/engine/event-sinks.ts`, and the three cases to `src/conductor/src/engine/otel/metrics-listener.ts`.
4. Verify GREEN and commit.

**Done when:**
- `EVENT_SINKS` holds a `{ render: true, persist: true, audit: false, otel: true }` row for each of `step_inapplicable`, `step_inapplicable_ignored`, and `step_inapplicable_refused`, as asserted in `test/engine/event-sinks.test.ts`.
- The metrics listener increments one counter per applicability event whose labels are limited to event type, step, and cause or prior status, as asserted in `test/engine/otel/metrics-listener.test.ts`.
- No metric label emitted for an applicability event contains the declared reason, the decider identity, or the commit sha.

> **Amended 2026-10-04 (operator-approved plan-gap recovery):** No existing `MetricsRecorder` instrument carries the event-type/step/cause-or-prior-status labels, so the listener cases need a recorder projection. Task 6 also owns one bounded counter, `conductor.step.applicability`, and its recorder method in `src/conductor/src/engine/otel/metrics.ts`. Reason, decider and commit text never become labels.

**Files:** src/conductor/src/types/events.ts; src/conductor/src/engine/event-sinks.ts; src/conductor/src/engine/otel/metrics-listener.ts; src/conductor/src/engine/otel/metrics.ts; src/conductor/test/engine/event-sinks.test.ts; src/conductor/test/engine/otel/metrics-listener.test.ts

**Dependencies:** none

### Task 7: Resolve the decider from the latest first-parent base commit touching the marker
**Story:** 10
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/owner-gate/merge-time.test.ts` against real temporary git repositories:
   - a squash-style base commit authored by `Op Erator <operator@example.com>` with a distinct committer yields that author, that committer, and the commit sha;
   - a second base commit amending the marker yields the second commit's identities and sha;
   - a marker changed only inside a branch merged with a merge commit yields the merge commit's identities, not the inner commit's;
   - an unknown base ref, or a path with no history, yields `unknown` with no sha.
2. Verify RED.
3. Implement `resolveMarkerDecider(projectRoot, baseRef, relPath)` in `src/conductor/src/engine/owner-gate/merge-time.ts` beside `firstAppearanceTime`. Run `git log -1 --first-parent <base> --format=%H%x00%an <%ae>%x00%cn <%ce> -- <path>` and return `{ author, committer, commit }` or `{ decider: "unknown", commit?: string }`. A git failure returns unknown and never throws. Pattern: `firstAppearanceTime`'s execFile usage and its fail-soft handling.
4. Verify GREEN and commit.

**Done when:**
- `resolveMarkerDecider` returns author `Op Erator <operator@example.com>`, the commit's committer identity, and the commit sha for a marker introduced by that squash-style base commit, as asserted in `test/engine/owner-gate/merge-time.test.ts`.
- `resolveMarkerDecider` returns the second commit's author, committer, and sha when a later first-parent base commit amended the marker.
- `resolveMarkerDecider` returns the first-parent merge commit's identities and sha, not the inner branch commit's, when the marker changed only inside a merged branch.
- `resolveMarkerDecider` returns decider `unknown` without throwing when the base ref or the marker history cannot be resolved, carrying a sha only when git reported one.
- No caller passes the `resolveMarkerDecider` result to `resolveDaemonOwner` or any authorization check; a source-scan test over `engine/owner-gate/` and `engine/daemon-backlog.ts` asserts the only consumer is the applicability seed.

**Files:** src/conductor/src/engine/owner-gate/merge-time.ts; src/conductor/test/engine/owner-gate/merge-time.test.ts

**Dependencies:** none

### Task 8: Daemon backlog reads, validates, attributes, and seeds the base marker
**Story:** 7
**Story:** 6
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/daemon-backlog-applicability.test.ts` using an injected `treeSource` and decider stub. The tests cover:
   - a valid base marker for feature A seeds `applicability_declarations` with its declarations, decider, commit, and a sha256 of the base content;
   - feature B with a different undated stem gets an empty declaration list;
   - two plans whose undated stems collide with the marker stem leave the declarations empty and log the ambiguity, as the tier and track markers do;
   - a base marker declaring `prd_audit` seeds an ignored cause `invalid` with the failure, and nothing is declared;
   - a `treeSource.readFile` that throws seeds nothing declared and logs the marker path;
   - the capability disabled with a base marker seeds ignored cause `toggle-off`.
2. Verify RED.
3. In `src/conductor/src/engine/daemon-backlog.ts`, read `.docs/applicability` with `readFeatureMarker` beside the track marker, wrapped in try/catch so that a read failure logs the path and yields no declarations. Validate with `validateApplicability` (Task 4) using the daemon's project-only resolved toggle, then resolve the decider with `resolveMarkerDecider` (Task 7) at the claim-pinned base ref.
4. Carry the result on `BacklogItem` in `src/conductor/src/engine/daemon.ts`. Widen `deriveDaemonBaseState` in `src/conductor/src/engine/daemon-state.ts` to seed `applicability_declarations` on `ConductState` in `src/conductor/src/types/state.ts`; an empty array when there is no marker. Write it through the conduct-state mutation port. Thread the toggle through `src/conductor/src/daemon-cli.ts`.
5. Verify GREEN and commit.

**Done when:**
- For a valid base marker on feature A, read through the backlog tree source at the claim-pinned base ref, `discoverBacklog` yields a `BacklogItem` whose declarations carry each step, reason, decider, and commit (a declaration whose decider resolves `unknown` is still seeded, with decider `unknown` and the sha when one is available), and `deriveDaemonBaseState` seeds them into `ConductState.applicability_declarations` with the sha256 of the base marker content, as asserted in `test/engine/daemon-backlog-applicability.test.ts`.
- Feature B, whose undated stem differs from feature A's marker stem, is seeded with an empty declaration list.
- When two plans' undated stems collide with the marker stem, the seeded declarations are empty and the ambiguity is logged in the same form as the tier and track marker ambiguity.
- A base marker that fails `validateApplicability`, such as one declaring `prd_audit`, seeds the ignored cause `invalid` with the failure kind and step and no declarations; a capability-disabled project with a base marker seeds ignored cause `toggle-off`.
- A `treeSource.readFile` that throws for the marker path seeds no declarations and logs a line naming the marker path, and the backlog scan continues.

**Files:** src/conductor/src/engine/daemon-backlog.ts; src/conductor/src/engine/daemon.ts; src/conductor/src/engine/daemon-state.ts; src/conductor/src/types/state.ts; src/conductor/src/daemon-cli.ts; src/conductor/test/engine/daemon-backlog-applicability.test.ts

**Dependencies:** Task 1, Task 2, Task 3, Task 4, Task 7

### Task 9: Dispatch honors a pending declared step for its feature only
**Story:** 6
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/conductor-feature-applicability.test.ts` using the conductor test harness (fake StepRunner, auto mode, seeded daemon base state). Cover:
   - feature A seeded with an `acceptance_specs` declaration skips that step, and the runner never receives it;
   - feature B with empty declarations runs `acceptance_specs`;
   - `manual_test` pending with a declaration is skipped;
   - the persisted events include `step_inapplicable` naming the step, reason, decider, and commit, and the metrics listener receives it.
2. Verify RED.
3. In `src/conductor/src/engine/conductor.ts`, inside the linear dispatch loop's skip resolution, beside the tier, track, and config skips, add the applicability check. When the resolved toggle is on and `state.applicability_declarations` holds a declaration for the step, and the step's observed status is `pending`:
   - call `recordStepSkip(state, step, "inapplicable: <reason>")`;
   - append `{ step, reason, decider, commit }` to `ConductState.feature_inapplicable` through the mutation port;
   - emit `step_inapplicable`.
4. Verify GREEN and commit.

**Done when:**
- For feature A seeded with an `acceptance_specs` declaration, dispatch records `acceptance_specs` as `skipped` with skip cause `inapplicable: <reason>` and the fake StepRunner never receives `acceptance_specs`, as asserted in `test/engine/conductor-feature-applicability.test.ts`.
- For feature B seeded with an empty declaration list in the same repository, the fake StepRunner receives `acceptance_specs` and it completes normally.
- For a seeded `manual_test` declaration whose status is `pending`, including one whose decider is `unknown`, dispatch records `manual_test` as skipped and appends `{ step, reason, decider, commit }` to `ConductState.feature_inapplicable` through the mutation port.
- Each honored declaration persists exactly one `step_inapplicable` event naming the step, reason, decider, and commit in `.pipeline/events.jsonl`, and the metrics listener receives that event.
- In a run where one step is tier-skipped and another is config-disabled, zero `step_inapplicable` events are persisted for either of those steps.

**Files:** src/conductor/src/engine/conductor.ts; src/conductor/test/engine/conductor-feature-applicability.test.ts

**Dependencies:** Task 6, Task 8

### Task 10: A disabled repository or an empty seed dispatches exactly as before
**Story:** 2
**Type:** negative-path

**Steps:**
1. Extend `src/conductor/test/engine/conductor-feature-applicability.test.ts` with the capability disabled. Cover:
   - a feature with no marker records the same step-status map and the same skip events as a baseline run captured with no applicability fields in state;
   - a tier-S feature records its tier skips with the existing `tier_skip` events;
   - a seed carrying ignored cause `toggle-off` for a `manual_test` marker runs `manual_test` and persists one `step_inapplicable_ignored` with cause `toggle-off` naming `manual_test`;
   - a no-marker feature persists no `step_inapplicable`, `step_inapplicable_ignored`, or `step_inapplicable_refused` event.
2. Verify RED.
3. Add the enabled-empty-seed case: a seed with an empty declaration list, as produced by a failed base read in Task 8, skips nothing.
4. Gate the Task 9 check on the resolved toggle. Emit `step_inapplicable_ignored` once per dispatch when the seed carries an ignored cause. A disabled toggle never reads `feature_inapplicable` for a skip decision.
5. Verify GREEN and commit.

**Done when:**
- With the capability disabled and no marker, the step-status map and the ordered list of `tier_skip` and `config_skip` events equal those of the baseline run with no applicability state, as asserted in `test/engine/conductor-feature-applicability.test.ts`.
- With the capability disabled and tier S, every tier skip is recorded `skipped` with its existing `tier_skip` event and no applicability event.
- With the capability disabled and a seeded `toggle-off` ignored cause for a `manual_test` marker, the fake StepRunner receives `manual_test` and exactly one `step_inapplicable_ignored` event with cause `toggle-off` naming `manual_test` is persisted.
- With the capability disabled and no marker, zero `step_inapplicable`, `step_inapplicable_ignored`, and `step_inapplicable_refused` events are persisted.
- With the capability enabled and a seed carrying no declarations because the base marker read failed, no step is recorded skipped by applicability and the fake StepRunner receives `acceptance_specs` and `manual_test`.

**Files:** src/conductor/src/engine/conductor.ts; src/conductor/test/engine/conductor-feature-applicability.test.ts

**Dependencies:** Task 9

### Task 11: Branch-only, invalid, and interactive markers are ignored and reported
**Story:** 7
**Type:** negative-path

**Steps:**
1. Extend `src/conductor/test/engine/conductor-feature-applicability.test.ts`. Cover:
   - a daemon run whose seed is base-sourced with identical worktree content honors the base declarations with no ignored event;
   - a worktree marker with no base copy honors nothing and persists ignored cause `branch-only`;
   - a worktree marker adding a declaration not in the base honors only the base declarations and persists `branch-only`;
   - an interactive run (no `applicability_declarations` in state) with a marker in its checkout honors nothing and persists ignored cause `interactive`;
   - a seed carrying ignored cause `invalid` naming `prd_audit` honors nothing and persists that event.
2. Verify RED.
3. In the dispatch skip resolution, before honoring anything, read the worktree marker. If `state.applicability_declarations` is undefined, the run is interactive: emit `interactive` when a marker exists, then honor nothing. Otherwise compare the sha256 of the worktree content with the seeded base hash; on absence-from-base or mismatch, emit `branch-only` and honor only the seeded base declarations. Emit a seeded `invalid` cause as is.
4. Verify GREEN and commit.

**Done when:**
- With identical base and worktree marker content, the seeded base declarations are honored and no `step_inapplicable_ignored` event is persisted, as asserted in `test/engine/conductor-feature-applicability.test.ts`.
- With a worktree marker absent from the base, no declared step is skipped and one `step_inapplicable_ignored` event with cause `branch-only` is persisted.
- With a worktree marker whose content adds a declaration not in the base copy, only the base copy's declarations are skipped and one `step_inapplicable_ignored` event with cause `branch-only` is persisted.
- In an interactive run with a marker in its checkout, no declared step is skipped and one `step_inapplicable_ignored` event with cause `interactive` is persisted.
- With a seeded `invalid` cause naming `prd_audit`, no step is skipped by the marker and one `step_inapplicable_ignored` event with cause `invalid` naming `prd_audit` is persisted.

**Files:** src/conductor/src/engine/conductor.ts; src/conductor/test/engine/conductor-feature-applicability.test.ts

**Dependencies:** Task 10

### Task 12: Late declarations are refused; honored steps stay skipped
**Story:** 8
**Type:** negative-path

**Steps:**
1. Extend `src/conductor/test/engine/conductor-feature-applicability.test.ts`. Cover:
   - `manual_test` with status `failed`, `in_progress`, or halted, and `acceptance_specs` with status `done`, each with a seeded declaration: the step is not skipped, the prior status stands, and `step_inapplicable_refused` names the step and its prior status;
   - a step already in `feature_inapplicable` is re-dispatched with no refused event and stays skipped;
   - after a rebase-transition and an operator rewind that preserve `skipped`, `manual_test` stays skipped with no refused event.
2. Verify RED.
3. In the applicability check, a step present in `ConductState.feature_inapplicable` is left as is: no skip call, no event. A declared step whose observed status is anything other than `pending` emits `step_inapplicable_refused { step, reason, priorStatus }` and continues the normal dispatch path. Confirm by test that rebase-transition and rewind keep `skipped` for a step in `feature_inapplicable`.
4. Verify GREEN and commit.

**Done when:**
- With `manual_test` already `failed` and a seeded `manual_test` declaration, `manual_test` keeps status `failed` and one `step_inapplicable_refused` event naming `manual_test` with `priorStatus: "failed"` is persisted, as asserted in `test/engine/conductor-feature-applicability.test.ts`.
- With `manual_test` `in_progress` or halted and a seeded declaration, `manual_test` is not skipped and one `step_inapplicable_refused` event carrying that prior status is persisted.
- With `acceptance_specs` already `done` and a seeded declaration, `acceptance_specs` keeps status `done` and one `step_inapplicable_refused` event with `priorStatus: "done"` is persisted.
- A step already recorded in `ConductState.feature_inapplicable` stays `skipped` on re-dispatch and zero `step_inapplicable_refused` events are persisted for it.
- After a rebase-transition onto a new base and after an operator rewind, a `manual_test` recorded in `feature_inapplicable` remains `skipped` and zero `step_inapplicable_refused` events are persisted.

**Files:** src/conductor/src/engine/conductor.ts; src/conductor/test/engine/conductor-feature-applicability.test.ts

**Dependencies:** Task 11

### Task 13: A declared manual_test is absent from the parallel validation group
**Story:** 6
**Type:** happy-path

**Steps:**
1. Write a failing test in `src/conductor/test/engine/conductor-groups-and-signals.test.ts`. A feature in auto mode with a seeded `manual_test` declaration reaches the validation group; `parallel_started` does not list `manual_test`, and no group branch dispatches it.
2. Verify RED.
3. In `src/conductor/src/engine/conductor.ts`, apply the applicability check to group members before `resolveGroupMembership` computes the dispatched set, so that an honored member is recorded skipped (Task 9 path) and excluded as a skipped member.
4. Verify GREEN and commit.

**Done when:**
- For a seeded `manual_test` declaration, the persisted `parallel_started` event's member list omits `manual_test`, as asserted in `test/engine/conductor-groups-and-signals.test.ts`.
- No validation-group branch dispatches `manual_test` to the fake StepRunner, and `manual_test` is recorded `skipped` with skip cause `inapplicable: <reason>`.

**Files:** src/conductor/src/engine/conductor.ts; src/conductor/test/engine/conductor-groups-and-signals.test.ts

**Dependencies:** Task 12

### Task 14: Dashboard renders an inapplicable step distinctly with its reason
**Story:** 9
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/ui/dashboard-text.test.ts`. A state with one step in `feature_inapplicable`, one tier-skipped step, and one config-disabled step renders the inapplicable step with a dedicated `inapplicable` icon and its reason, and the other two with the plain `skipped` icon and no reason. A declared step refused as late, with status `failed`, renders the failed icon.
2. Verify RED.
3. In `src/conductor/src/ui/dashboard-text.ts`, add an `inapplicable` icon to `ICONS`. When a step is `skipped` and present in `state.feature_inapplicable`, render that icon followed by the reason.
4. Verify GREEN and commit.

**Done when:**
- The dashboard step line for a step in `feature_inapplicable` renders the dedicated `inapplicable` icon followed by its declared reason, as asserted in `test/ui/dashboard-text.test.ts`.
- A tier-skipped step and a config-disabled step in the same state render the plain `skipped` icon with no reason and never the `inapplicable` icon.
- A declared step that was refused as late renders its prior-status icon, such as failed, and never the `inapplicable` icon.

**Files:** src/conductor/src/ui/dashboard-text.ts; src/conductor/test/ui/dashboard-text.test.ts

**Dependencies:** Task 9

### Task 15: Daemon status lists inapplicable steps per feature
**Story:** 9
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/daemon-dashboard.test.ts`. A feature whose conduct state records `feature_inapplicable: [{ step: "manual_test", reason }]` renders a line listing `manual_test` and the reason under that feature. A feature with only tier-skipped or config-disabled steps renders no inapplicable line.
2. Verify RED.
3. In `src/conductor/src/engine/daemon-dashboard.ts`, read `feature_inapplicable` from each feature's observed conduct state and render one `inapplicable: <step> — <reason>` line per entry.
4. Verify GREEN and commit.

**Done when:**
- Daemon status renders an `inapplicable: manual_test — <reason>` line under a feature whose conduct state records that entry in `feature_inapplicable`, as asserted in `test/engine/daemon-dashboard.test.ts`.
- Daemon status renders no inapplicable line for a feature whose only skips are tier skips or config disables.

**Files:** src/conductor/src/engine/daemon-dashboard.ts; src/conductor/test/engine/daemon-dashboard.test.ts

**Dependencies:** Task 9

### Task 16: Downstream gates proceed past inapplicable steps
**Story:** 11
**Type:** verification
**Verify-only:** yes

**Steps:**
1. Write tests in `src/conductor/test/engine/conductor-feature-applicability-downstream.test.ts` with the conductor harness:
   - after an honored `manual_test`, `prd_audit` is dispatched;
   - after honored `manual_test`, `prd_audit` and `architecture_review_as_built` run, and finish evaluates ship evidence and proceeds;
   - after an honored `acceptance_specs`, `build` and `build_review` are dispatched with no missing-prerequisite halt;
   - with an honored `acceptance_specs`, `coverage_binding` still runs its obligation and slice layers and does not halt.
2. These assert existing prerequisite semantics (`stepDone` and `gateSatisfied` treat `skipped` as satisfied). If any fails, fix the consumer in the same commit.
3. Commit.

**Done when:**
- With `manual_test` honored as inapplicable, `prd_audit`'s prerequisites evaluate satisfied and the fake StepRunner receives `prd_audit`, as asserted in `test/engine/conductor-feature-applicability-downstream.test.ts`.
- With `manual_test` honored as inapplicable, the fake StepRunner receives `prd_audit` and `architecture_review_as_built` before `finish`, and finish ship-evidence evaluation proceeds without halting.
- With `acceptance_specs` honored as inapplicable, the fake StepRunner receives `build` and `build_review` and no missing-prerequisite halt is recorded.
- With `acceptance_specs` honored as inapplicable, `coverage_binding` runs its obligation and slice layers and completes without a halt naming missing acceptance specs.

**Files:** src/conductor/test/engine/conductor-feature-applicability-downstream.test.ts

**Dependencies:** Task 13

## Task Dependency Graph

```
Task 1 <- none
Task 2 <- none
Task 3 <- none
Task 4 <- 1, 2, 3
Task 5 <- 4
Task 6 <- none
Task 7 <- none
Task 8 <- 1, 2, 3, 4, 7
Task 9 <- 6, 8
Task 10 <- 9
Task 11 <- 10
Task 12 <- 11
Task 13 <- 12
Task 14 <- 9
Task 15 <- 9
Task 16 <- 13
```

## Integration Points

- After Task 5: `ai-conductor compose land` validates applicability markers end to end.
- After Task 9: a daemon dispatch honors a merged declaration and persists `step_inapplicable`.
- After Task 15: an operator sees inapplicable steps in the dashboard and daemon status.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a repository config with no per-feature applicability setting, when the resolved config is loaded, then per-feature applicability resolves as disabled. | 1 | "Resolved config returns `featureApplicability.enabled === false` for a project config with no `feature_applicability` block and `true` for a project config setting `feature_applicability: { enabled: true }`, as asserted in `test/engine/feature-applicability-config.test.ts`." | diff-local |
| Story 1 happy: Given a repository config that enables per-feature applicability, when the resolved config is loaded, then per-feature applicability resolves as enabled. | 1 | "Resolved config returns `featureApplicability.enabled === false` for a project config with no `feature_applicability` block and `true` for a project config setting `feature_applicability: { enabled: true }`, as asserted in `test/engine/feature-applicability-config.test.ts`." | diff-local |
| Story 1 negative: Given a repository config whose per-feature applicability enabled value is a non-boolean such as the string "yes", when the config is validated, then validation fails with an error naming the per-feature applicability setting and the expected boolean type. | 1 | "`validateConfig` rejects `feature_applicability.enabled: "yes"` with an error naming `feature_applicability.enabled` and the expected boolean type, and rejects an unknown key inside the block with an error naming that unknown key." | diff-local |
| Story 1 negative: Given a repository config whose per-feature applicability block carries an unknown key, when the config is validated, then validation fails with an error naming the unknown key. | 1 | "`validateConfig` rejects `feature_applicability.enabled: "yes"` with an error naming `feature_applicability.enabled` and the expected boolean type, and rejects an unknown key inside the block with an error naming that unknown key." | diff-local |
| Story 1 negative: Given a user-level config that enables per-feature applicability and a project config that does not set it, when the resolved config is loaded for that project, then per-feature applicability resolves as disabled. | 1 | "With a user-level config setting `feature_applicability.enabled: true` and a project config without the block, the resolved config for that project returns `featureApplicability.enabled === false`." | diff-local |
| Story 2 happy: Given per-feature applicability is disabled and a feature has no applicability marker, when the daemon dispatches the feature, then the set of steps run and skipped equals the set produced before this feature for the same tier, track, and config. | 10 | "With the capability disabled and no marker, the step-status map and the ordered list of `tier_skip` and `config_skip` events equal those of the baseline run with no applicability state, as asserted in `test/engine/conductor-feature-applicability.test.ts`." | diff-local |
| Story 2 happy: Given per-feature applicability is disabled and a feature's tier is S, when the daemon dispatches the feature, then tier skips are recorded exactly as before with their existing tier skip event. | 10 | "With the capability disabled and tier S, every tier skip is recorded `skipped` with its existing `tier_skip` event and no applicability event." | diff-local |
| Story 2 negative: Given per-feature applicability is disabled and the base branch carries an applicability marker for the feature declaring manual_test inapplicable, when the daemon dispatches the feature, then manual_test runs and a step_inapplicable_ignored event with cause toggle-off naming manual_test is persisted. | 10 | "With the capability disabled and a seeded `toggle-off` ignored cause for a `manual_test` marker, the fake StepRunner receives `manual_test` and exactly one `step_inapplicable_ignored` event with cause `toggle-off` naming `manual_test` is persisted." | diff-local |
| Story 2 negative: Given per-feature applicability is disabled and a feature has no applicability marker, when the daemon dispatches the feature, then no step_inapplicable, step_inapplicable_ignored, or step_inapplicable_refused event is emitted. | 10 | "With the capability disabled and no marker, zero `step_inapplicable`, `step_inapplicable_ignored`, and `step_inapplicable_refused` events are persisted." | diff-local |
| Story 3 happy: Given an applicability marker for the feature with one line declaring acceptance_specs inapplicable with the reason "no new behavior to specify", when the marker is parsed, then exactly one declaration is returned with step acceptance_specs and that reason. | 3 | "`parseApplicability` returns exactly one declaration `{ step: "acceptance_specs", reason: "no new behavior to specify" }` for a marker with that single declaration line, as asserted in `test/engine/feature-applicability-marker.test.ts`." | diff-local |
| Story 3 happy: Given an applicability marker with two declaration lines for manual_test and acceptance_specs plus free prose lines, when the marker is parsed, then two declarations are returned in file order and the prose lines are ignored. | 3 | "`parseApplicability` returns two declarations in file order, manual_test then acceptance_specs, for a marker whose two declaration lines are surrounded by prose, and returns no entry for any prose line." | diff-local |
| Story 3 negative: Given an applicability marker with a declaration line whose reason is empty or whitespace only, when the marker is parsed, then parsing returns an empty-reason error naming that line. | 3 | "`parseApplicability` returns an `empty-reason` error carrying the offending line number for a declaration whose reason is empty or whitespace only." | diff-local |
| Story 3 negative: Given an applicability marker with a declaration line missing the separator between step and reason, when the marker is parsed, then parsing returns a malformed-line error naming that line. | 3 | "`parseApplicability` returns a `malformed-line` error carrying the offending line number for an `Inapplicable:` line with no separator between step and reason." | diff-local |
| Story 4 happy: Given the built-in step catalog, when declarability is queried for each step, then exactly acceptance_specs and manual_test report declarable. | 2 | "`isFeatureDeclarable` returns ok for exactly `acceptance_specs` and `manual_test` when iterated over every built-in in `ALL_STEPS`, as asserted in `test/engine/steps.test.ts`." | diff-local |
| Story 4 happy: Given a declaration for acceptance_specs in an enabled repository, when the declaration is checked against step metadata, then it is accepted as declarable. | 2 | "`isFeatureDeclarable` returns ok for exactly `acceptance_specs` and `manual_test` when iterated over every built-in in `ALL_STEPS`, as asserted in `test/engine/steps.test.ts`." | diff-local |
| Story 4 negative: Given a declaration for test_suite, build_review, finish, prd_audit, architecture_review_as_built, or coverage_binding, when the declaration is checked against step metadata, then it is rejected as not declarable naming the step. | 2 | "`isFeatureDeclarable` returns a `not-declarable` result naming the step for `test_suite`, `build_review`, `finish`, `prd_audit`, `architecture_review_as_built`, and `coverage_binding`." | diff-local |
| Story 4 negative: Given a declaration for a structural step such as build or rebase, or for a DECIDE-phase step such as plan or stories, when the declaration is checked against step metadata, then it is rejected as not declarable naming the step. | 2 | "`isFeatureDeclarable` returns a `not-declarable` result naming the step for the structural steps `build` and `rebase` and the DECIDE-phase steps `plan` and `stories`." | diff-local |
| Story 4 negative: Given a custom step defined in repository config, when a feature declares it inapplicable, then it is rejected as not declarable naming the custom step. | 2 | "`isFeatureDeclarable` returns a `not-declarable` result naming the custom step for a name supplied in `customStepNames`, even when the name collides with nothing built in." | diff-local |
| Story 5 happy: Given an enabled repository and an idea worktree whose applicability marker declares manual_test inapplicable with a non-empty reason, when the spec is landed, then land succeeds and the marker is committed with the other DECIDE artifacts. | 4 | "`landSpec` succeeds for an enabled project whose idea worktree carries a marker declaring `manual_test` inapplicable with a non-empty reason, and the single land commit it creates lists the marker file in the same committed file list as the feature's plan, stories, and other DECIDE artifacts, as asserted in `test/engine/engineer/land-spec-applicability.test.ts`." | diff-local |
| Story 5 happy: Given an enabled repository and an idea worktree with no applicability marker, when the spec is landed, then land behaves exactly as before. | 4 | "`landSpec` for an enabled project whose idea worktree has no applicability marker succeeds with the same committed file list it produces when the capability is disabled." | diff-local |
| Story 5 negative: Given an enabled repository and a marker declaring a step name that is not in the step catalog, when the spec is landed, then land is refused with a typed error naming the unknown step and the line. | 5 | "`landSpec` throws a `LandGateError` with gate `applicability-invalid` whose message names `unknown-step`, the step `nonexistent_step`, and the marker line for an enabled project declaring an unknown step." | diff-local |
| Story 5 negative: Given an enabled repository and a marker declaring test_suite inapplicable, when the spec is landed, then land is refused with a typed not-declarable error naming test_suite. | 5 | "`landSpec` throws gate `applicability-invalid` naming `not-declarable` and `test_suite` for a marker declaring test_suite, and naming `empty-reason` and the line for a declaration with an empty reason." | diff-local |
| Story 5 negative: Given an enabled repository and a marker with an empty reason, when the spec is landed, then land is refused with a typed empty-reason error naming the line. | 5 | "`landSpec` throws gate `applicability-invalid` naming `not-declarable` and `test_suite` for a marker declaring test_suite, and naming `empty-reason` and the line for a declaration with an empty reason." | diff-local |
| Story 5 negative: Given an enabled repository and a marker declaring manual_test twice, when the spec is landed, then land is refused with a typed duplicate-declaration error naming manual_test. | 5 | "`landSpec` throws gate `applicability-invalid` naming `duplicate-declaration` and `manual_test` for a marker declaring manual_test twice." | diff-local |
| Story 5 negative: Given a repository with per-feature applicability disabled and an idea worktree carrying an applicability marker, when the spec is landed, then land is refused with a typed capability-disabled error naming the marker. | 5 | "`landSpec` throws gate `applicability-invalid` naming `capability-disabled` and the marker path when the project has the capability disabled and the worktree carries a marker." | diff-local |
| Story 5 negative: Given an enabled repository and an applicability marker filed under a stem that differs from the feature's plan stem, when the spec is landed, then land is refused with the existing artifact stem mismatch error. | 5 | "`landSpec` throws the existing `artifact-stem-mismatch` gate error for an applicability marker filed under a stem other than the plan stem, and no refused land creates a commit." | diff-local |
| Story 6 happy: Given an enabled repository and a base-branch marker for feature A declaring acceptance_specs inapplicable, when the daemon dispatches feature A, then acceptance_specs is recorded skipped for feature A and does not run. | 9 | "For feature A seeded with an `acceptance_specs` declaration, dispatch records `acceptance_specs` as `skipped` with skip cause `inapplicable: <reason>` and the fake StepRunner never receives `acceptance_specs`, as asserted in `test/engine/conductor-feature-applicability.test.ts`." | diff-local |
| Story 6 happy: Given the same repository and a feature B with no marker dispatched concurrently with feature A, when the daemon dispatches feature B, then acceptance_specs runs for feature B. | 9 | "For feature B seeded with an empty declaration list in the same repository, the fake StepRunner receives `acceptance_specs` and it completes normally." | diff-local |
| Story 6 happy: Given an enabled repository and a base-branch marker declaring manual_test inapplicable, when the parallel validation group starts for that feature, then manual_test is absent from the group's dispatched members and no group branch runs it. | 13 | "For a seeded `manual_test` declaration, the persisted `parallel_started` event's member list omits `manual_test`, as asserted in `test/engine/conductor-groups-and-signals.test.ts`." | diff-local |
| Story 6 negative: Given an enabled repository and a base-branch marker for feature A, when the daemon dispatches feature B whose undated stem differs from feature A's stem, then no declaration from feature A's marker is applied to feature B. | 8 | "Feature B, whose undated stem differs from feature A's marker stem, is seeded with an empty declaration list." | diff-local |
| Story 6 negative: Given an enabled repository and two plans whose undated stems collide with an applicability marker's stem, when the daemon resolves the marker, then the marker is treated as ambiguous, no declaration is applied, and the ambiguity is logged as for tier and track markers. | 8 | "When two plans' undated stems collide with the marker stem, the seeded declarations are empty and the ambiguity is logged in the same form as the tier and track marker ambiguity." | diff-local |
| Story 7 happy: Given an enabled repository and an applicability marker present on the base branch, when the daemon dispatches the feature, then the declarations from the base copy are applied. | 8, 11 | "For a valid base marker on feature A, read through the backlog tree source at the claim-pinned base ref, `discoverBacklog` yields a `BacklogItem` whose declarations carry each step, reason, decider, and commit (a declaration whose decider resolves `unknown` is still seeded, with decider `unknown` and the sha when one is available), and `deriveDaemonBaseState` seeds them into `ConductState.applicability_declarations` with the sha256 of the base marker content, as asserted in `test/engine/daemon-backlog-applicability.test.ts`." | diff-local |
| Story 7 happy: Given an enabled repository and identical marker content on the base branch and in the feature worktree, when the daemon dispatches the feature, then the declarations are applied and no ignored event is emitted. | 11 | "With identical base and worktree marker content, the seeded base declarations are honored and no `step_inapplicable_ignored` event is persisted, as asserted in `test/engine/conductor-feature-applicability.test.ts`." | diff-local |
| Story 7 negative: Given an enabled repository and an applicability marker present only in the feature worktree and absent from the base branch, when the daemon dispatches the feature, then no declared step is skipped and a step_inapplicable_ignored event with cause branch-only is persisted. | 11 | "With a worktree marker absent from the base, no declared step is skipped and one `step_inapplicable_ignored` event with cause `branch-only` is persisted." | diff-local |
| Story 7 negative: Given an enabled repository and a worktree marker whose content adds a declaration not present in the base copy, when the daemon dispatches the feature, then only the base copy's declarations are applied and a step_inapplicable_ignored event with cause branch-only is persisted. | 11 | "With a worktree marker whose content adds a declaration not in the base copy, only the base copy's declarations are skipped and one `step_inapplicable_ignored` event with cause `branch-only` is persisted." | diff-local |
| Story 7 negative: Given an enabled repository and an applicability marker in the working checkout, when an interactive non-daemon run dispatches the feature, then no declared step is skipped and a step_inapplicable_ignored event with cause interactive is persisted. | 11 | "In an interactive run with a marker in its checkout, no declared step is skipped and one `step_inapplicable_ignored` event with cause `interactive` is persisted." | diff-local |
| Story 7 negative: Given an enabled repository and a base-branch marker that declares prd_audit inapplicable after a hand-pushed merge that bypassed land, when the daemon dispatches the feature, then nothing in that marker is honored and a step_inapplicable_ignored event with cause invalid naming prd_audit is persisted. | 8, 11 | "With a seeded `invalid` cause naming `prd_audit`, no step is skipped by the marker and one `step_inapplicable_ignored` event with cause `invalid` naming `prd_audit` is persisted." | diff-local |
| Story 7 negative: Given an enabled repository where reading the marker from the base branch fails, when the daemon dispatches the feature, then no declared step is skipped and the failure is logged naming the marker path. | 8, 10 | "A `treeSource.readFile` that throws for the marker path seeds no declarations and logs a line naming the marker path, and the backlog scan continues." | diff-local |
| Story 8 happy: Given an enabled repository and a merged declaration for manual_test whose status for the feature is pending, when the daemon dispatches the feature, then manual_test is skipped as inapplicable. | 9 | "For a seeded `manual_test` declaration whose status is `pending`, including one whose decider is `unknown`, dispatch records `manual_test` as skipped and appends `{ step, reason, decider, commit }` to `ConductState.feature_inapplicable` through the mutation port." | diff-local |
| Story 8 happy: Given an enabled repository and a merged declaration for a step that has already been skipped as inapplicable, when the feature is re-dispatched, then the step stays skipped and no refused event is emitted. | 12 | "A step already recorded in `ConductState.feature_inapplicable` stays `skipped` on re-dispatch and zero `step_inapplicable_refused` events are persisted for it." | diff-local |
| Story 8 happy: Given manual_test skipped as inapplicable for a feature, when the feature is rebased onto a new base or rewound, then manual_test stays skipped as inapplicable and no refused event is emitted. | 12 | "After a rebase-transition onto a new base and after an operator rewind, a `manual_test` recorded in `feature_inapplicable` remains `skipped` and zero `step_inapplicable_refused` events are persisted." | diff-local |
| Story 8 negative: Given an enabled repository and manual_test failed for the feature, when a spec amendment declaring manual_test inapplicable is merged and the feature is re-dispatched, then manual_test is not skipped, the declaration does not change its failed status, manual_test is retried through normal dispatch and must still pass its gate, and a step_inapplicable_refused event naming manual_test with prior status failed is persisted. | 12 | "With `manual_test` already `failed` and a seeded `manual_test` declaration, `manual_test` keeps status `failed` and one `step_inapplicable_refused` event naming `manual_test` with `priorStatus: "failed"` is persisted, as asserted in `test/engine/conductor-feature-applicability.test.ts`." | diff-local |
| Story 8 negative: Given an enabled repository and manual_test in progress or halted for the feature, when a declaration for manual_test is merged and the feature is re-dispatched, then manual_test is not skipped and a step_inapplicable_refused event with that prior status is persisted. | 12 | "With `manual_test` `in_progress` or halted and a seeded declaration, `manual_test` is not skipped and one `step_inapplicable_refused` event carrying that prior status is persisted." | diff-local |
| Story 8 negative: Given an enabled repository and acceptance_specs already done for the feature, when a declaration for acceptance_specs is merged and the feature is re-dispatched, then acceptance_specs keeps its done status and a step_inapplicable_refused event with prior status done is persisted. | 12 | "With `acceptance_specs` already `done` and a seeded declaration, `acceptance_specs` keeps status `done` and one `step_inapplicable_refused` event with `priorStatus: "done"` is persisted." | diff-local |
| Story 9 happy: Given an enabled repository and a merged declaration honored for manual_test, when dispatch skips it, then a step_inapplicable event naming manual_test and its reason is persisted and exported to telemetry. | 9, 6 | "Each honored declaration persists exactly one `step_inapplicable` event naming the step, reason, decider, and commit in `.pipeline/events.jsonl`, and the metrics listener receives that event." | diff-local |
| Story 9 happy: Given a feature with one inapplicable step, one tier-skipped step, and one config-disabled step, when the operator views the feature's dashboard step lines, then the inapplicable step renders with its own icon and its reason and the other two render as plain skipped. | 14 | "The dashboard step line for a step in `feature_inapplicable` renders the dedicated `inapplicable` icon followed by its declared reason, as asserted in `test/ui/dashboard-text.test.ts`." | diff-local |
| Story 9 happy: Given a feature with an inapplicable step, when the operator views daemon status, then the feature lists the inapplicable step with its reason. | 15 | "Daemon status renders an `inapplicable: manual_test — <reason>` line under a feature whose conduct state records that entry in `feature_inapplicable`, as asserted in `test/engine/daemon-dashboard.test.ts`." | diff-local |
| Story 9 negative: Given a feature whose step was tier-skipped or config-disabled, when the operator views the dashboard or daemon status, then that step is not shown as inapplicable and no step_inapplicable event exists for it. | 14, 15, 9 | "A tier-skipped step and a config-disabled step in the same state render the plain `skipped` icon with no reason and never the `inapplicable` icon." | diff-local |
| Story 9 negative: Given a feature whose declared step was refused as late, when the operator views the dashboard, then the step shows its current dispatch status (for example failed, in progress, or done after a successful retry), not inapplicable. | 14 | "A declared step that was refused as late renders its prior-status icon, such as failed, and never the `inapplicable` icon." | diff-local |
| Story 10 happy: Given an applicability marker introduced on the base branch by a squash-merge commit authored by "Op Erator <operator@example.com>", when the daemon resolves the declaration, then the inapplicable record's decider author is that identity, its committer is the commit's committer identity, and its commit is that commit's sha. | 7, 8 | "`resolveMarkerDecider` returns author `Op Erator <operator@example.com>`, the commit's committer identity, and the commit sha for a marker introduced by that squash-style base commit, as asserted in `test/engine/owner-gate/merge-time.test.ts`." | diff-local |
| Story 10 happy: Given a marker introduced by one base commit and later amended by a second base commit, when the daemon resolves the declaration, then the decider and commit are taken from the latest first-parent base commit that touched the marker. | 7 | "`resolveMarkerDecider` returns the second commit's author, committer, and sha when a later first-parent base commit amended the marker." | diff-local |
| Story 10 negative: Given a base branch where the commit that touched the marker cannot be resolved, when the daemon resolves the declaration, then the decider is recorded as unknown, the declaration is still honored, and the record carries the sha when one is available. | 7, 8, 9 | "`resolveMarkerDecider` returns decider `unknown` without throwing when the base ref or the marker history cannot be resolved, carrying a sha only when git reported one." | diff-local |
| Story 10 negative: Given a marker touched only by a non-first-parent commit inside a merged branch, when the daemon resolves the declaration, then the decider comes from the first-parent merge commit on the base branch, not the inner branch commit. | 7 | "`resolveMarkerDecider` returns the first-parent merge commit's identities and sha, not the inner branch commit's, when the marker changed only inside a merged branch." | diff-local |
| Story 11 happy: Given manual_test declared inapplicable and skipped, when prd_audit's prerequisites are evaluated, then manual_test counts as satisfied and prd_audit is dispatched. | 16 | "With `manual_test` honored as inapplicable, `prd_audit`'s prerequisites evaluate satisfied and the fake StepRunner receives `prd_audit`, as asserted in `test/engine/conductor-feature-applicability-downstream.test.ts`." | diff-local |
| Story 11 happy: Given manual_test declared inapplicable and skipped, when finish evaluates ship evidence, then finish proceeds and prd_audit and the as-built review still run before it. | 16 | "With `manual_test` honored as inapplicable, the fake StepRunner receives `prd_audit` and `architecture_review_as_built` before `finish`, and finish ship-evidence evaluation proceeds without halting." | diff-local |
| Story 11 negative: Given acceptance_specs declared inapplicable and skipped, when build and build_review prerequisites are evaluated, then both are dispatched and neither halts for a missing prerequisite. | 16 | "With `acceptance_specs` honored as inapplicable, the fake StepRunner receives `build` and `build_review` and no missing-prerequisite halt is recorded." | diff-local |
| Story 11 negative: Given acceptance_specs declared inapplicable and skipped, when coverage_binding runs, then its obligation and slice layers still run and it does not halt for missing acceptance specs. | 16 | "With `acceptance_specs` honored as inapplicable, `coverage_binding` runs its obligation and slice layers and completes without a halt naming missing acceptance specs." | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-10-03-per-feature-step-applicability#D1 | task | task-3 | `parseApplicability` returns exactly one declaration `{ step: "acceptance_specs", reason: "no new behavior to specify" }` for a marker with that single declaration line, as asserted in `test/engine/feature-applicability-marker.test.ts`. |
| adr-2026-10-03-per-feature-step-applicability#D2 | task | task-1 | With a user-level config setting `feature_applicability.enabled: true` and a project config without the block, the resolved config for that project returns `featureApplicability.enabled === false`. |
| adr-2026-10-03-per-feature-step-applicability#D3 | task | task-2 | `isFeatureDeclarable` returns a `not-declarable` result naming the step for `test_suite`, `build_review`, `finish`, `prd_audit`, `architecture_review_as_built`, and `coverage_binding`. |
| adr-2026-10-03-per-feature-step-applicability#D4 | task | task-5, task-4 | `landSpec` throws a `LandGateError` with gate `applicability-invalid` whose message names `unknown-step`, the step `nonexistent_step`, and the marker line for an enabled project declaring an unknown step. |
| adr-2026-10-03-per-feature-step-applicability#D5 | task | task-8, task-11 | With a worktree marker absent from the base, no declared step is skipped and one `step_inapplicable_ignored` event with cause `branch-only` is persisted. |
| adr-2026-10-03-per-feature-step-applicability#D6 | task | task-7 | No caller passes the `resolveMarkerDecider` result to `resolveDaemonOwner` or any authorization check; a source-scan test over `engine/owner-gate/` and `engine/daemon-backlog.ts` asserts the only consumer is the applicability seed. |
| adr-2026-10-03-per-feature-step-applicability#D7 | task | task-12 | With `manual_test` already `failed` and a seeded `manual_test` declaration, `manual_test` keeps status `failed` and one `step_inapplicable_refused` event naming `manual_test` with `priorStatus: "failed"` is persisted, as asserted in `test/engine/conductor-feature-applicability.test.ts`. |
| adr-2026-10-03-per-feature-step-applicability#D8 | task | task-9, task-6, task-13, task-14, task-15 | Each honored declaration persists exactly one `step_inapplicable` event naming the step, reason, decider, and commit in `.pipeline/events.jsonl`, and the metrics listener receives that event. |
| adr-2026-10-03-per-feature-step-applicability#D9 | task | task-16 | With `manual_test` honored as inapplicable, `prd_audit`'s prerequisites evaluate satisfied and the fake StepRunner receives `prd_audit`, as asserted in `test/engine/conductor-feature-applicability-downstream.test.ts`. |

## Verification

- [x] All happy path criteria covered by at least one task
- [x] All negative path criteria covered by at least one task
- [x] No task exceeds 5 minutes of work
- [x] Every task has a `Done when:` block of falsifiable checks
- [x] Dependencies are explicit and acyclic

### Task rem-as-built-rem-adr-a5-1: conductor.ts:7883-7924 — before honoring a seeded declaration, call isFeatureDeclarable(step, customStepNames) (steps.ts) and refuse to skip non-declarable steps, emitting step_inapplicable_ignored{cause:'invalid'} naming the step; test in conductor-feature-applicability.test.ts with a hand-seeded prd_audit declaration that is dispatched normally
**Gate:** as-built
**Rationale:** Dispatch honors persisted declarations without consulting isFeatureDeclarable or featureInapplicableAllowed (conductor.ts:7883-7924), which ADR D3 forbids ('dispatch never honors a declaration for one'). No existing Done-when asserts a dispatch-level declarability check, so one task is appended under the ADR D3 finding. The single declarability authority remains steps.ts isFeatureDeclarable, and no second step list is introduced.
**Governing clause:** adr-2026-10-03-per-feature-step-applicability decision 3
**Done when:**
- adr-2026-10-03-per-feature-step-applicability decision 3 is satisfied by this task.
- Re-run as-built and confirm task rem-as-built-rem-adr-a5-1 is complete.
