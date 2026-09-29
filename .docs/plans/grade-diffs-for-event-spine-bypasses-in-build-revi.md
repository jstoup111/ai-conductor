# Implementation Plan: Grade diffs for event-spine bypasses in build_review (#2043)

**Date:** 2026-09-28
**Stories:** .docs/stories/grade-diffs-for-event-spine-bypasses-in-build-revi.md
**Conflict check:** Not required (tier S)

## Summary

Add a project-declared `eventSpine` build_review custom rubric to this repository. It is backed by the repo-local `event-spine` skill, which gains a diff-grading section, so a finished diff that adds a parallel observation or coordination channel fails review through the existing adjudicator. 5 tasks.

## Technical Approach

- **No engine change.** The `build_review.custom_rubrics` seam (`adr-2026-09-10-portable-build-review-policy`) already resolves a project skill as read-only review policy. It dispatches that skill as a catalog branch and joins its findings into the one aggregate. It routes them through the post-join adjudicator and refuses an enabled declaration while adjudication is off. This feature declares one member and writes its policy.
- **Declaration.** `.ai-conductor/config.yml` gains `build_review.custom_rubrics.eventSpine` (skill `event-spine`, source `project`, Claude opus at low effort, like the built-in rubrics here). `min_confidence` stays at its default of 0, so every scored finding blocks, per the confirmed Balanced scope.
- **Policy.** `.agents/skills/event-spine/SKILL.md` is already installed for the Claude candidate: `.claude/skills/event-spine` symlinks to it, and discovery deduplicates by `realpath`. A new `## 7. Grading a finished diff` section turns the existing decision procedure into diff rules with a closed concern-id set: `bespoke-channel`, `stamped-artifact-field`, `watcher-or-poller`, `out-of-band-signal`, `exception-changes-schema`, `unapproved-channel-adr`. Stable ids keep finding identity steady across laps. The section also lists the non-findings.
- **Repo-only.** The spine exists only in this repository, so nothing changes in the shipped `skills/` catalog or in `BUILD_REVIEW_RUBRIC_IDS`, and consumers are unaffected.
- **Test pattern.** Skill-contract tests follow `src/conductor/test/engine/build-review-skill-contract.test.ts`: read the SKILL.md from the repo, slice the section, and assert its required content. Judgement cases are fixture payloads that must parse through `parseBuildReviewCustomReviewerPayload`, as in the security rubric's rubric-skills test. Config tests load this repository's real `.ai-conductor/config.yml` rather than a copy, so the declaration under test is the one that runs.
- **Sequencing.** Task 1 (declaration) gates Tasks 2 and 5, which read it. Task 3 (fail rules) gates Task 4 (pass rules), which edits the same skill section. Tasks 1 and 3 are independent.

## Prerequisites

- None. The custom-rubric seam, the adjudicator, and the project-installed `event-spine` skill are on main.

## Tasks

### Task 1: Declare the eventSpine custom rubric in this repository's config
**Story:** 1
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/event-spine-rubric-config.test.ts` that call `loadConfig` on the repository root (resolve it from the test file with `fileURLToPath(new URL('../../../../', import.meta.url))`, mirroring how `build-review-skill-contract.test.ts` locates repo files) and pass the result to `resolveBuildReviewConfig`. Assert the `eventSpine` catalog entry, the full catalog id order, and adjudication enablement. Add a `joinBuildReviewRubricOutcomes` case: passing `testQuality` and `security` results plus a `customResults.eventSpine` member carrying one judged finding, with `currentCustomRubrics: ['eventSpine']`. Build the member with the same fixture helpers the existing custom-aggregate tests use (search `src/conductor/test` for `customResults:`).
2. Run `npx vitest run test/engine/event-spine-rubric-config.test.ts` from `src/conductor` and observe RED: no `eventSpine` entry exists.
3. Implement in `.ai-conductor/config.yml`: under `build_review`, add `custom_rubrics.eventSpine` with `enabled: true`, `skill: event-spine`, `source: project`, `llm_provider: claude`, `model: opus`, `effort: low`, and a single-line `question` asking whether the frozen feature diff adds an observation or coordination channel outside the event spine (`ConductorEventEmitter` to `.pipeline/events.jsonl`). Leave `build_review.adjudication` undeclared so it keeps its enabled default. Add a short comment in the file's existing style saying the rubric is repo-only because the spine exists only here. Do not set `min_confidence`.
4. Re-run the test and observe GREEN.
5. Commit: `feat(build-review): declare the eventSpine custom rubric for this repository`.

**Done when:**
- `loadConfig` on the repository root followed by `resolveBuildReviewConfig` yields exactly one catalog entry `eventSpine` with `kind: custom`, enabled, skill `event-spine`, source `project`, and a question asking whether the diff adds an observation or coordination channel outside the event spine, as asserted by the event-spine rubric config test.
- The resolved `catalog` execution branches for the repository config are exactly `testQuality`, `security`, `eventSpine` in that order, so every build_review lap dispatches `eventSpine` alongside the enabled built-in rubrics, and `adjudication.enabled` resolves true, as asserted by the event-spine rubric config test.
- `joinBuildReviewRubricOutcomes` given passing `testQuality` and `security` results and an `eventSpine` custom member carrying one finding returns one aggregate whose verdict is not PASS and whose sources include that finding under rubric `eventSpine`, as asserted by the event-spine rubric config test.

**Files likely touched:**
- .ai-conductor/config.yml — add the `build_review.custom_rubrics.eventSpine` declaration
- src/conductor/test/engine/event-spine-rubric-config.test.ts — repository-config resolution, catalog, and aggregate-join tests

**Dependencies:** none

### Task 2: Missing event-spine skill settles the member absent
**Story:** 1
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/event-spine-rubric-policy.test.ts`. Read the `eventSpine` declaration from the repository config through `loadConfig` and `resolveBuildReviewConfig`. Run `discoverClaudeReviewPolicies` with a stub `command` returning an empty plugin list (`[]`). Case one uses a candidate whose `projectSkillRoots` are the repository's `.claude/skills` and `.agents/skills` (the same pair `step-runners.ts` builds for a project-scoped Claude candidate) with `skill: 'event-spine'`. Case two uses a temporary directory with empty `.claude/skills` and `.agents/skills` roots. Pass each catalog to `resolveInstalledReviewPolicy` with the declaration's skill and source. Add a lap-level case that drives the build_review step through `StepRunner` with the repository's `eventSpine` declaration and an injected `buildReviewPolicyCatalog` returning no `event-spine` installation, reusing the harness in `src/conductor/test/integration/build-review-custom-routing.integration.test.ts`.
2. Run `npx vitest run test/engine/event-spine-rubric-policy.test.ts` from `src/conductor` and observe RED, because the declaration is absent before Task 1.
3. No production change beyond Task 1 is expected: discovery already deduplicates symlinked installations by `realpath`, and resolution already returns `absent`. If case one reports `ambiguous`, fix the installation symlink rather than the resolver.
4. Re-run and observe GREEN.
5. Commit: `test(build-review): pin eventSpine policy resolution and its absent outcome`.

**Done when:**
- `discoverClaudeReviewPolicies` over the repository's `.claude/skills` and `.agents/skills` roots with a stubbed empty plugin list, then `resolveInstalledReviewPolicy` for the `eventSpine` declaration, resolves exactly one policy with source `project` whose canonical skill path ends in `.agents/skills/event-spine/SKILL.md`, as asserted by the event-spine rubric policy test.
- The same resolution over project skill roots containing no `event-spine` directory returns a failure with code `absent` naming skill `event-spine` and no resolved policy, so no other skill judges the member, as asserted by the event-spine rubric policy test.
- A build_review step run through `StepRunner` whose injected `buildReviewPolicyCatalog` holds no `event-spine` installation emits `build_review_policy_failed` with rubric `eventSpine` and stage `catalog`, settles the `eventSpine` member as `policy-load-failed` with detail `Installed build-review policy event-spine is unavailable: absent; requested source: project`, dispatches no provider invocation for it, and returns `success: false`, as asserted by the event-spine rubric policy test.

**Files likely touched:**
- src/conductor/test/engine/event-spine-rubric-policy.test.ts — discovery, resolution, and absent-outcome tests

**Dependencies:** 1

### Task 3: Teach the event-spine skill to grade a finished diff for bypasses
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/event-spine-rubric-skill.test.ts`, modeled on `src/conductor/test/engine/build-review-skill-contract.test.ts`. Read `.agents/skills/event-spine/SKILL.md` from the repository, slice the `## 7. Grading a finished diff` section up to the next `## ` heading, and assert the concern ids, the naming and evidence rules, the schema-not-file rule, and the revised §5 wording listed in Done when. Build fixture payloads for the six fail cases and pass them to `parseBuildReviewCustomReviewerPayload`. Each fixture needs a valid `sourceRegions` entry whose `contentHash` is computed the way the existing custom-finding fixtures compute it (search `src/conductor/test` for `sourceRegions`).
2. Run `npx vitest run test/engine/event-spine-rubric-skill.test.ts` from `src/conductor` and observe RED: the section does not exist.
3. Implement in `.agents/skills/event-spine/SKILL.md`: add `## 7. Grading a finished diff` before `## Output`. Keep the `## Output` and `## Verification` sections that follow it unchanged. The section says that as a build_review policy, the skill judges only the frozen feature diff. It defines the closed concern ids `bespoke-channel`, `stamped-artifact-field`, `watcher-or-poller`, `out-of-band-signal`, and `exception-changes-schema`, each with the §1 or §3–§4 rule that triggers it. Every finding's `summary` names the channel, and its `evidenceLocations` cite the added changed hunk. A bespoke-format record written into an already-existing file is still `bespoke-channel`. Reword the last paragraph of §5: prefer catching a channel at `architecture-review`, and name build_review's `eventSpine` rubric as the backstop for a channel that reached the diff. Do not edit `CLAUDE.md` or any shipped `skills/` file.
4. Re-run and observe GREEN.
5. Commit: `feat(event-spine): grade finished diffs for parallel channels`.

**Done when:**
- The `## 7. Grading a finished diff` section of `.agents/skills/event-spine/SKILL.md` defines the concern ids `bespoke-channel`, `stamped-artifact-field`, `watcher-or-poller`, `out-of-band-signal`, and `exception-changes-schema`, and states each as a blocking finding, as asserted by the event-spine rubric skill test.
- That section requires every finding summary to name the channel (the ledger or sidecar path, the stamped field and its artifact, the watcher, or the IPC path or endpoint) and requires an `evidenceLocations` entry citing the added changed hunk, as asserted by the event-spine rubric skill test.
- That section states that a bespoke-format record written into an already-existing file is a blocking `bespoke-channel` finding because the test is schema and reader path, not file novelty, and that an exception that also introduces its own record format is a blocking `exception-changes-schema` finding whose summary must state that an exception moves the write but never changes the schema, as asserted by the event-spine rubric skill test.
- Fixture payloads for a new bespoke sidecar ledger, a stamped artifact field, a watcher, an IPC path, a bespoke record in an existing file, and an exception with a new format each parse through `parseBuildReviewCustomReviewerPayload` as `custom-findings` with exactly one finding carrying the expected concern id and a changed-hunk evidence location, the last one's summary stating that an exception moves the write but never changes the schema, as asserted by the event-spine rubric skill test.
- Section 5 of the skill names build_review's `eventSpine` rubric as the backstop for a channel that reached the diff and no longer says a second channel is never raised at review time, as asserted by the event-spine rubric skill test.

**Files likely touched:**
- .agents/skills/event-spine/SKILL.md — new §7 diff-grading section; §5 backstop wording
- src/conductor/test/engine/event-spine-rubric-skill.test.ts — skill-contract and fail-case fixture tests

**Dependencies:** none

### Task 4: Pass cases: spine extensions, exceptions, approved ADRs, test-only writes
**Story:** 3
**Type:** negative-path

**Steps:**
1. Extend `src/conductor/test/engine/event-spine-rubric-skill.test.ts` with failing tests for the §7 pass-case rules listed in Done when, and with fixture payloads for the five pass cases and the DRAFT-ADR case.
2. Run `npx vitest run test/engine/event-spine-rubric-skill.test.ts` from `src/conductor` and observe RED.
3. Implement in `.agents/skills/event-spine/SKILL.md` §7: add a non-findings list (new `ConductorEvent` variant; same-schema single-writer sibling ledger under exception A or B; durable state under exception C; writes confined to test files or fixtures). Add the ADR rule: a new channel passes only with an APPROVED architecture decision record naming all four §5 elements; otherwise raise concern id `unapproved-channel-adr` naming the channel and the missing approval or element.
4. Re-run and observe GREEN.
5. Commit: `feat(event-spine): define non-findings and the ADR-backed channel rule`.

**Done when:**
- Section 7 of `.agents/skills/event-spine/SKILL.md` lists as non-findings a new `ConductorEvent` variant emitted through `ConductorEventEmitter`, a single-writer sibling ledger in the `ConductorEvent` schema merged by the existing reader under exception A or B, durable state such as gate evidence artifacts or committed design documents under exception C, and writes confined to test files or test fixtures, as asserted by the event-spine rubric skill test.
- Section 7 states that a new channel passes only with an APPROVED architecture decision record naming the concern, the applicable exception or why none applies, the channel's consumers, and the reconciliation story, and otherwise requires a blocking `unapproved-channel-adr` finding naming the channel and the missing approval or element, as asserted by the event-spine rubric skill test.
- Fixture payloads for the five pass cases parse through `parseBuildReviewCustomReviewerPayload` as `custom-findings` with zero findings, and a fixture for a channel whose ADR is DRAFT parses with exactly one `unapproved-channel-adr` finding, as asserted by the event-spine rubric skill test.

**Files likely touched:**
- .agents/skills/event-spine/SKILL.md — §7 non-findings list and ADR rule
- src/conductor/test/engine/event-spine-rubric-skill.test.ts — pass-case and DRAFT-ADR fixture tests

**Dependencies:** 3

### Task 5: eventSpine findings reach the adjudicator; disabling adjudication is refused
**Story:** 4
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/event-spine-rubric-adjudication.test.ts`. First, call `assembleBuildReviewAdjudicationContext` for an aggregate whose only unresolved source is an `eventSpine` custom finding, building inputs with the fixtures the existing adjudication-context tests use (search `src/conductor/test` for `assembleBuildReviewAdjudicationContext`). Second, drive `coordinateBuildReviewAdjudication` with that source and a stubbed judge returning `act`, `defer`, and `refute` in turn, reusing the fixtures in `src/conductor/test/engine/build-review-adjudication-coordinator.test.ts`. Third, call `validateConfig` on the parsed repository `.ai-conductor/config.yml` with `build_review.adjudication.enabled` overridden to `false`.
2. Run `npx vitest run test/engine/event-spine-rubric-adjudication.test.ts` from `src/conductor` and observe RED, because the declaration is absent before Task 1.
3. No production change is expected: custom findings already share the adjudication source lane, and `validateBuildReviewCustomRubrics` already refuses an enabled declaration while adjudication is off.
4. Re-run and observe GREEN.
5. Commit: `test(build-review): route eventSpine findings through adjudication`.

**Done when:**
- `assembleBuildReviewAdjudicationContext` for an aggregate whose only unresolved source is an `eventSpine` custom finding returns `currentFindings` containing that finding attributed to rubric `eventSpine`, the input from which the adjudicator decides remediate, defer, or refute exactly as for built-in findings, as asserted by the event-spine rubric adjudication test.
- `coordinateBuildReviewAdjudication` for a lap whose only unresolved source is an `eventSpine` finding, with a stubbed judge returning `act`, then `defer`, then `refute`, routes `act` to `build` with a work order, files intake with the justification for `defer` without reducing that source to pass, and settles the source for `refute` without a kickback charge, exactly as for a built-in source, as asserted by the event-spine rubric adjudication test.
- `validateConfig` on the repository's `.ai-conductor/config.yml` with `build_review.adjudication.enabled` set to false returns a validation error whose message is exactly `build_review.custom_rubrics.eventSpine cannot be enabled while build_review.adjudication.enabled is false`, as asserted by the event-spine rubric adjudication test.

**Files likely touched:**
- src/conductor/test/engine/event-spine-rubric-adjudication.test.ts — adjudication-context inclusion and disabled-adjudication refusal tests

**Dependencies:** 1

## Task Dependency Graph

```
Task 1 (declaration) ──▶ Task 2 (policy resolution / absent)
                    └──▶ Task 5 (adjudication)
Task 3 (skill fail rules) ──▶ Task 4 (skill pass rules)
```

## Integration Points

- After Task 1: every build_review lap in this repository dispatches `eventSpine`.
- After Task 4: the dispatched rubric has its complete grading policy.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given this repository's `.ai-conductor/config.yml`, when the build_review configuration is resolved, then the custom catalog contains exactly one member `eventSpine` that is enabled, names skill `event-spine` with source `project`, and carries a question asking whether the diff adds an observation or coordination channel outside the event spine | 1 | "`loadConfig` on the repository root followed by `resolveBuildReviewConfig` yields exactly one catalog entry `eventSpine` with `kind: custom`, enabled, skill `event-spine`, source `project`, and a question asking whether the diff adds an observation or coordination channel outside the event spine" | diff-local |
| Story 1 happy: Given a build_review lap for a feature in this repository with adjudication left at its default, when the lap is dispatched, then the lap's members include `eventSpine` alongside the enabled built-in rubrics and its findings join the same aggregate verdict | 1 | "The resolved `catalog` execution branches for the repository config are exactly `testQuality`, `security`, `eventSpine` in that order, so every build_review lap dispatches `eventSpine` alongside the enabled built-in rubrics, and `adjudication.enabled` resolves true" | diff-local |
| Story 1 negative: Given the `eventSpine` declaration and a provider candidate whose project skill roots contain no `event-spine` skill, when the lap prepares that candidate, then the member settles an infrastructure failure with resolution code `absent` naming skill `event-spine`, no other skill judges it, and the build_review step does not succeed | 2 | "A build_review step run through `StepRunner` whose injected `buildReviewPolicyCatalog` holds no `event-spine` installation emits `build_review_policy_failed` with rubric `eventSpine` and stage `catalog`, settles the `eventSpine` member as `policy-load-failed` with detail `Installed build-review policy event-spine is unavailable: absent; requested source: project`, dispatches no provider invocation for it, and returns `success: false`" | diff-local |
| Story 2 happy: Given a feature diff that adds a writer of a new bespoke-format ledger or sidecar file that records occurrences, when the eventSpine rubric grades it, then it returns a blocking finding that names the channel and cites the added write as a changed-hunk evidence location | 3 | "The `## 7. Grading a finished diff` section of `.agents/skills/event-spine/SKILL.md` defines the concern ids `bespoke-channel`, `stamped-artifact-field`, `watcher-or-poller`, `out-of-band-signal`, and `exception-changes-schema`, and states each as a blocking finding" | diff-local |
| Story 2 happy: Given a feature diff that stamps a timestamp, counter, or status field into an existing artifact so a later reader can reconstruct when something happened, when the eventSpine rubric grades it, then it returns a blocking finding that names the stamped field and the artifact | 3 | "That section requires every finding summary to name the channel (the ledger or sidecar path, the stamped field and its artifact, the watcher, or the IPC path or endpoint) and requires an `evidenceLocations` entry citing the added changed hunk" | diff-local |
| Story 2 happy: Given a feature diff that adds a watcher or poller that observes files or state to infer that something happened, when the eventSpine rubric grades it, then it returns a blocking finding that names the watcher | 3 | "That section requires every finding summary to name the channel (the ledger or sidecar path, the stamped field and its artifact, the watcher, or the IPC path or endpoint) and requires an `evidenceLocations` entry citing the added changed hunk" | diff-local |
| Story 2 happy: Given a feature diff that adds an out-of-band IPC path or status endpoint carrying an occurrence between components, when the eventSpine rubric grades it, then it returns a blocking finding that names the path | 3 | "That section requires every finding summary to name the channel (the ledger or sidecar path, the stamped field and its artifact, the watcher, or the IPC path or endpoint) and requires an `evidenceLocations` entry citing the added changed hunk" | diff-local |
| Story 2 negative: Given a feature diff that writes a bespoke-format record into a file that already exists, when the eventSpine rubric grades it, then it still returns a blocking finding, because the violation is judged by schema and reader path rather than by whether the file is new | 3 | "That section states that a bespoke-format record written into an already-existing file is a blocking `bespoke-channel` finding because the test is schema and reader path, not file novelty, and that an exception that also introduces its own record format is a blocking `exception-changes-schema` finding whose summary must state that an exception moves the write but never changes the schema" | diff-local |
| Story 2 negative: Given a feature diff that adds a parallel channel and cites one of the three exceptions while also introducing its own record format, when the eventSpine rubric grades it, then it returns a blocking finding stating that an exception moves the write but never changes the schema | 3 | "That section states that a bespoke-format record written into an already-existing file is a blocking `bespoke-channel` finding because the test is schema and reader path, not file novelty, and that an exception that also introduces its own record format is a blocking `exception-changes-schema` finding whose summary must state that an exception moves the write but never changes the schema" | diff-local |
| Story 3 happy: Given a feature diff that adds a variant to the `ConductorEvent` union and emits it through `ConductorEventEmitter`, when the eventSpine rubric grades it, then it returns no finding for that change | 4 | "Section 7 of `.agents/skills/event-spine/SKILL.md` lists as non-findings a new `ConductorEvent` variant emitted through `ConductorEventEmitter`, a single-writer sibling ledger in the `ConductorEvent` schema merged by the existing reader under exception A or B, durable state such as gate evidence artifacts or committed design documents under exception C, and writes confined to test files or test fixtures" | diff-local |
| Story 3 happy: Given a feature diff that adds a single-writer sibling ledger written in the same `ConductorEvent` schema and merged by the existing reader, justified by exception A or B, when the eventSpine rubric grades it, then it returns no finding for that ledger | 4 | "Section 7 of `.agents/skills/event-spine/SKILL.md` lists as non-findings a new `ConductorEvent` variant emitted through `ConductorEventEmitter`, a single-writer sibling ledger in the `ConductorEvent` schema merged by the existing reader under exception A or B, durable state such as gate evidence artifacts or committed design documents under exception C, and writes confined to test files or test fixtures" | diff-local |
| Story 3 happy: Given a feature diff that adds durable state such as a gate evidence artifact or a committed design document, when the eventSpine rubric grades it, then it returns no finding, because exception C covers state rather than occurrences | 4 | "Section 7 of `.agents/skills/event-spine/SKILL.md` lists as non-findings a new `ConductorEvent` variant emitted through `ConductorEventEmitter`, a single-writer sibling ledger in the `ConductorEvent` schema merged by the existing reader under exception A or B, durable state such as gate evidence artifacts or committed design documents under exception C, and writes confined to test files or test fixtures" | diff-local |
| Story 3 happy: Given a feature diff that adds a new channel together with an approved architecture decision record that names the concern, the applicable exception or why none applies, the channel's consumers, and the reconciliation story, when the eventSpine rubric grades it, then it returns no finding for that channel | 4 | "Section 7 states that a new channel passes only with an APPROVED architecture decision record naming the concern, the applicable exception or why none applies, the channel's consumers, and the reconciliation story, and otherwise requires a blocking `unapproved-channel-adr` finding naming the channel and the missing approval or element" | diff-local |
| Story 3 happy: Given a feature diff whose only file writes are inside test files or test fixtures, when the eventSpine rubric grades it, then it returns no finding, because test scaffolding is not a production channel | 4 | "Section 7 of `.agents/skills/event-spine/SKILL.md` lists as non-findings a new `ConductorEvent` variant emitted through `ConductorEventEmitter`, a single-writer sibling ledger in the `ConductorEvent` schema merged by the existing reader under exception A or B, durable state such as gate evidence artifacts or committed design documents under exception C, and writes confined to test files or test fixtures" | diff-local |
| Story 3 negative: Given a feature diff that adds a new channel and an ADR for it whose status is DRAFT or which omits one of the four required elements, when the eventSpine rubric grades it, then it returns a blocking finding naming the channel and the missing approval or element | 4 | "Section 7 states that a new channel passes only with an APPROVED architecture decision record naming the concern, the applicable exception or why none applies, the channel's consumers, and the reconciliation story, and otherwise requires a blocking `unapproved-channel-adr` finding naming the channel and the missing approval or element" | diff-local |
| Story 4 happy: Given a build_review lap that returns an `eventSpine` finding, when the post-join adjudication runs, then the finding receives an adjudicator decision and is remediated, deferred, or refuted by the same path the built-in rubrics use | 5 | "`coordinateBuildReviewAdjudication` for a lap whose only unresolved source is an `eventSpine` finding, with a stubbed judge returning `act`, then `defer`, then `refute`, routes `act` to `build` with a work order, files intake with the justification for `defer` without reducing that source to pass, and settles the source for `refute` without a kickback charge, exactly as for a built-in source" | diff-local |
| Story 4 negative: Given this repository's config with `build_review.adjudication.enabled: false` and the `eventSpine` declaration enabled, when the configuration is loaded, then config validation fails with the existing error `build_review.custom_rubrics.eventSpine cannot be enabled while build_review.adjudication.enabled is false`, rather than running eventSpine findings unadjudicated | 5 | "`validateConfig` on the repository's `.ai-conductor/config.yml` with `build_review.adjudication.enabled` set to false returns a validation error whose message is exactly `build_review.custom_rubrics.eventSpine cannot be enabled while build_review.adjudication.enabled is false`" | diff-local |

## Verification

- [x] All happy path criteria covered by at least one task
- [x] All negative path criteria covered by at least one task
- [x] No task exceeds 5 minutes of work
- [x] Every task has a `Done when:` block of falsifiable checks
- [x] Dependencies are explicit and acyclic
