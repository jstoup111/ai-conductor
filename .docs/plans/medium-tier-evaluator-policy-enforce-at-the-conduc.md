# Implementation Plan: build_review implementation-quality rubric

**Date:** 2026-10-09
**Design:** `.docs/decisions/architecture-review-2026-10-09-medium-tier-evaluator-policy-enforce-at-the-conduc.md`
**Stories:** `.docs/stories/medium-tier-evaluator-policy-enforce-at-the-conduc.md` (accepted stories)
**Conflict check:** Clean as of 2026-10-09 (`.docs/conflicts/2026-10-09-medium-tier-evaluator-policy-enforce-at-the-conduc.md`)

## Summary

Adds `implementationQuality`, a third built-in `build_review` rubric that is enabled by default. It
judges code-quality and domain-modelling defects over the feature diff, using a closed seven-kind
vocabulary and content-region anchors. Its findings flow through the shared adjudicator, and the engine
suppresses duplication findings for declared pattern replications. 14 tasks.

## Technical Approach

- **The pattern is the `security` member** (commit `54bd23936c`, #2568).
  - Traits to preserve:
    - The projection is the common fields only, built by `common(source, id)` in `deriveBuildReviewRubricProjections` (`build-review-projections.ts`).
    - Findings carry a single `{rubric, locus}` content-region anchor that must match the lap's changed content regions, with exact keys (the `securityRegion` path in `build-review-domain.ts`).
    - Findings carry no test evidence fields, no `scopeResolutions`, and no `counterfactualSensitivity`.
    - A skip reason is only `disabled`.
    - The cache policy is content-addressed.
  - Allowed variation: its own vocabulary, a default of `enabled: true`, default effort `medium`, and per-child placement with no `leaf-only` skip.
  - Search hints: the `'security'` literals in `build-review-domain.ts`, `build-review-finding-identity.ts`, `build-review-cache.ts`, `build-review-aggregate.ts`, `build-review-adjudication-context.ts`, `artifacts.ts`, and `step-runners.ts` (the rubric label map), plus `BUILD_REVIEW_RUBRIC_CATALOG` in `build-review-registry.ts`.
- **`BuildReviewRubricId` derives from `BUILD_REVIEW_RUBRIC_IDS`.** Every `Record<BuildReviewRubricId, …>` map must gain the new key in the same change: `DEFAULT_RUBRIC_ENABLED`, `DEFAULT_RUBRIC_EFFORT`, the vocabulary and schema maps, the step-runner label and payload-instruction maps, and the adjudication question map. Task 1 is therefore one compile-atomic infrastructure task that registers the member end to end. Later tasks prove each behaviour with tests and add the remaining contract pieces.
- **Default-on** is a value in `DEFAULT_RUBRIC_ENABLED` (`resolved-config.ts`). An absent config block resolves through the existing `enabled: rubric?.enabled ?? defaultEnabled` path. The `build_review_no_rubrics` short-circuit in `classifyBuildReviewRubricBranches` is unchanged, so it now fires only when every member is disabled.
- **Declared-replication suppression is engine bookkeeping applied after judging.** The `build_review` step runner already resolves the plan's `Pattern-source:`/`Rename-map:` with `resolvePlanPatternSource` and derives the target path by applying the rename map to the source path.
  - The aggregate artifact records the ids of `implementationQuality` `duplication` findings that meet two conditions:
    - The finding's `locus.path` equals the derived target path.
    - Every `evidenceLocations` entry names only the declared source path, after stripping any `:`-suffix.
  - The record is a new `declaredReplicationSuppressions` list of `{findingId, sourcePath, targetPath}`.
  - `deriveEffectiveBuildReviewVerdict` treats those ids as suppressed.
  - The projection never sees plan content.
- **Adjudication, caps, dispositions, and the mechanical-fault lane are generic.** Tasks 7 and 8 prove that the new rubric's findings travel those paths. They do not change them.
- **Ordering:**
  1. Task 1 (registration).
  2. Contract tasks 2–6 and 12, which are independent of each other.
  3. Aggregation (7), then adjudication (8) and suppression (9).
  4. Skill (10), then vocabulary guard (11) and judgement fixtures (13).
  5. Task 14 updates the daemon end-to-end fixtures and only needs Task 1.

## Prerequisites

- None. The design adds no dependency, migration, or service.
- Release handling, owned by `finish` and not a plan task: the PR declares `Release-Disposition: note` (Changed, minor) naming the new default and the opt-out key `build_review.rubrics.implementationQuality.enabled: false`. Its `## Migration` section is a migration block or a waiver for the config-schema surface. It also notes that a consumer custom rubric named `implementationQuality` is now rejected as a built-in id.

## Tasks

### Task 1: Register implementationQuality as a default-on built-in rubric member
**Story:** 1
**Type:** infrastructure

**Steps:**
1. Write failing tests:
   - Registry test: `isRegisteredRubric('implementationQuality')` is true, and the descriptor has skill name `build-review-implementation-quality`, projection version `v3`, and a `content-addressed` cache policy.
   - Resolved-config test: a config that omits the rubric resolves to `enabled: true, effort: 'medium'`, while `testQuality` and `security` stay `enabled: false`.
   - Resolved-config test: an explicit `llm_provider`/`model`/`effort`/`model_fallback_ladder`/`max_retries`/`escalate`/`min_confidence` block resolves verbatim.
   - Step-runner test: a default-configured `build_review` lap classifies exactly one dispatchable branch, `implementationQuality`.
2. Verify the tests fail (RED).
3. Implement:
   - Add `'implementationQuality'` to `BUILD_REVIEW_RUBRIC_IDS`.
   - Add a catalog member mirroring `security`. Its projection is `common(source, 'implementationQuality')`.
   - Add an `implementationQuality` key to every exhaustive per-rubric map: `DEFAULT_RUBRIC_ENABLED` (true), `DEFAULT_RUBRIC_EFFORT` (`'medium'`, widening the effort type if needed), `BUILD_REVIEW_FINDING_VOCABULARIES` (the seven kinds), `BUILD_REVIEW_JUDGED_V3_SCHEMAS`, the step-runner rubric label (`Implementation quality`) and payload-instruction maps, and the adjudication question map ("Does the changed code introduce a concrete code-quality or domain-modelling defect?").
   - Add the aggregate normalize default (`{kind:'skipped', rubric, reason:'disabled'}`).
   - Add the cache rubric-id guard and the artifacts verdict rubric map.
   - Follow the `security` member for every site; the search hints are in Technical Approach.
4. Verify the tests pass (GREEN).
5. Commit: "feat(build-review): register default-on implementationQuality rubric".

**Done when:**
- [test] `build-review-registry.test.ts` asserts `isRegisteredRubric('implementationQuality')` and a descriptor with skill `build-review-implementation-quality`, projection `v3`, and `content-addressed` cache policy.
- [test] `resolved-config.test.ts` asserts `resolveBuildReviewConfig` on a config omitting the rubric yields `implementationQuality` `enabled: true` and `effort: 'medium'` while `testQuality` and `security` yield `enabled: false`.
- [test] `resolved-config.test.ts` asserts an explicit `implementationQuality` block resolves its `llm_provider`, `model`, `effort`, `model_fallback_ladder`, `max_retries`, `escalate`, and `min_confidence` exactly as configured on the classified branch.
- [test] `step-runners.test.ts` asserts the `build_review` step with a config naming no rubric classifies `implementationQuality` as the only dispatchable branch and dispatches it.

**Files likely touched:**
- `src/conductor/src/engine/build-review-registry.ts` — id and catalog member
- `src/conductor/src/engine/build-review-domain.ts` — vocabulary and schema map entries
- `src/conductor/src/engine/build-review-projections.ts` — common-only projection member
- `src/conductor/src/engine/resolved-config.ts` — default enabled and effort
- `src/conductor/src/engine/step-runners.ts` — label and payload-instruction maps
- `src/conductor/src/engine/build-review-adjudication-context.ts` — rubric question
- `src/conductor/src/engine/build-review-aggregate.ts` — normalize default
- `src/conductor/src/engine/build-review-cache.ts` — rubric id guard
- `src/conductor/src/engine/artifacts.ts` — verdict rubric map
- `src/conductor/test/engine/build-review-registry.test.ts`, `src/conductor/test/engine/resolved-config.test.ts`, `src/conductor/test/engine/step-runners.test.ts` — tests

**Dependencies:** none

### Task 2: Validate implementationQuality config and keep the opt-out paths exact
**Story:** 1
**Type:** negative-path

**Steps:**
1. Write failing tests:
   - Config validation rejects `build_review.rubrics.implementationQuality.enabled: "yes"` with a message naming the key and the boolean type.
   - Config validation rejects `effort: extreme` with a message naming the key and the allowed values.
   - Coordinator test: `implementationQuality` disabled, with the other members at their defaults, yields the `build_review_no_rubrics` PASS with zero dispatches.
   - Step-runner test: `build_review.enabled: false` runs no implementation-quality judgement.
2. Update the existing `build_review_no_rubrics` fixtures in `build-review-coordinator.test.ts` and `step-runners.test.ts` that disable only `testQuality`/`security`, so they also disable `implementationQuality` explicitly.
3. Verify RED, implement any validation gap in the per-rubric validator (it is expected to be generic over registry ids), verify GREEN.
4. Commit: "test(build-review): pin implementationQuality opt-out and validation".

**Done when:**
- [test] `config.test.ts` asserts validation of `build_review.rubrics.implementationQuality.enabled: "yes"` fails naming `build_review.rubrics.implementationQuality.enabled` and its boolean type, and no lap is dispatched for that config.
- [test] `config.test.ts` asserts validation of `build_review.rubrics.implementationQuality.effort: extreme` fails naming the key and listing the allowed effort values.
- [test] `build-review-coordinator.test.ts` asserts `classifyBuildReviewRubricBranches` with `implementationQuality.enabled: false` and `testQuality`/`security` at defaults returns PASS with reason `build_review_no_rubrics` and zero grader dispatches.
- [test] `step-runners.test.ts` asserts that with `build_review.enabled: false` the step dispatches no `implementationQuality` branch.
- The pre-existing `build_review_no_rubrics` fixtures in `build-review-coordinator.test.ts` and `step-runners.test.ts` set `implementationQuality.enabled: false` alongside the members they already disabled.

**Files likely touched:**
- `src/conductor/src/engine/config.ts` — per-rubric validation if not already generic
- `src/conductor/test/engine/config.test.ts`, `src/conductor/test/engine/build-review-coordinator.test.ts`, `src/conductor/test/engine/step-runners.test.ts` — tests and fixtures

**Dependencies:** Task 1

### Task 3: Prove the implementationQuality projection is diff-only and per-snapshot
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing tests in `build-review-projections.test.ts`:
   - Given frozen inputs whose snapshot includes a plan body, a stories path, and an ADR in the worktree, the `implementationQuality` projection's keys are exactly the common fields (lap id, digests, `mergeBase`, `headSha`, `changedFiles`), and its serialization contains no plan text, stories path, or ADR path.
   - With no children, it shares the snapshot used by every other enabled rubric.
   - Only if per-child projection derivation (#2942) exists in the worktree: on every child, including the leaf, it returns a child-diff projection and never a `leaf-only` skip. Otherwise record that this proof belongs to #2942.
2. Verify RED, then GREEN. Task 1's `common(source, 'implementationQuality')` member is expected to satisfy these, so correct it if any key leaks.
3. Commit: "test(build-review): pin implementationQuality diff-only projection".

**Done when:**
- [test] `build-review-projections.test.ts` asserts `deriveBuildReviewRubricProjections(...).implementationQuality` has exactly the keys lapId, digests, mergeBase, headSha, and changedFiles, and its JSON contains none of the fixture plan path, plan body, stories path, stories content, ADR path, or ADR content.
- [test] `build-review-projections.test.ts` asserts that for a feature with no children, the `implementationQuality` projection derives from the same snapshot digest as the other enabled rubrics.
- [test] When per-child projection derivation exists in the worktree, `build-review-projections.test.ts` asserts a child-diff `implementationQuality` projection on a non-leaf child and on the leaf, with no `leaf-only` skip reason; otherwise the task's commit records the deferral to #2942.

**Files likely touched:**
- `src/conductor/src/engine/build-review-projections.ts` — only if a key leaks
- `src/conductor/test/engine/build-review-projections.test.ts` — tests

**Dependencies:** Task 1

### Task 4: Prove content-addressed caching and the missing-skill fault for implementationQuality
**Story:** 2
**Type:** negative-path

**Steps:**
1. Write failing tests in `build-review-cache.test.ts` and `build-review-coordinator.test.ts`:
   - A matching projection digest, engine identity, policy fingerprint, and skill digest reuses the cached judged result with zero provider dispatches.
   - A changed `skills/build-review-implementation-quality/SKILL.md` digest misses.
   - A changed resolved provider, model, or effort misses.
   - A missing skill file, and separately an existing but unreadable one (permissions removed in the fixture), settles the branch as an infrastructure failure naming the skill path, with no PASS.
2. Verify RED, implement any rubric-specific gap in cache identity, verify GREEN.
3. Commit: "test(build-review): pin implementationQuality cache identity".

**Done when:**
- [test] `build-review-cache.test.ts` asserts a cached `implementationQuality` result is reused with zero provider dispatches when rubric id, projection digest, policy fingerprint, engine identity, and SKILL.md digest all match.
- [test] `build-review-cache.test.ts` asserts a changed `build-review-implementation-quality` SKILL.md digest, and separately a changed resolved provider, model, or effort, each produce a cache miss and a re-judge dispatch.
- [test] `build-review-coordinator.test.ts` asserts a missing `skills/build-review-implementation-quality/SKILL.md`, and separately an existing but unreadable one, each settle the branch as `infrastructure-failure` whose detail names that path, and the lap records no PASS.

**Files likely touched:**
- `src/conductor/src/engine/build-review-cache.ts` — only if identity omits the rubric
- `src/conductor/test/engine/build-review-cache.test.ts`, `src/conductor/test/engine/build-review-coordinator.test.ts` — tests

**Dependencies:** Task 1

### Task 5: Validate implementationQuality findings against the closed vocabulary and anchors
**Story:** 3
**Type:** negative-path

**Steps:**
1. Write failing tests in `build-review-domain.test.ts`:
   - A payload whose findings use the seven kinds with loci matching changed content regions is accepted as an engine-stamped judged FAIL. An empty findings array is a judged PASS.
   - These are rejected as invalid, with the diagnostic naming the offending value: an out-of-set kind (`unmet-acceptance-criterion`), a locus hash matching no changed region, a line-number anchor, and a finding carrying `scopeResolutions`, `counterfactualSensitivity`, or a test-quality evidence field.
   - In `build-review-coordinator.test.ts`: an invalid payload followed by an invalid repair-turn payload settles in the mechanical-fault lane with no PASS and no content finding.
2. Verify RED.
3. Implement:
   - Extend `parseBuildReviewJudgedResult`, `parseBuildReviewSkip`, and `parseBuildReviewInfrastructureFailure` to admit `implementationQuality` (skip reason `disabled` only).
   - Route its anchor through the changed-content-region matcher used for `security`, with exact keys.
   - Reject the security-forbidden evidence fields for this rubric too.
4. Verify GREEN.
5. Commit: "feat(build-review): validate implementationQuality findings".

**Done when:**
- [test] `build-review-domain.test.ts` asserts `BUILD_REVIEW_FINDING_VOCABULARIES.implementationQuality` equals exactly duplication, excess-complexity, obscured-intent, primitive-obsession, representable-invalid-state, non-exhaustive-domain-match, and non-semantic-name.
- [test] `build-review-domain.test.ts` asserts `parseBuildReviewJudgedResult` accepts a seven-kind payload with changed-region loci as an engine-stamped judged result with verdict FAIL, and an empty findings array as verdict PASS.
- [test] `build-review-domain.test.ts` asserts payloads with kind `unmet-acceptance-criterion`, an unmatched locus contentHash, a line-number anchor, or a `scopeResolutions`/`counterfactualSensitivity`/test-quality evidence field are each rejected as invalid with a diagnostic naming the offending kind, anchor, or field.
- [test] `build-review-coordinator.test.ts` asserts an invalid `implementationQuality` payload followed by an invalid repair-turn payload settles in the mechanical-fault lane, recording no PASS and no content finding.

**Files likely touched:**
- `src/conductor/src/engine/build-review-domain.ts` — parsers, anchor matcher, forbidden fields
- `src/conductor/test/engine/build-review-domain.test.ts`, `src/conductor/test/engine/build-review-coordinator.test.ts` — tests

**Dependencies:** Task 1

### Task 6: Give implementationQuality findings a stable identity
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write a failing test in `build-review-finding-identity.test.ts`: two findings with the same `concernKind` and `locus` but different `summary` text produce equal ids from `canonicalizeBuildReviewFindingIdentity`. A canonical-payload round trip via `parseBuildReviewFindingCanonicalPayload` accepts the rubric.
2. Verify RED.
3. Implement: admit `implementationQuality` in `parseCanonicalAnchor`, `parseBuildReviewFindingCanonicalPayload`, `canonicalizeBuildReviewFindingIdentity`, and the canonical anchor union, mirroring `security`.
4. Verify GREEN.
5. Commit: "feat(build-review): stable identity for implementationQuality findings".

**Done when:**
- [test] `build-review-finding-identity.test.ts` asserts `canonicalizeBuildReviewFindingIdentity` returns equal ids for two `implementationQuality` findings that share concernKind and locus but differ in summary.
- [test] `build-review-finding-identity.test.ts` asserts `parseBuildReviewFindingCanonicalPayload` accepts an `implementationQuality` canonical payload and rejects one whose anchor rubric differs from its payload rubric.

**Files likely touched:**
- `src/conductor/src/engine/build-review-finding-identity.ts` — rubric admission
- `src/conductor/test/engine/build-review-finding-identity.test.ts` — tests

**Dependencies:** Task 1

### Task 7: Fail the lap on an implementationQuality finding and suppress below min_confidence
**Story:** 4
**Type:** happy-path

**Steps:**
1. Write failing tests in `build-review-aggregate.test.ts` and `build-review-effective.test.ts`:
   - One `implementationQuality` finding at or above `min_confidence` yields effective verdict FAIL with the id in `unresolvedFindingIds`, and it is passed to the adjudicator as a raw source.
   - A finding below `min_confidence` lands in `suppressedFindingIds` and the verdict is PASS.
   - An `implementationQuality` FAIL alongside passing `testQuality` and `security` yields outer FAIL, and the passing members' results are unchanged in the aggregate.
   - No `implementationQuality` finding is placed in any `beyond` bucket.
2. Verify RED, implement any rubric-specific gap, verify GREEN.
3. Commit: "test(build-review): aggregate implementationQuality findings".

**Done when:**
- [test] `build-review-effective.test.ts` asserts `deriveEffectiveBuildReviewVerdict` returns FAIL with the finding id in `unresolvedFindingIds` for one `implementationQuality` finding at or above its `min_confidence`, and never in a beyond bucket.
- [test] `build-review-effective.test.ts` asserts a below-`min_confidence` `implementationQuality` finding lands in `suppressedFindingIds` and the effective verdict is PASS.
- [test] `build-review-aggregate.test.ts` asserts a lap with `implementationQuality` FAIL and `testQuality`/`security` PASS has outer verdict FAIL and preserves the passing rubric results byte-identical in the aggregate.
- [test] `build-review-adjudication-context.test.ts` asserts the unresolved `implementationQuality` finding appears in the adjudicator's raw sources with its rubric question.

**Files likely touched:**
- `src/conductor/src/engine/build-review-aggregate.ts` — only if a rubric gap exists
- `src/conductor/test/engine/build-review-aggregate.test.ts`, `src/conductor/test/engine/build-review-effective.test.ts`, `src/conductor/test/engine/build-review-adjudication-context.test.ts` — tests

**Dependencies:** Tasks 5, 6

### Task 8: Route implementationQuality findings through admission, caps, and dispositions
**Story:** 4
**Type:** negative-path

**Steps:**
1. Write failing tests:
   - Adjudication: an `act` case for an `implementationQuality` finding that cites an admitted plan task id with a rationale routes `build` with that bounded work order and records one `build_review` kickback in the ledger. The same case citing no admitted task is rejected `missing-admission-task` and the finding is deferred or escalated, not sent to BUILD.
   - Across all seven concern kinds and the `act` (admitted and unadmitted), `defer`, `refute`, and `escalate` dispositions, no path appends a plan task or routes to `plan`.
   - Kickback ledger: at `MAX_CUMULATIVE_KICKBACKS_BUILD_REVIEW`, an `implementationQuality` FAIL halts for a human.
   - Dispositions: an accepted or refuted identity recurring on unchanged code does not fail the lap.
2. Verify RED, then GREEN. These paths are generic and expected to need no production change.
3. Commit: "test(build-review): bound implementationQuality remediation".

**Done when:**
- [test] `build-review-adjudication.test.ts` asserts an `implementationQuality` `act` case citing an admitted task id routes `build` with that work order and increments the `build_review` per-gate and cumulative kickback counts.
- [test] `build-review-adjudication.test.ts` asserts an `act` case citing no admitted task is rejected `missing-admission-task` and the finding is deferred to intake or escalated, with no `build` route, no appended plan task, and no `plan` route.
- [test] `conductor-kickback-ledger.test.ts` asserts an `implementationQuality` FAIL at the cumulative build_review cap halts for a human instead of kicking back.
- [test] `build-review-dispositions.test.ts` asserts an accepted or refuted `implementationQuality` identity recurring on unchanged code leaves the effective verdict PASS.
- [test] `build-review-adjudication.test.ts` asserts that for `implementationQuality` findings of every one of the seven concern kinds, under each of the `act` (admitted), `act` (unadmitted), `defer`, `refute`, and `escalate` dispositions, adjudication appends no plan task and never yields a `plan` route.

**Files likely touched:**
- `src/conductor/test/engine/build-review-adjudication.test.ts`, `src/conductor/test/engine/conductor-kickback-ledger.test.ts`, `src/conductor/test/engine/build-review-dispositions.test.ts` — tests

**Dependencies:** Task 7

### Task 9: Suppress duplication findings for a declared pattern replication
**Story:** 6
**Type:** negative-path

**Steps:**
1. Write failing tests:
   - `build-review-aggregate.test.ts`: given `declaredReplicationSuppressions` naming a finding id, `deriveEffectiveBuildReviewVerdict` places that id in `suppressedFindingIds` and the lap does not fail on it.
   - `step-runners.test.ts`: for a plan whose resolved `Pattern-source:`/`Rename-map:` yields `sourcePath`/`targetPath`, the `build_review` step records `{findingId, sourcePath, targetPath}` in the aggregate's `declaredReplicationSuppressions` for a `duplication` finding anchored at `targetPath` whose `evidenceLocations` name only `sourcePath`. It records nothing for a finding anchored outside `targetPath`, for evidence naming another file, or for a plan with no declaration.
   - The `implementationQuality` projection still carries no plan content (the Task 3 assertion holds with a declared plan).
2. Verify RED.
3. Implement:
   - In the `build_review` step runner, after rubric results join and using the already-resolved `planSource` and its derived target path, compute the qualifying `implementationQuality` `duplication` finding ids. Compare `evidenceLocations` entries after stripping any `:`-suffix.
   - Persist them as `declaredReplicationSuppressions` on the aggregate.
   - Parse and validate the field in `artifacts.ts` (absent means empty).
   - Make `deriveEffectiveBuildReviewVerdict` treat listed ids as suppressed.
4. Verify GREEN.
5. Commit: "feat(build-review): suppress declared-replication duplication findings".

**Done when:**
- [test] `step-runners.test.ts` asserts that for a declared plan the build_review step persists `declaredReplicationSuppressions` containing `{findingId, sourcePath, targetPath}` for a `duplication` finding anchored at the derived target whose evidence names only the source, and the effective verdict does not fail on it.
- [test] `step-runners.test.ts` asserts a `duplication` finding anchored outside the derived target, or whose evidence names a file other than the declared source, is absent from `declaredReplicationSuppressions` and fails the lap.
- [test] `step-runners.test.ts` asserts a plan with no `Pattern-source:` declaration yields an empty `declaredReplicationSuppressions` and suppresses nothing.
- [test] `build-review-aggregate.test.ts` asserts `deriveEffectiveBuildReviewVerdict` places ids listed in `declaredReplicationSuppressions` in `suppressedFindingIds`, and the `implementationQuality` projection for a declared plan still contains no plan text.

**Files likely touched:**
- `src/conductor/src/engine/step-runners.ts` — compute suppressions at join
- `src/conductor/src/engine/build-review-aggregate.ts` — record field and effective handling
- `src/conductor/src/engine/artifacts.ts` — aggregate field parsing
- `src/conductor/test/engine/step-runners.test.ts`, `src/conductor/test/engine/build-review-aggregate.test.ts` — tests

**Dependencies:** Task 7

### Task 10: Author the build-review-implementation-quality skill and bind its one-owner boundary
**Story:** 5, 6
**Type:** happy-path

**Steps:**
1. Write failing tests:
   - `build-review-skill-contract.test.ts`: the skill file exists in the shipped catalog with `agents/openai.yaml` (`allow_implicit_invocation: false`). Its result contract returns `findings` only, with no `scopeResolutions`, `counterfactualSensitivity`, or test-quality evidence fields.
   - A contract test fails when the skill text directs judging acceptance-criteria compliance, plan conformance, or ADR conformance. Seed each forbidden phrase in a fixture copy and assert the test names it.
2. Verify RED.
3. Implement `skills/build-review-implementation-quality/SKILL.md`, mirroring `skills/build-review-security/SKILL.md`'s structure. It contains:
   - A judgement-only purpose.
   - One finding per independent defect.
   - The introducing changed hunk as the required anchor, with other locations named only in `evidenceLocations`.
   - Each of the seven kinds defined with an explicit non-finding example.
   - Exclusion of style preferences, acceptance-criteria compliance (`prd_audit`), plan conformance, and ADR conformance (the as-built review).
   - An optional integer `confidence`.
   Add `agents/openai.yaml`.
4. Verify GREEN.
5. Commit: "feat(skills): build-review-implementation-quality rubric skill".

**Done when:**
- [test] `build-review-skill-contract.test.ts` asserts `skills/build-review-implementation-quality/SKILL.md` and its `agents/openai.yaml` exist and the skill's result contract names `findings` only, with no `scopeResolutions`, `counterfactualSensitivity`, or test-quality evidence field.
- [test] `test/test_provider_skill_contracts.sh` passes with the new skill resolved for a Codex-selected dispatch through its `agents/openai.yaml` (`allow_implicit_invocation: false`), as for `build-review-security`.
- [test] `build-review-skill-contract.test.ts` asserts the skill contract check fails naming the forbidden question when skill text directs judging acceptance-criteria compliance, plan conformance, or ADR conformance, and passes on the shipped skill.
- [test] `build-review-rubric-skills.test.ts` asserts the shipped skill text defines each of the seven concern kinds with a non-finding example, requires the introducing changed hunk as anchor, and excludes style preferences.

**Files likely touched:**
- `skills/build-review-implementation-quality/SKILL.md` — new skill
- `skills/build-review-implementation-quality/agents/openai.yaml` — Codex agent definition
- `src/conductor/test/engine/build-review-skill-contract.test.ts`, `src/conductor/test/engine/build-review-rubric-skills.test.ts` — tests
- `test/test_provider_skill_contracts.sh` — provider contract coverage for the new skill, if it enumerates skills

**Dependencies:** Task 5

### Task 11: Extend the rubric vocabulary integrity guard to implementationQuality
**Story:** 5
**Type:** negative-path

**Steps:**
1. Extend `test/check_build_review_rubric_skill_vocabularies.sh` to read `skills/build-review-implementation-quality/SKILL.md` and compare its declared kinds and anchor grammar against `BUILD_REVIEW_FINDING_VOCABULARIES.implementationQuality` in both directions, as it does for `security`.
2. Add the mismatch fixtures it uses: an extra kind and an omitted kind.
3. Run the script: it passes on the shipped skill, and each seeded mismatch fails naming the rubric and the kind.
4. Commit: "test(integrity): cover implementationQuality vocabulary".

**Done when:**
- [test] `test/check_build_review_rubric_skill_vocabularies.sh` exits 0 with the shipped `build-review-implementation-quality` skill and reports `implementationQuality` among the checked rubrics.
- [test] `test/check_build_review_rubric_skill_vocabularies.sh` exits non-zero naming `implementationQuality` and the kind when the skill declares a kind the engine lacks, and when it omits a kind the engine defines.

**Files likely touched:**
- `test/check_build_review_rubric_skill_vocabularies.sh` — new rubric coverage

**Dependencies:** Tasks 5, 10

### Task 12: Add the implementationQuality model-table row and refresh the build_review rationale
**Story:** 5
**Type:** happy-path

**Steps:**
1. Write failing tests:
   - `model-table-metadata.test.ts`: `AUXILIARY_MODEL_TABLE_ROWS` contains `build-review-implementation-quality` with the engine-managed auxiliary rubric path and the resolved rubric policy cells.
   - The `build_review` `STEP_RATIONALE` no longer says "explicitly enabled, criterion-bound test-quality concerns" and names the default-on implementation-quality rubric.
   - `generate-model-table.test.ts`: the generated table includes the new row.
2. Verify RED.
3. Implement the row and rationale text, then run `bin/generate-model-table` to regenerate the checked-in table.
4. Verify GREEN, and that the integrity check's staleness rule passes.
5. Commit: "feat(model-table): implementationQuality rubric row".

**Done when:**
- [test] `model-table-metadata.test.ts` asserts `AUXILIARY_MODEL_TABLE_ROWS` has a `build-review-implementation-quality` row with executionPath `engine-managed auxiliary rubric` and provider cells listing the resolved default rubric model and default effort `medium`.
- [test] `model-table-metadata.test.ts` asserts the `build_review` STEP_RATIONALE names the default-on implementation-quality rubric and no longer describes the grader as only explicitly enabled test-quality.
- [test] `generate-model-table.test.ts` asserts the regenerated model table contains the new row, and `runGenerateModelTable(['--check'])` exits 1 with remediation text instructing regeneration via `bin/generate-model-table` against a committed table that predates the row (the exit `test/test_harness_integrity.sh` gate 5a reports as FAIL) and exits 0 after regeneration.

**Files likely touched:**
- `src/conductor/src/engine/model-table-metadata.ts` — row and rationale
- `ARCHITECTURE.md` — regenerated model table
- `src/conductor/test/model-table-metadata.test.ts`, `src/conductor/test/generate-model-table.test.ts` — tests

**Dependencies:** Task 1

### Task 13: Pin implementation-quality judgement fixtures for defects and non-findings
**Story:** 6
**Type:** negative-path

**Steps:**
1. In `build-review-rubric-skills.test.ts`, add provider-payload fixtures for the five happy diffs, each validated through `parseBuildReviewJudgedResult` against the fixture's changed regions:
   - duplication: anchor the added hunk and name the existing block in `evidenceLocations`.
   - deep nesting → `excess-complexity`.
   - raw-string states → `primitive-obsession`.
   - boolean pair → `representable-invalid-state`.
   - catch-all switch → `non-exhaustive-domain-match`.
2. Add zero-finding fixtures for the five negative diffs: rename/reformat, partial acceptance criteria, an ADR-violating clean diff, a style-only diff, and duplication between unchanged files.
3. Verify each validates as stated, failing first where the fixture or contract is missing.
4. Commit: "test(build-review): implementationQuality judgement fixtures".

**Done when:**
- [test] `build-review-rubric-skills.test.ts` asserts the five happy fixtures validate via `parseBuildReviewJudgedResult` as judged FAIL, each with exactly one finding, with kinds duplication, excess-complexity, primitive-obsession, representable-invalid-state, and non-exhaustive-domain-match, each anchored to its introducing hunk, and the duplication fixture names the existing block in `evidenceLocations`.
- [test] `build-review-rubric-skills.test.ts` asserts the rename/reformat, partial-acceptance-criteria, ADR-violation, style-only, and unchanged-files-duplication fixtures validate as judged PASS results whose findings array is empty (zero findings).

**Files likely touched:**
- `src/conductor/test/engine/build-review-rubric-skills.test.ts` — fixtures and assertions

**Dependencies:** Tasks 5, 10

### Task 14: Keep the daemon end-to-end fixtures deterministic under the new default
**Story:** 1
**Type:** infrastructure

**Steps:**
1. Run the fixture-tier daemon end-to-end test with Task 1 applied and observe the unscripted `implementationQuality` dispatch (RED).
2. Implement:
   - In `daemon-e2e-fixture.e2e.test.ts`'s provider fake, script a judged PASS payload for the `implementationQuality` branch, keeping its existing `testQuality` script.
   - In `src/conductor/test/fixtures/live-e2e-run-body.ts`, set `implementationQuality: { enabled: false }` beside the existing `testQuality: { enabled: false }`, so the live tier pays for no extra dispatch.
3. Verify the fixture tier reaches a finished/mergeable state with no halt and no park (GREEN).
4. Commit: "test(e2e): account for default-on implementationQuality".

**Done when:**
- [test] `daemon-e2e-fixture.e2e.test.ts` asserts the daemon run with the default-on `implementationQuality` branch reaches a finished/mergeable state with no halt and no park, its provider fake answering that branch with a scripted judged PASS.
- `src/conductor/test/fixtures/live-e2e-run-body.ts` sets `build_review.rubrics.implementationQuality.enabled: false` beside `testQuality.enabled: false`.

**Files likely touched:**
- `src/conductor/test/engine/daemon-e2e-fixture.e2e.test.ts` — scripted PASS
- `src/conductor/test/fixtures/live-e2e-run-body.ts` — live-tier opt-out

**Dependencies:** Task 1

## Task Dependency Graph

```
Task 1 ─┬─ Task 2
        ├─ Task 3
        ├─ Task 4
        ├─ Task 5 ─┬─ Task 7 ─┬─ Task 8
        │          │          └─ Task 9
        │          ├─ Task 10 ─┬─ Task 11
        │          │           └─ Task 13
        ├─ Task 6 ─┘ (Task 7 also needs Task 6)
        ├─ Task 12
        └─ Task 14
```

## Integration Points

- After Task 1: a default-configured `build_review` step dispatches `implementationQuality` (the step-runner entry point).
- After Task 9: declared-replication suppression is observable in the persisted aggregate through the `build_review` step.
- After Task 14: the daemon fixture tier exercises the default-on rubric end to end.

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-08-22-build-review-opt-in-rubric-container#D1 | task | task-1, task-2 | yields `implementationQuality` `enabled: true` and `effort: 'medium'` while `testQuality` and `security` yield `enabled: false` |
| adr-2026-08-22-build-review-opt-in-rubric-container#D2 | no-change | none | Retired-key handling (`scope`, `completeness`, `rootCause`, `causalIntegrity`, `tautology`, `wiring`) is untouched; this feature adds a registered key and changes no retired-key path. |
| adr-2026-08-22-build-review-opt-in-rubric-container#D3 | no-change | none | test-quality's scope, preflight, and Covers binding are unchanged; this feature touches only test-quality fixtures that now also disable implementationQuality. |
| adr-2026-08-22-build-review-opt-in-rubric-container#D4 | task | task-5, task-6 | accepts a seven-kind payload with changed-region loci as an engine-stamped judged result with verdict FAIL |
| adr-2026-08-22-build-review-opt-in-rubric-container#D5 | no-change | none | Tier handling is unchanged: the new member is classified and dispatched identically at every tier, and the empty-container no-dispatch PASS now applies only when every member is disabled, per the D1 amendment. |
| adr-2026-08-22-one-owner-per-review-question#D1 | task | task-8, task-10 | with no `build` route, no appended plan task, and no `plan` route |
| adr-2026-08-21-review-bound-by-plan-done-when-criteria#D1 | no-change | none | The land-time `Done when:` shape rung is unchanged; this plan's tasks each carry a 2–5 line `Done when:` block. |
| adr-2026-08-21-review-bound-by-plan-done-when-criteria#D2 | no-change | none | No `boundTo` field is parsed in engine source, and the implementationQuality result contract emits none. This feature adds no binding grammar. |
| adr-2026-08-21-review-bound-by-plan-done-when-criteria#D3 | task | task-7 | and never in a beyond bucket |
| adr-2026-08-21-review-bound-by-plan-done-when-criteria#D4 | no-change | none | No `beyond` record kind is written for this rubric; its findings are never graded `beyond` (D3 amendment), so no beyond filing record arises. |
| adr-2026-08-21-review-bound-by-plan-done-when-criteria#D5 | no-change | none | Daemon beyond-filing is unchanged; implementationQuality findings never produce beyond records to file. |
| adr-2026-08-21-review-bound-by-plan-done-when-criteria#D6 | task | task-10 | the skill's result contract names `findings` only |
| adr-2026-08-09-declared-pattern-replication-in-build#D1 | no-change | none | The `Pattern-source:`/`Rename-map:` grammar and `resolvePlanPatternSource` are reused unchanged by Task 9. |
| adr-2026-08-09-declared-pattern-replication-in-build#D2 | no-change | none | acceptance_specs copying is untouched. |
| adr-2026-08-09-declared-pattern-replication-in-build#D3 | no-change | none | build Task-1 declared copy and copy-equivalence verification are untouched. |
| adr-2026-08-09-declared-pattern-replication-in-build#D4 | no-change | none | Delta-task closure semantics are untouched. |
| adr-2026-08-09-declared-pattern-replication-in-build#D5 | task | task-9 | persists `declaredReplicationSuppressions` containing `{findingId, sourcePath, targetPath}` |

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a project config that never mentions `implementationQuality`, when configuration is resolved, then `implementationQuality` resolves to `enabled: true` with default effort `medium`, and the build_review step classifies it as a dispatchable branch. | 1 | "yields `implementationQuality` `enabled: true` and `effort: 'medium'`" | diff-local |
| Story 1 happy: Given a project config with `build_review.rubrics.implementationQuality` set to an explicit `llm_provider`, `model`, `effort`, `model_fallback_ladder`, `max_retries`, `escalate`, and `min_confidence`, when its branch is classified, then the branch carries exactly those resolved values. | 1 | "resolves its `llm_provider`, `model`, `effort`, `model_fallback_ladder`, `max_retries`, `escalate`, and `min_confidence` exactly as configured on the classified branch" | diff-local |
| Story 1 happy: Given a project config that never mentions any rubric, when configuration is resolved, then `testQuality` and `security` still resolve to `enabled: false` and only `implementationQuality` is dispatched. | 1 | "classifies `implementationQuality` as the only dispatchable branch and dispatches it" | diff-local |
| Story 1 negative: Given `build_review.rubrics.implementationQuality.enabled: false`, with `testQuality` and `security` left at their defaults, when the lap runs, then the verdict is PASS with reason `build_review_no_rubrics` and no grader is dispatched. | 2 | "returns PASS with reason `build_review_no_rubrics` and zero grader dispatches" | diff-local |
| Story 1 negative: Given `build_review.rubrics.implementationQuality.enabled: "yes"`, when configuration is validated, then validation fails naming `build_review.rubrics.implementationQuality.enabled` and its expected boolean type, and no lap is dispatched. | 2 | "fails naming `build_review.rubrics.implementationQuality.enabled` and its boolean type, and no lap is dispatched for that config" | diff-local |
| Story 1 negative: Given `build_review.rubrics.implementationQuality.effort: extreme`, when configuration is validated, then validation fails naming the key and the allowed effort values. | 2 | "fails naming the key and listing the allowed effort values" | diff-local |
| Story 1 negative: Given `build_review.enabled: false`, when the build reaches build_review, then no implementation-quality judgement runs, even though the rubric defaults to enabled. | 2 | "the step dispatches no `implementationQuality` branch" | diff-local |
| Story 2 happy: Given an enabled `implementationQuality` and a feature diff, when its projection is built, then it contains the lap id, digests, `mergeBase`, `headSha`, and the changed files by reference, and nothing else. | 3 | "has exactly the keys lapId, digests, mergeBase, headSha, and changedFiles" | diff-local |
| Story 2 happy: Given a lap whose projection digest, engine identity, policy fingerprint, and skill digest all match a cached judged result, when the branch runs, then the cached result is reused and no provider dispatch occurs. | 4 | "is reused with zero provider dispatches" | diff-local |
| Story 2 happy: Given per-child build regions are implemented (#2942) and a stacked feature is built child by child, when build_review runs for a non-leaf child and for the leaf, then `implementationQuality` grades each child's own diff against its parent tip and is never skipped with reason `leaf-only`. | 3 | "a child-diff `implementationQuality` projection on a non-leaf child and on the leaf, with no `leaf-only` skip reason" | diff-local |
| Story 2 happy: Given a feature with no children, when build_review runs, then `implementationQuality` grades the same snapshot as every other enabled rubric. | 3 | "derives from the same snapshot digest as the other enabled rubrics" | diff-local |
| Story 2 negative: Given a plan body, accepted stories, and approved ADRs in the worktree, when the implementation-quality projection is built, then none of their content or paths appear in it. | 3 | "its JSON contains none of the fixture plan path, plan body, stories path, stories content, ADR path, or ADR content" | diff-local |
| Story 2 negative: Given a cached result for the same projection, when `skills/build-review-implementation-quality/SKILL.md` has changed since that result was cached, then the cache misses and the diff is re-judged. | 4 | "a changed `build-review-implementation-quality` SKILL.md digest" | diff-local |
| Story 2 negative: Given a cached result for the same projection, when the resolved policy (provider, model, or effort) changes, then the cache misses and the diff is re-judged. | 4 | "a changed resolved provider, model, or effort, each produce a cache miss and a re-judge dispatch" | diff-local |
| Story 2 negative: Given the rubric skill file is missing or unreadable, when the branch is prepared, then the branch settles as an infrastructure failure naming the skill path, and it records no PASS. | 4 | "each settle the branch as `infrastructure-failure` whose detail names that path, and the lap records no PASS" | diff-local |
| Story 3 happy: Given a provider payload whose findings each use a `concernKind` from the closed set `duplication`, `excess-complexity`, `obscured-intent`, `primitive-obsession`, `representable-invalid-state`, `non-exhaustive-domain-match`, and `non-semantic-name`, each anchored by a content-region `locus` that matches a changed content region, when the result is validated, then it is accepted as an engine-stamped judged result with verdict `FAIL`. | 5 | "accepts a seven-kind payload with changed-region loci as an engine-stamped judged result with verdict FAIL" | diff-local |
| Story 3 happy: Given a provider payload with an empty findings array, when the result is validated, then it is accepted as a judged result with verdict `PASS`. | 5 | "an empty findings array as verdict PASS" | diff-local |
| Story 3 happy: Given the same defect reported in two laps with different summary wording but the same `concernKind` and `locus`, when identity is computed, then both findings resolve to the same stable finding identity. | 6 | "returns equal ids for two `implementationQuality` findings that share concernKind and locus but differ in summary" | diff-local |
| Story 3 negative: Given a finding with `concernKind: unmet-acceptance-criterion` or any other value outside the closed set, when the result is validated, then the payload is rejected as invalid, naming the offending kind. | 5 | "are each rejected as invalid with a diagnostic naming the offending kind, anchor, or field" | diff-local |
| Story 3 negative: Given a finding whose `locus` content hash matches no changed content region, when the result is validated, then the payload is rejected as invalid, naming the unmatched anchor. | 5 | "are each rejected as invalid with a diagnostic naming the offending kind, anchor, or field" | diff-local |
| Story 3 negative: Given a finding anchored by line number instead of a content-region reference, when the result is validated, then the payload is rejected as invalid. | 5 | "are each rejected as invalid with a diagnostic naming the offending kind, anchor, or field" | diff-local |
| Story 3 negative: Given a finding that carries `scopeResolutions`, `counterfactualSensitivity`, or test-quality evidence fields, when the result is validated, then the payload is rejected as invalid. | 5 | "are each rejected as invalid with a diagnostic naming the offending kind, anchor, or field" | diff-local |
| Story 3 negative: Given an invalid payload, when the single repair turn also returns an invalid payload, then the branch settles in the mechanical-fault lane and records no PASS and no content finding. | 5 | "settles in the mechanical-fault lane, recording no PASS and no content finding" | diff-local |
| Story 4 happy: Given a lap where `implementationQuality` returns one finding at or above `min_confidence`, when the lap is aggregated, then the outer verdict is FAIL and the finding is passed to the adjudicator as a raw source. | 7 | "returns FAIL with the finding id in `unresolvedFindingIds`" | diff-local |
| Story 4 happy: Given the adjudicator acts on the finding with a repair task that cites an admitted plan task id and an admission rationale, when routing is decided, then the build is kicked back with that bounded work order, and the kickback is counted against `build_review`'s per-gate and cumulative caps. | 8 | "routes `build` with that work order and increments the `build_review` per-gate and cumulative kickback counts" | diff-local |
| Story 4 happy: Given a lap where `implementationQuality` fails and `testQuality` and `security` pass, when the lap is aggregated, then the outer verdict is FAIL and the passing rubrics' results are preserved unchanged. | 7 | "preserves the passing rubric results byte-identical in the aggregate" | diff-local |
| Story 4 negative: Given a finding below the rubric's `min_confidence`, when the lap is aggregated, then the finding is recorded as suppressed and does not fail the lap. | 7 | "lands in `suppressedFindingIds` and the effective verdict is PASS" | diff-local |
| Story 4 negative: Given the adjudicator proposes a repair task that cites no admitted plan task id, when the case is validated, then it is rejected as `missing-admission-task`, and the finding is deferred to intake or escalated, not sent to BUILD. | 8 | "is rejected `missing-admission-task` and the finding is deferred to intake or escalated" | diff-local |
| Story 4 negative: Given an implementation-quality finding of any kind, when it is adjudicated, then no plan task is appended and the route is never `plan`. | 8 | "adjudication appends no plan task and never yields a `plan` route" | diff-local |
| Story 4 negative: Given the cumulative build_review kickback cap is already reached, when another lap fails on an implementation-quality finding, then the feature halts for a human instead of kicking back again. | 8 | "halts for a human instead of kicking back" | diff-local |
| Story 4 negative: Given a finding the operator has accepted or refuted in a prior lap, when the same finding identity recurs on unchanged code, then it does not fail the new lap. | 8 | "leaves the effective verdict PASS" | diff-local |
| Story 5 happy: Given `skills/build-review-implementation-quality/SKILL.md` declares exactly the engine's seven concern kinds and anchor grammar, when `test/check_build_review_rubric_skill_vocabularies.sh` runs, then it passes for the new rubric alongside `testQuality` and `security`. | 11 | "exits 0 with the shipped `build-review-implementation-quality` skill" | diff-local |
| Story 5 happy: Given the shipped skill catalog, when a Codex-selected build dispatches the rubric, then the skill resolves with its `agents/openai.yaml` definition, as `build-review-security` does. | 10 | "passes with the new skill resolved for a Codex-selected dispatch through its `agents/openai.yaml`" | diff-local |
| Story 5 happy: Given the generated model table, when it is regenerated from the model-table metadata, then it lists the implementation-quality rubric role with its default model and effort. | 12 | "the regenerated model table contains the new row" | diff-local |
| Story 5 negative: Given the skill declares a concern kind the engine does not define, or omits one the engine defines, when the vocabulary check runs, then it fails naming the rubric and the mismatched kind. | 11 | "exits non-zero naming `implementationQuality` and the kind" | diff-local |
| Story 5 negative: Given the skill text instructs the grader to judge acceptance-criteria compliance, plan conformance, or ADR conformance, when the skill contract test runs, then it fails naming the forbidden question. | 10 | "fails naming the forbidden question" | diff-local |
| Story 5 negative: Given the generated model table is stale after the metadata change, when the integrity check runs, then it fails, reporting that the table must be regenerated. | 12 | "exits 1 with remediation text instructing regeneration via `bin/generate-model-table`" | diff-local |
| Story 6 happy: Given a diff that adds a block of logic duplicating an existing block in a changed file, when the rubric judges it, then it returns one `duplication` finding anchored to the added hunk, with the existing block named in `evidenceLocations`. | 13 | "validate via `parseBuildReviewJudgedResult` as judged FAIL" | diff-local |
| Story 6 happy: Given a diff that adds a function nesting four or more conditional levels where a flat structure expresses the same logic, when the rubric judges it, then it returns one `excess-complexity` finding anchored to that function's hunk. | 13 | "validate via `parseBuildReviewJudgedResult` as judged FAIL" | diff-local |
| Story 6 happy: Given a diff that stores a fixed set of domain states as raw strings compared by literal across call sites, when the rubric judges it, then it returns one `primitive-obsession` finding anchored to the introducing hunk. | 13 | "validate via `parseBuildReviewJudgedResult` as judged FAIL" | diff-local |
| Story 6 happy: Given a diff that models one state with two independent booleans whose combination allows an impossible state, when the rubric judges it, then it returns one `representable-invalid-state` finding anchored to the introducing hunk. | 13 | "validate via `parseBuildReviewJudgedResult` as judged FAIL" | diff-local |
| Story 6 happy: Given a diff that adds a switch over a closed domain union with a catch-all default that hides unhandled members, when the rubric judges it, then it returns one `non-exhaustive-domain-match` finding anchored to that switch's hunk. | 13 | "validate via `parseBuildReviewJudgedResult` as judged FAIL" | diff-local |
| Story 6 negative: Given a diff that only renames variables, reformats, or reorders imports, when the rubric judges it, then it returns zero findings. | 13 | "validate as judged PASS results whose findings array is empty (zero findings)" | diff-local |
| Story 6 negative: Given a diff that implements only part of a story's acceptance criteria, but whose added code is clean, when the rubric judges it, then it returns zero findings, because acceptance-criteria compliance belongs to `prd_audit`. | 13 | "validate as judged PASS results whose findings array is empty (zero findings)" | diff-local |
| Story 6 negative: Given a diff that violates an approved ADR's decision but has clean code, when the rubric judges it, then it returns zero findings, because ADR conformance belongs to the as-built review. | 13 | "validate as judged PASS results whose findings array is empty (zero findings)" | diff-local |
| Story 6 negative: Given a diff whose only issue is a style preference (quote style, brace placement, or line length), when the rubric judges it, then it returns zero findings. | 13 | "validate as judged PASS results whose findings array is empty (zero findings)" | diff-local |
| Story 6 negative: Given a diff whose duplicated logic exists only between two unchanged files, when the rubric judges it, then it returns zero findings, because no changed hunk introduces the defect. | 13 | "validate as judged PASS results whose findings array is empty (zero findings)" | diff-local |
| Story 6 negative: Given an active plan whose resolved `Pattern-source:`/`Rename-map:` declaration names a source and target, when the rubric returns a `duplication` finding anchored in the declared target whose evidence names only the declared source, then the engine suppresses that finding before aggregation, records the suppression, and the finding does not fail the lap. | 9 | "persists `declaredReplicationSuppressions` containing `{findingId, sourcePath, targetPath}`" | diff-local |
| Story 6 negative: Given the same declared plan, when the rubric returns a `duplication` finding anchored in a file outside the declared target set, or whose evidence names a file other than the declared source, then the finding is not suppressed and fails the lap as usual. | 9 | "is absent from `declaredReplicationSuppressions` and fails the lap" | diff-local |

## Verification
- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work, except compile-atomic Task 1 (see Technical Approach)
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic
