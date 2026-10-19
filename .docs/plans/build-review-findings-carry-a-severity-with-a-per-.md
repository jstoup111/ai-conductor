# Implementation Plan: build_review findings carry a severity with a per-rubric advisory threshold

**Date:** 2026-10-19
**Design:** .docs/decisions/adr-2026-10-19-build-review-finding-severity-advisory-threshold.md
**Stories:** .docs/stories/build-review-findings-carry-a-severity-with-a-per-.md
**Conflict check:** Clean as of 2026-10-19 (.docs/conflicts/2026-10-19-build-review-findings-carry-a-severity-with-a-per-.md)
**Scope-exception:** Operator declined splitting the adjudicator downgrade (ADR D6/D7) into a second spec on 2026-10-19 and accepted a single plan of about 20 tasks.

## Summary

This plan adds the following, in 21 tasks:
- a required reviewer-assigned `severity` on built-in (contract v4) and custom (custom-findings v2) build_review findings;
- a per-rubric `min_severity` threshold;
- an `advisory` effective-verdict bucket that never reaches remediate or charges budget;
- durable and visible advisory records on the event spine, the CLI and the PR;
- an adjudicator `advisory` downgrade whose settled recurrence holds only while the threshold admits it.

## Technical Approach

- **Severity domain type.** `build-review-domain.ts` gains a closed `BuildReviewSeverity` union (`critical | major | minor | nit`) and one total-order comparator, `isBelowSeverityThreshold(severity, threshold)`. Every later comparison uses it. No numeric encoding is ever persisted.
- **Contracts.**
  - Built-in judged results move to `v4`. `CURRENT_BUILD_REVIEW_RUBRIC_CONTRACT_VERSION` becomes `'v4'`, the native JSON schema requires `severity` as a closed enum, and `finding()` requires it only when the result's contract version is `v4`. v1–v3 persisted results keep parsing with no severity.
  - Custom results move to `custom-findings` `v2` with the same rule.
  - Identity code is untouched. Severity never enters the canonical payload, and built-in contract version already does, so built-in ids re-key once (ADR D2); custom ids do not, because the custom identity grammar pins `version: 'v1'`.
- **Configuration.** `min_severity` is added to both key sets in `config.ts`, validated against the closed set, typed in `types/config.ts`, and resolved as an optional field with no default in `resolved-config.ts`.
- **Threshold helper.** `buildReviewConfidenceFloors` (`build-review-effective.ts`) generalizes into one thresholds helper that returns `{ minConfidence, minSeverity? }` per rubric id, for built-in and custom rubrics. The gate-completion path in `artifacts.ts` stops building its own built-in-only floor map and calls the helper.
- **Advisory bucket.** It is added in both reducers, `deriveEffectiveBuildReviewVerdict` (`build-review-aggregate.ts`) and the custom branch of `build-review-effective.ts`. Classification order is accepted, settled, replication, suppressed, advisory, unresolved, and only unresolved blocks. The coordinator's live-source filter (`allOperatorResolved` and the live-source set in `build-review-adjudication-coordinator.ts`) excludes advisory exactly as it excludes suppressed.
- **Persistence and visibility.**
  - `RemediationCaseSuppressionEntry` (`remediation-case-store.ts`) becomes a discriminated union by `kind`, and a legacy entry without `kind` reads as `confidence`. `persistBuildReviewSuppressions` (`build-review-suppression-history.ts`) upserts severity-kind entries.
  - `build_review_outer_verdict` (`types/events.ts`) gains optional `advisoryFindings`. It is emitted in `step-runners.ts` beside `suppressedFindings` and rendered in `daemon-cli.ts`.
  - The adjudication context (`build-review-adjudication-context.ts`) carries advisory history and the per-rubric declared thresholds.
  - `build-review findings` (`build-review-cli.ts`) lists advisory findings.
  - A new engine-owned PR region `## Advisory build-review findings` is rendered from the store by finish publication (`finish-publication-production.ts`) and registered in `ENGINE_OWNED_PR_BODY_TEXTS` (`build-review-accepted-risk.ts`) so `pr-body-regions.ts` masks forged copies.
- **Adjudicator downgrade.**
  - `RemediationCaseDisposition` gains `advisory` (`remediation-case-artifact.ts`), parsed in both case modes with `adjudicatedSeverity` and effect `none`.
  - `remediation-case-validator.ts` validates it against the context's declared thresholds and each source's reviewer severity.
  - `reduceBuildReviewAdjudication` treats it as a finalized non-action outcome.
  - `finalizedBuildReviewSourceIds` (`remediation-case-store.ts`) admits an advisory case only while each source rubric's current threshold is strictly above its adjudicated severity, so it now takes the resolved thresholds as input.
- **Skills.** The three built-in rubric skills and `skills/remediate/SKILL.md` gain severity and downgrade guidance. The custom-review contract text comes from `build-review-policy-contract.ts`.
- **Sequencing.** Domain and contract first (Tasks 1–7), then config and helper (8–9), reducers and coordinator (10–12), persistence and surfaces (13–17), and finally the downgrade (18–21).

### Local pattern context

- **Concern: the advisory bucket and its persistence.** Precedent: the confidence-floor suppression from #2383.
  - **Traits:**
    - classified in the effective reducers before the pass/fail fork;
    - one idempotent upsert seam keyed by exact finding id, called on PASS and FAIL laps;
    - entries are never pruned;
    - excluded from live sources;
    - a non-blocking context section;
    - an additive optional event field.
  - **Allowed variation:** a discriminated entry kind instead of a second list.
  - **Search hints:** `minConfidence`, `suppressed`, `persistBuildReviewSuppressions`, `suppressedFindings`, `allOperatorResolved`.
- **Concern: context-gated judgement disposition.** Precedent: `case-v2` admitting `escalate` in `remediation-case-artifact.ts` and `remediation-case-validator.ts`.
  - **Trait:** the parser and validator admit the extra disposition only under an engine-declared condition.
  - **Variation:** gated by declared thresholds, not by mode.
  - **Search hints:** `'escalate'`, `mode === 'case-v2'`.

## Prerequisites

- jstoup111/ai-conductor#3271 is built first, recorded at land as a dependency. Its shared acceptance resolver lives in the same reducers and coordinator, so this plan's reducer edits land on top of it.
- No change to this repository's `.ai-conductor/config.yml`.

## Tasks

### Task 1: Closed severity type and threshold comparator
**Story:** Story 1
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/build-review-domain.test.ts`:
   - `parseBuildReviewSeverity` accepts exactly `critical`, `major`, `minor`, `nit`, and returns undefined for `blocker`, `Major`, `2` and `null`;
   - `isBelowSeverityThreshold(s, t)` is true only when `s` ranks strictly below `t`, under the order `critical > major > minor > nit`.
2. Verify RED.
3. Implement in `build-review-domain.ts`:
   - the `BuildReviewSeverity` union and `BUILD_REVIEW_SEVERITIES`;
   - `parseBuildReviewSeverity`;
   - `isBelowSeverityThreshold`, as an exhaustive switch with no default branch.
4. Verify GREEN.
5. Commit.

**Done when:**
- [test] `parseBuildReviewSeverity` returns the value for each of critical, major, minor and nit and returns undefined for `blocker`, `Major`, the number 2 and null.
- [test] `isBelowSeverityThreshold` returns true for nit below major and minor below major, and false for major at major, critical at major and nit at nit.

**Files likely touched:**
- src/conductor/src/engine/build-review-domain.ts
- src/conductor/test/engine/build-review-domain.test.ts

**Dependencies:** none

### Task 2: Built-in judged contract v4 requires severity
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `build-review-domain.test.ts`:
   - a fresh v4 result with findings at each severity parses, retaining each value unchanged;
   - a v4 finding with severity major and confidence 40 retains both;
   - a persisted v3 aggregate parses with no severity on its findings;
   - `buildReviewJudgedV3Schema` (renamed for the current version) lists `severity` in `required` with enum exactly the four values.
2. Verify RED.
3. Implement:
   - add `'v4'` to `BuildReviewRubricContractVersion` and its parser, and set `CURRENT_BUILD_REVIEW_RUBRIC_CONTRACT_VERSION = 'v4'`;
   - add `severity` to the judged schema's finding `properties` and `required`;
   - in `finding()`, require `parseBuildReviewSeverity` when the result's contract version is v4, and keep v1–v3 parsing unchanged;
   - carry `severity?: BuildReviewSeverity` on `BuildReviewFinding`.
4. Verify GREEN.
5. Commit.

**Done when:**
- [test] `parseBuildReviewJudgedResult` on a v4 result with findings at critical, major, minor and nit returns each finding with its severity unchanged, and a minor finding is retained as minor.
- [test] A parsed v4 finding carrying severity major and confidence 40 exposes severity major and confidence 40, and neither value is derived from the other.
- [test] A persisted v3 judged result parses through `parseBuildReviewJudgedResult` and its findings carry no severity property.
- [test] The current judged native schema rendered by `renderRubricContractShape` for each built-in rubric lists severity in `required` with enum exactly critical, major, minor and nit.

**Files likely touched:**
- src/conductor/src/engine/build-review-domain.ts
- src/conductor/test/engine/build-review-domain.test.ts
- src/conductor/test/engine/build-review-contract.test.ts

**Dependencies:** Task 1

### Task 3: Malformed or stale built-in results are rejected, and #2384 version pins are updated
**Story:** Story 1
**Type:** negative-path

**Steps:**
1. Write failing tests in `build-review-domain.test.ts`. Each of the following v4 findings makes `parseBuildReviewJudgedResult` return undefined, and `diagnoseBuildReviewJudgedResultRejection` names `severity`:
   - severity omitted;
   - `"blocker"`;
   - `"Major"`;
   - `2`.

   Also, a fresh result declaring v3 is diagnosed with `contractVersion must be "v4"`.
2. Update the existing tests that pin the old version so they assert the current version:
   - `build-review-domain.test.ts`
   - `build-review-contract.test.ts`
   - `build-review-step.test.ts`
   - `build-review-policy-contract.test.ts`
   - `test/execution/codex-strict-schema.test.ts`
3. Verify RED.
4. Implement the diagnosis entries.
5. Verify GREEN.
6. Commit.

**Done when:**
- [test] A v4 finding with severity omitted, `"blocker"`, `"Major"` or the number 2 makes `parseBuildReviewJudgedResult` return undefined, so the whole rubric result takes the existing invalid-field path, and the rejection diagnosis names the severity field.
- [test] A fresh current-lap result declaring contractVersion v3 is rejected by `diagnoseBuildReviewJudgedResultRejection` with a problem naming contractVersion must be v4.
- [test] No test in the touched files asserts that the current built-in contract version equals v3.

**Files likely touched:**
- src/conductor/src/engine/build-review-domain.ts
- src/conductor/test/engine/build-review-domain.test.ts
- src/conductor/test/engine/build-review-contract.test.ts
- src/conductor/test/engine/build-review-step.test.ts
- src/conductor/test/engine/build-review-policy-contract.test.ts
- src/conductor/test/execution/codex-strict-schema.test.ts

**Dependencies:** Task 2

### Task 4: A v3 cache entry is not reused under v4
**Story:** Story 1
**Type:** negative-path

**Steps:**
1. Write failing tests in `build-review-cache.test.ts`:
   - a cached v3 rubric result for the same projection misses on lookup, and the reviewer is re-dispatched under v4;
   - `parseBuildReviewCacheEntry` accepts a v4 entry and rejects a v5 entry.
2. Update the #2384 assertion that rejects `contractVersion: v4` so it rejects a version above the current one.
3. Verify RED.
4. Implement any cache-entry version admission change in `build-review-cache.ts`.
5. Verify GREEN.
6. Commit.

**Done when:**
- [test] A cache entry written under contract v3 for an unchanged projection is not served by the build-review cache lookup, and the step runner dispatches the reviewer, whose stored entry declares v4.
- [test] `parseBuildReviewCacheEntry` accepts a v4 entry and rejects an entry declaring v5 as invalid.

**Files likely touched:**
- src/conductor/src/engine/build-review-cache.ts
- src/conductor/test/engine/build-review-cache.test.ts

**Dependencies:** Task 2

### Task 5: Custom-findings contract v2 requires severity
**Story:** Story 2
**Type:** happy-path

**Steps:**
1. Write failing tests in `build-review-domain.test.ts`:
   - a fresh v2 custom-findings payload with a nit finding parses with severity nit;
   - a persisted v1 payload parses with no severity;
   - severity omitted, an unknown value, or a v1 current-lap payload is rejected, and the diagnosis names `severity` or `version must be "v2"`;
   - an extra unknown key is still rejected.
2. Verify RED.
3. Implement:
   - `BuildReviewCustomFindingContractVersion = 'v1' | 'v2'`;
   - `severity` added to `CUSTOM_FINDING_KEYS` and to `BUILD_REVIEW_CUSTOM_V1_SCHEMA` (renamed for the current version) as a required enum;
   - the parser requires severity at v2;
   - fresh dispatch requires v2.
4. Verify GREEN.
5. Commit.

**Done when:**
- [test] The custom-findings parser returns a v2 finding carrying severity nit with that severity retained.
- [test] A persisted custom-findings v1 payload parses for reads and its findings carry no severity property.
- [test] A v2 custom finding with severity omitted or an unknown severity value makes the whole custom result malformed, and the custom rejection diagnosis names the severity field.
- [test] A current-lap custom payload declaring version v1 is rejected with a diagnosis naming version must be v2, and a v2 finding carrying an extra unknown key is still rejected by exact-key parsing.

**Files likely touched:**
- src/conductor/src/engine/build-review-domain.ts
- src/conductor/test/engine/build-review-domain.test.ts
- src/conductor/test/engine/build-review-policy-contract.test.ts

**Dependencies:** Task 1

### Task 6: Severity never enters identity, and version re-keys ids
**Story:** Story 3
**Type:** happy-path

**Steps:**
1. Write tests in `build-review-finding-identity.test.ts` and `build-review-effective.test.ts`:
   - two v4 findings differing only in severity share an id, and the canonical payload has no severity key;
   - the same comparison holds for custom v2 findings;
   - v3 and v4 findings with otherwise equal identity inputs get different ids;
   - a disposition accepted on a major v4 finding still binds when that finding is re-graded nit;
   - a v3 disposition against a v4 lap emits `build_review_disposition_version_invalidated` and does not bind;
   - re-accepting the v4 finding binds on the next lap.

   Update the #2384 custom-id parity test to compare under the current custom version.
2. Verify RED, then make any fix needed so identity stays severity-blind.
3. Verify GREEN.
4. Commit.

**Done when:**
- [test] `canonicalizeBuildReviewFindingIdentity` returns one id for two v4 findings that differ only in severity, the custom identity function returns one id for two custom v2 findings that differ only in severity, and neither canonical payload contains a severity key.
- [test] A v3 finding and a v4 finding with equal rubric, concern kind and anchor produce different ids from `canonicalizeBuildReviewFindingIdentity`.
- [test] `resolveEffectiveBuildReviewVerdict` records as accepted a v4 finding re-graded from major to nit under a disposition recorded at major.
- [test] A custom-findings v1 finding and a custom-findings v2 finding with equal rubric, declaration, policy, candidate, reviewed input, concern id and source regions produce the same id from the custom identity function.
- [test] For a v3 disposition evaluated on a v4 lap, `resolveEffectiveBuildReviewVerdict` emits `build_review_disposition_version_invalidated` and leaves the finding unresolved; after a v4 disposition is recorded through the build-review accept path, the next resolution records it as accepted.

**Files likely touched:**
- src/conductor/test/engine/build-review-finding-identity.test.ts
- src/conductor/test/engine/build-review-effective.test.ts
- src/conductor/src/engine/build-review-finding-identity.ts

**Dependencies:** Tasks 2, 5

### Task 7: Rubric skills and custom contract state severity guidance
**Story:** Story 1, Story 2
**Type:** happy-path

**Steps:**
1. Write failing assertions in `build-review-rubric-skills.test.ts`:
   - each of `skills/build-review-test-quality/SKILL.md`, `skills/build-review-security/SKILL.md` and `skills/build-review-implementation-quality/SKILL.md` states the required severity field and defines critical, major, minor and nit by impact;
   - the custom-review contract text rendered by `build-review-policy-contract.ts` does the same.
2. Verify RED.
3. Edit the three skills, adding per-concern-kind guidance under their Result sections:
   - security exposure, data loss, or wrong results is critical;
   - a real defect or broken invariant is major;
   - a real low-impact quality issue is minor;
   - cosmetic naming or style is nit.
4. Add the same to the custom contract text.
5. Verify GREEN.
6. Commit.

**Done when:**
- [test] For each of the three built-in rubric skills, the rubric skill contract test asserts that the skill text names severity as required and defines critical, major, minor and nit by impact.
- [test] The custom-review contract text produced by the policy contract renderer names severity as required with exactly the four values and defines each level.

**Files likely touched:**
- skills/build-review-test-quality/SKILL.md
- skills/build-review-security/SKILL.md
- skills/build-review-implementation-quality/SKILL.md
- src/conductor/src/engine/build-review-policy-contract.ts
- src/conductor/test/engine/build-review-rubric-skills.test.ts

**Dependencies:** Tasks 2, 5

### Task 8: `min_severity` configuration key for built-in and custom rubrics
**Story:** Story 4
**Type:** happy-path

**Steps:**
1. Write failing tests in the config test suite:
   - `build_review.rubrics.implementationQuality.min_severity: major` resolves to policy threshold `major`;
   - `custom_rubrics.eventSpine.min_severity: minor` resolves to `minor`;
   - an undeclared key resolves to no threshold field;
   - `blocker`, `2` and `Major` fail validation, naming the key and the allowed values.
2. Verify RED.
3. Implement:
   - add `min_severity` to both key sets in `config.ts`, validated through `parseBuildReviewSeverity`;
   - add it to `BuildReviewRubricConfig` and the custom rubric config type;
   - resolve it as an optional field in `resolved-config.ts`;
   - declare it in `config-consumer-registry.ts`.
4. Verify GREEN.
5. Commit.

**Done when:**
- [test] Resolved config carries policy threshold major for implementationQuality from `min_severity: major` and minor for the eventSpine custom rubric from `min_severity: minor`.
- [test] A rubric with no min_severity key resolves to a policy with no threshold property, not a defaulted value.
- [test] Config validation rejects `min_severity: blocker` on a built-in rubric, `min_severity: 2` on a custom rubric and `min_severity: Major` on a built-in rubric, with a validation error naming the min_severity key and the allowed values critical, major, minor and nit.
- [test] The config-consumer registry test passes with min_severity declared for both build_review.rubrics and build_review.custom_rubrics.

**Files likely touched:**
- src/conductor/src/engine/config.ts
- src/conductor/src/types/config.ts
- src/conductor/src/engine/resolved-config.ts
- src/conductor/test/engine/config-consumer-registry.ts
- src/conductor/test/engine/config.test.ts

**Dependencies:** Task 1

### Task 9: One thresholds helper, used by gate completion
**Story:** Story 4
**Type:** refactor

**Steps:**
1. Write failing tests:
   - `buildReviewThresholds(config)` returns `{minConfidence, minSeverity}` per built-in and custom rubric id;
   - with a custom rubric at min_confidence 70 and min_severity major, the build_review gate-completion predicate in `artifacts.ts` classifies a lap the same way the effective verdict does;
   - changing only min_severity between two laps with identical inputs reuses the rubric cache entry.
2. Verify RED.
3. Implement:
   - generalize `buildReviewConfidenceFloors` into `buildReviewThresholds`;
   - migrate its callers in `step-runners.ts`, `conductor.ts` and `build-review-cli.ts`;
   - replace the private floor maps in `artifacts.ts` with the helper;
   - keep min_severity out of `fingerprintBuildReviewRubricPolicy`.
4. Verify GREEN.
5. Commit.

**Done when:**
- [test] `buildReviewThresholds` returns the declared min_confidence and min_severity for both a built-in rubric and a custom rubric id, and returns no minSeverity for a rubric that declares `min_severity: nit`.
- [test] The artifacts.ts build_review gate-completion predicate obtains every floor and threshold from `buildReviewThresholds` for built-in and custom rubrics, and artifacts.ts contains no other floor map.
- [test] `fingerprintBuildReviewRubricPolicy` returns an identical fingerprint for policies differing only in min_severity, so the second lap's rubric cache entry is reused.

**Files likely touched:**
- src/conductor/src/engine/build-review-effective.ts
- src/conductor/src/engine/artifacts.ts
- src/conductor/src/engine/step-runners.ts
- src/conductor/src/engine/conductor.ts
- src/conductor/src/engine/build-review-cli.ts
- src/conductor/src/engine/build-review-registry.ts
- src/conductor/test/engine/build-review-effective.test.ts
- src/conductor/test/engine/build-review-registry.test.ts

**Dependencies:** Task 8

### Task 10: Built-in effective verdict classifies advisory findings
**Story:** Story 5
**Type:** happy-path

**Steps:**
1. Write failing tests in `build-review-aggregate.test.ts` for `deriveEffectiveBuildReviewVerdict` under threshold major (and the floor where stated):
   - a lone minor, confidence-96 finding goes to `advisory` and the verdict is PASS;
   - a major finding goes to `unresolved`;
   - with nit and critical findings, only the nit is advisory and the verdict is FAIL;
   - with no threshold, a nit finding is unresolved;
   - at threshold nit, a nit finding is unresolved;
   - at floor 70, a finding with confidence 40 and severity minor is suppressed;
   - a critical finding with confidence 95 is unresolved;
   - an accepted finding below threshold is accepted;
   - a persisted v3 finding with no severity is never advisory.
2. Verify RED.
3. Implement the `advisory` bucket after the confidence check, using `isBelowSeverityThreshold`. Repeat the pattern traits: same reducer, same position before the pass/fail formula, only `unresolved` blocks. Search hint: the `minConfidence` branch.
4. Verify GREEN.
5. Commit.

**Done when:**
- [test] `deriveEffectiveBuildReviewVerdict` under threshold major places a lone minor finding at confidence 96 in advisory with an empty unresolved set and an effective verdict of PASS.
- [test] Under threshold major, a major finding is unresolved, and a lap with one nit and one critical finding has only the nit in advisory with an effective verdict of FAIL.
- [test] With no threshold a nit finding is unresolved and the effective verdict is FAIL; at threshold nit a nit finding is unresolved; and a persisted finding with no severity is unresolved under any threshold.
- [test] With floor 70 and threshold major, a confidence-40 minor finding is suppressed and not advisory, a confidence-40 critical finding is suppressed, and a confidence-95 critical finding is unresolved.
- [test] A finding with an operator disposition that is also below the threshold is in accepted and absent from advisory, matching the classification order accepted, settled, replication, suppressed, advisory, unresolved.

**Files likely touched:**
- src/conductor/src/engine/build-review-aggregate.ts
- src/conductor/test/engine/build-review-aggregate.test.ts

**Dependencies:** Tasks 2, 9

### Task 11: Custom effective verdict classifies advisory findings
**Story:** Story 5, Story 4
**Type:** happy-path

**Steps:**
1. Write failing tests in `build-review-effective.test.ts`:
   - a custom rubric with min_severity major and a minor custom finding is advisory and does not block;
   - a persisted custom v1 finding is never advisory;
   - the gate-completion predicate agrees with the effective verdict on a fixture holding a suppressed and an advisory custom finding.
2. Verify RED.
3. Implement the same bucket in the custom branch of `build-review-effective.ts`, mirroring Task 10's order and traits.
4. Verify GREEN.
5. Commit.

**Done when:**
- [test] `resolveEffectiveBuildReviewVerdict` for a custom rubric with min_severity major places a minor custom finding in advisory, leaves the unresolved set empty, and reports an effective PASS.
- [test] The custom branch applies the same order, with the confidence floor before the severity threshold, as asserted by a confidence-40 minor custom finding landing in suppressed under floor 70.
- [test] After an effective verdict with an advisory finding, `BuildReviewDispositionStore.list` returns no accepted-risk disposition for it, because advisory classification never writes to the operator disposition store.
- [test] Under a declared custom min_severity, a persisted custom-findings v1 finding with no severity is unresolved and never advisory.
- [test] For a custom rubric with min_confidence 70 and min_severity major and a lap fixture holding a confidence-40 custom finding and a confidence-90 minor custom finding, the artifacts.ts build_review gate-completion predicate classifies the first as suppressed and the second as advisory and completes the gate, exactly as `resolveEffectiveBuildReviewVerdict` does for the same fixture.

**Files likely touched:**
- src/conductor/src/engine/build-review-effective.ts
- src/conductor/test/engine/build-review-effective.test.ts
- src/conductor/src/engine/artifacts.ts

**Dependencies:** Tasks 5, 9, 10

### Task 12: Advisory findings never reach remediate or charge budget
**Story:** Story 5
**Type:** happy-path

**Steps:**
1. Write failing tests:
   - in `build-review-adjudication-coordinator.test.ts`, a mixed lap of one advisory and one unresolved finding produces live sources containing only the unresolved id, and the judgement validator demands no outcome for the advisory id;
   - in `conductor-build-review-adjudication.test.ts`, a lap whose every finding is advisory completes build_review as done with no remediate dispatch, no `kickback` event and an unchanged kickback ledger.
2. Verify RED.
3. Implement:
   - pass advisory ids alongside suppressed ids from the conductor raw-FAIL branch into `applyBuildReviewOutcome` and the coordinator;
   - exclude them in `allOperatorResolved` and the live-source filter.
4. Verify GREEN.
5. Commit.

**Done when:**
- [test] The adjudication coordinator's live-source set for a lap with one advisory and one unresolved finding contains only the unresolved finding, and the source-complete validator accepts a judgement that names no outcome for the advisory finding.
- [test] Through the conductor's build_review gate, a lap whose every finding is advisory records the step done, dispatches no remediate session, emits no kickback event, and leaves the kickback ledger unchanged.
- [test] A lap with an advisory and an unresolved finding that routes BUILD charges the kickback ledger once, for the unresolved finding's action case only.

**Files likely touched:**
- src/conductor/src/engine/build-review-adjudication-coordinator.ts
- src/conductor/src/engine/build-review-outcome.ts
- src/conductor/src/engine/conductor.ts
- src/conductor/test/engine/build-review-adjudication-coordinator.test.ts
- src/conductor/test/engine/conductor-build-review-adjudication.test.ts

**Dependencies:** Tasks 10, 11

### Task 13: Severity-kind suppression entries persist durably
**Story:** Story 6
**Type:** happy-path

**Steps:**
1. Write failing tests:
   - in `build-review-suppression-history.test.ts`, an advisory finding persists a severity-kind entry with finding id, rubric, summary, severity, threshold and lap, both before the pass/fail fork and on an all-advisory PASS lap;
   - a recurrence refreshes the entry in place with no duplicate;
   - an entry that stops recurring is retained;
   - in `remediation-case-store.test.ts`, a legacy kind-less entry reads as kind `confidence` with confidence and floor intact, and a severity-kind entry carrying `floor` makes the store read fail as malformed.
2. Verify RED.
3. Implement:
   - the `RemediationCaseSuppressionEntry` discriminated union with an exhaustive parse;
   - `projectBuildReviewSuppressionEntries` emits severity entries for advisory findings.
4. Verify GREEN.
5. Commit.

**Done when:**
- [test] On a lap with an advisory finding, `persistBuildReviewSuppressions` writes a severity-kind entry carrying finding id, rubric, summary, severity, threshold and lap, called before the pass/fail fork, including on a lap whose every finding is advisory and which completes PASS.
- [test] A recurring advisory finding's entry is refreshed in place to the new lap with exactly one entry for that id, and an entry whose finding stops recurring remains in the store on later laps.
- [test] `RemediationCaseStore.read` returns a kind-less legacy entry as kind confidence with its confidence and floor unchanged, and fails as malformed on a severity-kind entry that carries a floor instead of a threshold.

**Files likely touched:**
- src/conductor/src/engine/remediation-case-store.ts
- src/conductor/src/engine/build-review-suppression-history.ts
- src/conductor/test/engine/build-review-suppression-history.test.ts
- src/conductor/test/engine/remediation-case-store.test.ts

**Dependencies:** Task 10

### Task 14: `advisoryFindings` on the outer-verdict event and the daemon log
**Story:** Story 6
**Type:** happy-path

**Steps:**
1. Write failing tests:
   - in `build-review-step.test.ts`, a lap with an advisory finding emits `build_review_outer_verdict` with `advisoryFindings` of `{findingId, rubric, severity, threshold}`;
   - a lap with both a suppressed and an advisory finding lists each only in its own field;
   - a lap with no advisory findings emits the event without the field or with an empty list, otherwise unchanged;
   - the daemon log projection renders an advisory line.
2. Verify RED.
3. Implement:
   - the optional field in `types/events.ts`;
   - its emission beside `suppressedFindings` in `step-runners.ts`;
   - rendering in `daemon-cli.ts`.
4. Verify GREEN.
5. Commit.

**Done when:**
- [test] The build_review step runner emits `build_review_outer_verdict` with `advisoryFindings` carrying the advisory finding's id, rubric, severity and threshold.
- [test] On a lap with one suppressed and one advisory finding, the event lists the suppressed finding only in suppressedFindings and the advisory finding only in advisoryFindings.
- [test] On a lap with no advisory findings, the event omits advisoryFindings or carries an empty list, and every other field equals the pre-change event for the same fixture.
- [test] The daemon-cli event projection renders one advisory line per advisoryFindings entry.

**Files likely touched:**
- src/conductor/src/types/events.ts
- src/conductor/src/engine/step-runners.ts
- src/conductor/src/daemon-cli.ts
- src/conductor/test/engine/build-review-step.test.ts
- src/conductor/test/engine/daemon-render.test.ts

**Dependencies:** Task 13

### Task 15: The adjudication context carries advisory history and declared thresholds
**Story:** Story 6, Story 8
**Type:** happy-path

**Steps:**
1. Write failing tests in `build-review-adjudication-context.test.ts`:
   - severity-kind entries appear in the non-blocking history section and not among current sources;
   - the context names each rubric's declared threshold, and its admitted dispositions include `advisory` when at least one threshold is declared, in both case-v1 and case-v2 modes;
   - with no threshold declared, `advisory` is not admitted.
2. Verify RED.
3. Implement these in `build-review-adjudication-context.ts`, threading resolved thresholds from the conductor.
4. Verify GREEN.
5. Commit.

**Done when:**
- [test] The built adjudication context lists severity-kind entries in its non-blocking history section and never among currentFindings.
- [test] When a threshold is declared, the context carries each rubric's declared min_severity and its admitted dispositions include advisory in both case-v1 and case-v2 modes.
- [test] When no rubric declares a threshold, the context's admitted dispositions exclude advisory.
- [test] When the only declared threshold is `nit`, the context's admitted dispositions exclude advisory, because `buildReviewThresholds` resolves nit to no threshold.
- [test] Each entry in the context's currentFindings carries its source rubric and reviewer severity.

**Files likely touched:**
- src/conductor/src/engine/build-review-adjudication-context.ts
- src/conductor/src/engine/conductor.ts
- src/conductor/test/engine/build-review-adjudication-context.test.ts

**Dependencies:** Tasks 9, 13

### Task 16: `build-review findings` lists advisory findings
**Story:** Story 7, Story 1, Story 2
**Type:** happy-path

**Steps:**
1. Write failing tests in `build-review-cli.test.ts` (and a resume read in `build-review-effective.test.ts`):
   - a persisted v3 built-in result and a custom-findings v1 result are listed with no severity, and re-read on resume without a malformed failure;
   - JSON output lists each advisory finding's id, rubric, severity, threshold and origin, which is `threshold` or `adjudicated`;
   - human output has an advisory section with id, rubric, severity and summary;
   - a downgraded finding shows its adjudicator rationale in the CLI.
2. Verify RED.
3. Implement in `build-review-cli.ts`, reading the case store's severity entries and advisory cases.
4. Verify GREEN.
5. Commit.

**Done when:**
- [test] `build-review findings --json` lists an advisory finding with id, rubric, severity, threshold and origin threshold, and lists a downgraded finding with origin adjudicated.
- [test] Human `build-review findings` output prints an advisory section listing each advisory finding's id, rubric, severity and summary, plus the adjudicator rationale for a downgraded finding.
- [test] For a feature whose persisted build-review aggregate holds a v3 built-in result and a custom-findings v1 result, `build-review findings --json` lists those findings with no severity property and exits 0, and `resolveEffectiveBuildReviewVerdict` re-reading that persisted aggregate on resume parses it without a malformed-result failure.

**Files likely touched:**
- src/conductor/src/engine/build-review-cli.ts
- src/conductor/test/engine/build-review-cli.test.ts
- src/conductor/test/engine/build-review-effective.test.ts

**Dependencies:** Tasks 13, 19

### Task 17: Engine-owned "Advisory build-review findings" PR region
**Story:** Story 7
**Type:** happy-path

**Steps:**
1. Write failing tests in `finish-publication-production.test.ts`:
   - a feature with advisory findings publishes a `## Advisory build-review findings` section listing id, rubric, severity, origin and reviewer summary;
   - a downgraded finding shows origin `adjudicated` without its rationale;
   - no advisory findings means no section;
   - a forged worker-authored section is replaced by the engine's region.
2. Verify RED.
3. Implement:
   - `BUILD_REVIEW_ADVISORY_HEADING` in `build-review-accepted-risk.ts`, added to `ENGINE_OWNED_PR_BODY_TEXTS`;
   - the renderer in `finish-publication-production.ts`, beside the reduced-coverage region.
4. Verify GREEN.
5. Commit.

**Done when:**
- [test] Finish publication for a feature with an advisory finding writes a PR body containing `## Advisory build-review findings` with that finding's id, rubric, severity, origin threshold and reviewer summary, and lists a downgraded finding with origin adjudicated.
- [test] The published body never contains the adjudicator rationale of a downgraded finding.
- [test] Finish publication for a feature with no advisory findings writes no `## Advisory build-review findings` heading.
- [test] A worker-authored body containing a forged `## Advisory build-review findings` section is published with only the engine-rendered region, because `ENGINE_OWNED_PR_BODY_TEXTS` includes the heading and `pr-body-regions.ts` masks the forged copy.

**Files likely touched:**
- src/conductor/src/engine/build-review-accepted-risk.ts
- src/conductor/src/engine/finish-publication-production.ts
- src/conductor/test/engine/finish-publication-production.test.ts

**Dependencies:** Tasks 13, 19

### Task 18: The judgement parser and validator admit a bounded advisory disposition
**Story:** Story 8
**Type:** negative-path

**Steps:**
1. Write failing tests in `remediation-case-artifact.test.ts` and `remediation-case-validator.test.ts`, under threshold major. A valid case has `adjudicatedSeverity: minor`, a rationale and effect none, and is accepted. Each of the following is rejected:
   - no declared threshold;
   - a source rubric with no threshold while another rubric declares one;
   - adjudicated severity major;
   - an empty rationale;
   - an action effect;
   - an adjudicated severity above the reviewer's.
2. Verify RED.
3. Implement:
   - `advisory` in `RemediationCaseDisposition` with the `adjudicatedSeverity` key and effect `none`, parsed in both modes;
   - the validator checks against the context thresholds and each source's reviewer severity, using `isBelowSeverityThreshold`.
4. Verify GREEN.
5. Commit.

**Done when:**
- [test] Under threshold major, an advisory case with adjudicatedSeverity minor, a non-empty rationale and effect none passes `remediation-case-artifact` parsing and `remediation-case-validator` validation in both case-v1 and case-v2.
- [test] The validator rejects an advisory case through the existing invalid-judgement path when no rubric declares a threshold, or when a source's rubric has no threshold while another rubric declares one.
- [test] The validator rejects an advisory case whose adjudicatedSeverity equals the threshold, whose rationale is empty, whose effect is an action effect, or whose adjudicatedSeverity is above the source's reviewer severity.

**Files likely touched:**
- src/conductor/src/engine/remediation-case-artifact.ts
- src/conductor/src/engine/remediation-case-validator.ts
- src/conductor/test/engine/remediation-case-artifact.test.ts
- src/conductor/test/engine/remediation-case-validator.test.ts

**Dependencies:** Tasks 1, 15

### Task 19: An advisory case reduces to a non-action PASS
**Story:** Story 8
**Type:** happy-path

**Steps:**
1. Write failing tests:
   - in `build-review-adjudication.test.ts`, a lap whose only live source is resolved by an advisory case reduces to PASS with no BUILD route;
   - in `conductor-build-review-adjudication.test.ts`, the same lap through the conductor emits no kickback, leaves the ledger unchanged, and leaves the raw aggregate's reviewer severity unchanged;
   - in `build-review-adjudication-coordinator.test.ts`, a judgement that binds a live finding to a case holding an operator-accepted source while proposing `advisory` resolves it as carried acceptance (#3271), leaves the bound case's disposition unchanged, and lists no advisory finding.
2. Verify RED.
3. Implement:
   - in `reduceBuildReviewAdjudication`, treat `advisory` as a finalized non-action case with an exhaustive disposition match;
   - in `remediation-case-effects.ts`, make `advisory` produce no effect;
   - in the coordinator, keep #3271's carry decision ahead of the advisory reduction, so a carried finding is never recorded as advisory (`adr-2026-08-29-build-review-remediate-case-adjudication` D2.1).
4. Verify GREEN.
5. Commit.

**Done when:**
- [test] `reduceBuildReviewAdjudication` returns route pass, with no build route, for a lap whose only live source is covered by an advisory case.
- [test] Through the conductor's build_review gate, a lap whose major finding the judgement downgrades to advisory emits no kickback event, leaves the kickback ledger unchanged, and leaves that finding's reviewer severity in the raw aggregate as major.
- [test] Through the adjudication coordinator, which supplies each source's rubric and reviewer severity to `validateRemediationCaseGraph`, an advisory case whose adjudicatedSeverity exceeds the source's reviewer severity, or whose source rubric has no threshold, is rejected through the existing invalid-judgement path.
- [test] Through the adjudication coordinator, a live major finding that the judgement binds by `existingCaseId` to a case holding an operator-accepted source while proposing `advisory` resolves as carried acceptance through `resolveBuildReviewAcceptance`, the bound case's disposition is unchanged, and the finding is absent from the lap's advisory findings.

**Files likely touched:**
- src/conductor/src/engine/build-review-adjudication.ts
- src/conductor/src/engine/remediation-case-effects.ts
- src/conductor/src/engine/build-review-adjudication-coordinator.ts
- src/conductor/test/engine/build-review-adjudication.test.ts
- src/conductor/test/engine/conductor-build-review-adjudication.test.ts
- src/conductor/test/engine/build-review-adjudication-coordinator.test.ts

**Dependencies:** Task 18

### Task 20: The remediate skill states the advisory downgrade
**Story:** Story 8
**Type:** happy-path

**Steps:**
1. Write a failing assertion in the remediate skill contract test. `skills/remediate/SKILL.md` must state:
   - that `advisory` is offered only when the context declares thresholds;
   - that it requires an adjudicated severity strictly below the threshold and never above the reviewer's;
   - that it requires a rationale grounded in the plan or prior cases;
   - that it carries effect none.
2. Verify RED.
3. Edit the skill.
4. Verify GREEN.
5. Commit.

**Done when:**
- [test] The remediate skill contract test asserts that the skill text states that the advisory disposition is admitted only when the context declares thresholds, requires an adjudicated severity strictly below the threshold and not above the reviewer severity, requires a rationale grounded in the plan or prior cases, and carries effect none.
- [test] The same test asserts that the skill's cases row key list includes adjudicatedSeverity for advisory cases.

**Files likely touched:**
- skills/remediate/SKILL.md
- src/conductor/test/engine/remediate-skill-contract.test.ts

**Dependencies:** Task 18

### Task 21: A settled advisory case holds only while its threshold admits it
**Story:** Story 9
**Type:** happy-path

**Steps:**
1. Write failing tests:
   - in `remediation-case-store.test.ts`, `finalizedBuildReviewSourceIds(cases, thresholds)` includes an advisory case's source at adjudicated severity minor under threshold major, and excludes it at threshold minor or with no threshold;
   - in `build-review-adjudication-coordinator.test.ts`, a recurring exact-id source of a settled advisory case is removed from live sources with no remediate dispatch, and `remediation_adjudication_completed` is emitted with that case id and no new effect ids;
   - a drifted id is live;
   - the predicate leaves the store byte-identical.
2. Verify RED.
3. Implement:
   - a resolved-thresholds parameter on `finalizedBuildReviewSourceIds`;
   - pass the parameter from every caller (`build-review-effective.ts`, `build-review-aggregate.ts`, `build-review-cli.ts`, `build-review-adjudication-coordinator.ts`).
4. Verify GREEN.
5. Commit.

**Done when:**
- [test] `finalizedBuildReviewSourceIds` includes the source of an advisory case at adjudicated severity minor under threshold major and excludes it when the threshold is minor or absent.
- [test] On a lap where the only live source binds by exact id to a settled advisory case, the coordinator removes it from live sources, dispatches no remediate session, and emits `remediation_adjudication_completed` with that case id and an empty new effect id list.
- [test] After the threshold is lowered to minor or removed, the same recurring finding is a live source on the next lap, and `resolveEffectiveBuildReviewVerdict` called with the resolved thresholds classifies it unresolved, not settled, so the build_review gate blocks.
- [test] A recurring finding whose id drifted does not bind the advisory case and is a live source, and running the predicate leaves the remediation case store content byte-identical.

**Files likely touched:**
- src/conductor/src/engine/remediation-case-store.ts
- src/conductor/src/engine/build-review-effective.ts
- src/conductor/src/engine/build-review-aggregate.ts
- src/conductor/src/engine/build-review-cli.ts
- src/conductor/src/engine/build-review-adjudication-coordinator.ts
- src/conductor/test/engine/remediation-case-store.test.ts
- src/conductor/test/engine/build-review-adjudication-coordinator.test.ts

**Dependencies:** Tasks 9, 19

## Task Dependency Graph

```
1 ─┬─ 2 ─┬─ 3
   │     ├─ 4
   │     └─ 10 (with 9) ─┬─ 12 (with 11)
   ├─ 5 ─┼─ 6 (with 2)   └─ 13 ─┬─ 14
   │     ├─ 7 (with 2)          └─ 15 (with 9) ─ 18 ─┬─ 19 ─┬─ 16 (with 13)
   │     └─ 11 (with 9)                              │      ├─ 17 (with 13)
   └─ 8 ─ 9                                           └─ 20   └─ 21 (with 9)
```

## Integration Points

- **After Task 12:** a lap whose every finding is advisory passes build_review end to end with no remediate dispatch and no charge.
- **After Task 17:** advisory findings are visible on the event spine, in the CLI and on the published PR.
- **After Task 21:** a downgraded finding converges across laps, and reopens when the threshold is tightened.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a fresh built-in rubric result declaring contract version v4 whose finding carries `"severity": "minor"`, when the engine parses the result, then the finding is accepted and its severity is retained as minor. | 2 | "[test] `parseBuildReviewJudgedResult` on a v4 result with findings at critical, major, minor and nit returns each finding with its severity unchanged, and a minor finding is retained as minor." | diff-local |
| Story 1 happy: Given a fresh v4 result with findings at each of critical, major, minor and nit, when the engine parses the result, then every finding is accepted with its stated severity unchanged. | 2 | "[test] `parseBuildReviewJudgedResult` on a v4 result with findings at critical, major, minor and nit returns each finding with its severity unchanged, and a minor finding is retained as minor." | diff-local |
| Story 1 happy: Given a fresh v4 result whose finding carries severity major and confidence 40, when the engine parses the result, then both values are retained independently and neither is derived from the other. | 2 | "[test] A parsed v4 finding carrying severity major and confidence 40 exposes severity major and confidence 40, and neither value is derived from the other." | diff-local |
| Story 1 happy: Given a persisted v3 aggregate written before this change, when the operator CLI or recovery reads it back, then it parses as before and its findings carry no severity. | 2, 16 | "[test] For a feature whose persisted build-review aggregate holds a v3 built-in result and a custom-findings v1 result, `build-review findings --json` lists those findings with no severity property and exits 0, and `resolveEffectiveBuildReviewVerdict` re-reading that persisted aggregate on resume parses it without a malformed-result failure." | diff-local |
| Story 1 happy: Given the rubric result contract rendered into a built-in reviewer's prompt, when it is inspected, then it lists severity as a required field with exactly the values critical, major, minor and nit. | 2 | "[test] The current judged native schema rendered by `renderRubricContractShape` for each built-in rubric lists severity in `required` with enum exactly critical, major, minor and nit." | diff-local |
| Story 1 negative: Given a fresh v4 result whose finding omits severity, when the engine parses the result, then the whole rubric result is malformed and is handled exactly as a result with any other invalid finding field. | 3 | "[test] A v4 finding with severity omitted, `"blocker"`, `"Major"` or the number 2 makes `parseBuildReviewJudgedResult` return undefined, so the whole rubric result takes the existing invalid-field path, and the rejection diagnosis names the severity field." | diff-local |
| Story 1 negative: Given a fresh v4 result whose finding carries `"severity": "blocker"`, when the engine parses the result, then the whole rubric result is malformed, because only the four closed values are accepted. | 3 | "[test] A v4 finding with severity omitted, `"blocker"`, `"Major"` or the number 2 makes `parseBuildReviewJudgedResult` return undefined, so the whole rubric result takes the existing invalid-field path, and the rejection diagnosis names the severity field." | diff-local |
| Story 1 negative: Given a fresh v4 result whose finding carries `"severity": "Major"`, when the engine parses the result, then the whole rubric result is malformed, because values are case-sensitive. | 3 | "[test] A v4 finding with severity omitted, `"blocker"`, `"Major"` or the number 2 makes `parseBuildReviewJudgedResult` return undefined, so the whole rubric result takes the existing invalid-field path, and the rejection diagnosis names the severity field." | diff-local |
| Story 1 negative: Given a fresh v4 result whose finding carries `"severity": 2`, when the engine parses the result, then the whole rubric result is malformed, because a number is not accepted. | 3 | "[test] A v4 finding with severity omitted, `"blocker"`, `"Major"` or the number 2 makes `parseBuildReviewJudgedResult` return undefined, so the whole rubric result takes the existing invalid-field path, and the rejection diagnosis names the severity field." | diff-local |
| Story 1 negative: Given a fresh built-in result declaring contract version v3, when the engine parses it as a current-lap result, then it is rejected with a diagnosis naming contractVersion must be v4. | 3 | "[test] A fresh current-lap result declaring contractVersion v3 is rejected by `diagnoseBuildReviewJudgedResultRejection` with a problem naming contractVersion must be v4." | diff-local |
| Story 1 negative: Given a cached built-in rubric result produced under contract v3, when the next lap looks it up, then the cache entry is not reused and the reviewer re-runs under v4. | 4 | "[test] A cache entry written under contract v3 for an unchanged projection is not served by the build-review cache lookup, and the step runner dispatches the reviewer, whose stored entry declares v4." | diff-local |
| Story 2 happy: Given a fresh custom-findings result declaring version v2 whose finding carries `"severity": "nit"`, when the engine parses it, then the finding is accepted and its severity is retained as nit. | 5 | "[test] The custom-findings parser returns a v2 finding carrying severity nit with that severity retained." | diff-local |
| Story 2 happy: Given a persisted custom-findings v1 result, when it is read back for history or the CLI, then it parses as before and its findings carry no severity. | 5, 16 | "[test] For a feature whose persisted build-review aggregate holds a v3 built-in result and a custom-findings v1 result, `build-review findings --json` lists those findings with no severity property and exits 0, and `resolveEffectiveBuildReviewVerdict` re-reading that persisted aggregate on resume parses it without a malformed-result failure." | diff-local |
| Story 2 happy: Given the custom-review contract rendered into a custom reviewer's prompt, when it is inspected, then it lists severity as a required field with exactly the values critical, major, minor and nit and states what each level means. | 7 | "[test] The custom-review contract text produced by the policy contract renderer names severity as required with exactly the four values and defines each level." | diff-local |
| Story 2 negative: Given a fresh custom v2 result whose finding omits severity, when the engine parses it, then the whole custom result is malformed and its diagnosis names the severity field. | 5 | "[test] A v2 custom finding with severity omitted or an unknown severity value makes the whole custom result malformed, and the custom rejection diagnosis names the severity field." | diff-local |
| Story 2 negative: Given a fresh custom v2 result whose finding carries an unknown severity value, when the engine parses it, then the whole custom result is malformed. | 5 | "[test] A v2 custom finding with severity omitted or an unknown severity value makes the whole custom result malformed, and the custom rejection diagnosis names the severity field." | diff-local |
| Story 2 negative: Given a fresh custom result declaring version v1, when the engine parses it as a current-lap result, then it is rejected with a diagnosis naming version must be v2. | 5 | "[test] A current-lap custom payload declaring version v1 is rejected with a diagnosis naming version must be v2, and a v2 finding carrying an extra unknown key is still rejected by exact-key parsing." | diff-local |
| Story 2 negative: Given a custom finding carrying any key other than the contract's exact key set, when the engine parses it, then it is still rejected exactly as today, because adding severity does not relax exact-key parsing. | 5 | "[test] A current-lap custom payload declaring version v1 is rejected with a diagnosis naming version must be v2, and a v2 finding carrying an extra unknown key is still rejected by exact-key parsing." | diff-local |
| Story 3 happy: Given two v4 findings identical in rubric, contract version, concern kind and anchor but carrying severity minor and critical, when their identities are computed, then both produce the same finding id. | 6 | "[test] `canonicalizeBuildReviewFindingIdentity` returns one id for two v4 findings that differ only in severity, the custom identity function returns one id for two custom v2 findings that differ only in severity, and neither canonical payload contains a severity key." | diff-local |
| Story 3 happy: Given an operator disposition accepting a v4 finding graded major, when the next lap re-grades the same finding as nit, then the disposition still binds and the finding is recorded as accepted. | 6 | "[test] `resolveEffectiveBuildReviewVerdict` records as accepted a v4 finding re-graded from major to nit under a disposition recorded at major." | diff-local |
| Story 3 happy: Given two custom v2 findings identical except for severity, when their identities are computed, then both produce the same custom finding id. | 6 | "[test] `canonicalizeBuildReviewFindingIdentity` returns one id for two v4 findings that differ only in severity, the custom identity function returns one id for two custom v2 findings that differ only in severity, and neither canonical payload contains a severity key." | diff-local |
| Story 3 negative: Given the canonical identity payload for a v4 finding, when it is inspected, then it contains no severity field. | 6 | "[test] `canonicalizeBuildReviewFindingIdentity` returns one id for two v4 findings that differ only in severity, the custom identity function returns one id for two custom v2 findings that differ only in severity, and neither canonical payload contains a severity key." | diff-local |
| Story 3 negative: Given a v3 finding and a v4 finding identical in rubric, concern kind and anchor, when their identities are computed, then the ids differ, because contract version is part of identity. | 6 | "[test] A v3 finding and a v4 finding with equal rubric, concern kind and anchor produce different ids from `canonicalizeBuildReviewFindingIdentity`." | diff-local |
| Story 3 negative: Given a stored operator disposition recorded against a v3 finding, when the effective verdict is derived for a v4 lap, then the disposition is reported invalidated through the existing build_review_disposition_version_invalidated event and does not bind. | 6 | "[test] For a v3 disposition evaluated on a v4 lap, `resolveEffectiveBuildReviewVerdict` emits `build_review_disposition_version_invalidated` and leaves the finding unresolved; after a v4 disposition is recorded through the build-review accept path, the next resolution records it as accepted." | diff-local |
| Story 3 negative: Given a v3 operator disposition invalidated at upgrade, when the operator re-accepts the re-keyed v4 finding with build-review accept, then the new disposition binds and the finding is recorded as accepted on the next lap. | 6 | "[test] For a v3 disposition evaluated on a v4 lap, `resolveEffectiveBuildReviewVerdict` emits `build_review_disposition_version_invalidated` and leaves the finding unresolved; after a v4 disposition is recorded through the build-review accept path, the next resolution records it as accepted." | diff-local |
| Story 4 happy: Given `build_review.rubrics.implementationQuality.min_severity: major` in config, when config resolves, then the implementationQuality rubric policy carries the threshold major. | 8 | "[test] Resolved config carries policy threshold major for implementationQuality from `min_severity: major` and minor for the eventSpine custom rubric from `min_severity: minor`." | diff-local |
| Story 4 happy: Given `build_review.custom_rubrics.eventSpine.min_severity: minor` in config, when config resolves, then the eventSpine custom rubric policy carries the threshold minor. | 8 | "[test] Resolved config carries policy threshold major for implementationQuality from `min_severity: major` and minor for the eventSpine custom rubric from `min_severity: minor`." | diff-local |
| Story 4 happy: Given a rubric with no min_severity key, when config resolves, then its policy carries no threshold, not a defaulted value. | 8 | "[test] A rubric with no min_severity key resolves to a policy with no threshold property, not a defaulted value." | diff-local |
| Story 4 happy: Given a custom rubric with min_confidence 70 and min_severity major, when the build_review gate-completion predicate evaluates a lap, then it applies the same floor and threshold for that custom rubric as the effective verdict does. | 9, 11 | "[test] For a custom rubric with min_confidence 70 and min_severity major and a lap fixture holding a confidence-40 custom finding and a confidence-90 minor custom finding, the artifacts.ts build_review gate-completion predicate classifies the first as suppressed and the second as advisory and completes the gate, exactly as `resolveEffectiveBuildReviewVerdict` does for the same fixture." | diff-local |
| Story 4 negative: Given `min_severity: blocker` on a built-in rubric, when config is validated, then validation fails naming the key and the allowed values critical, major, minor and nit. | 8 | "[test] Config validation rejects `min_severity: blocker` on a built-in rubric, `min_severity: 2` on a custom rubric and `min_severity: Major` on a built-in rubric, with a validation error naming the min_severity key and the allowed values critical, major, minor and nit." | diff-local |
| Story 4 negative: Given `min_severity: 2` on a custom rubric, when config is validated, then validation fails naming the key, because a number is not accepted. | 8 | "[test] Config validation rejects `min_severity: blocker` on a built-in rubric, `min_severity: 2` on a custom rubric and `min_severity: Major` on a built-in rubric, with a validation error naming the min_severity key and the allowed values critical, major, minor and nit." | diff-local |
| Story 4 negative: Given `min_severity: Major` on a built-in rubric, when config is validated, then validation fails, because values are case-sensitive. | 8 | "[test] Config validation rejects `min_severity: blocker` on a built-in rubric, `min_severity: 2` on a custom rubric and `min_severity: Major` on a built-in rubric, with a validation error naming the min_severity key and the allowed values critical, major, minor and nit." | diff-local |
| Story 4 negative: Given a change to min_severity between two laps with identical inputs, when the second lap looks up its rubric cache, then the cached rubric result is reused, because the threshold is applied after judgement and never enters the cache fingerprint. | 9 | "[test] `fingerprintBuildReviewRubricPolicy` returns an identical fingerprint for policies differing only in min_severity, so the second lap's rubric cache entry is reused." | diff-local |
| Story 5 happy: Given implementationQuality min_severity major and a lap whose only finding is minor with confidence 96, when the effective verdict is derived, then the finding is placed in the advisory set, the unresolved set is empty, and the effective verdict is PASS. | 10 | "[test] `deriveEffectiveBuildReviewVerdict` under threshold major places a lone minor finding at confidence 96 in advisory with an empty unresolved set and an effective verdict of PASS." | diff-local |
| Story 5 happy: Given min_severity major and a finding at severity major, when the effective verdict is derived, then the finding is unresolved, because the threshold is a minimum and not an exclusive bound. | 10 | "[test] Under threshold major, a major finding is unresolved, and a lap with one nit and one critical finding has only the nit in advisory with an effective verdict of FAIL." | diff-local |
| Story 5 happy: Given min_severity major and a lap with one nit finding and one critical finding, when the effective verdict is derived, then only the nit is advisory and the verdict is FAIL on the critical finding. | 10 | "[test] Under threshold major, a major finding is unresolved, and a lap with one nit and one critical finding has only the nit in advisory with an effective verdict of FAIL." | diff-local |
| Story 5 happy: Given a lap whose every finding is advisory, when the conductor evaluates the build_review gate, then it records the step done without dispatching remediate, without a kickback event, and without charging the kickback ledger. | 12 | "[test] Through the conductor's build_review gate, a lap whose every finding is advisory records the step done, dispatches no remediate session, emits no kickback event, and leaves the kickback ledger unchanged." | diff-local |
| Story 5 happy: Given a mixed lap with one advisory and one unresolved finding, when the coordinator builds its live sources, then only the unresolved finding is a live source and the remediate judgement does not demand an outcome for the advisory one. | 12 | "[test] The adjudication coordinator's live-source set for a lap with one advisory and one unresolved finding contains only the unresolved finding, and the source-complete validator accepts a judgement that names no outcome for the advisory finding." | diff-local |
| Story 5 happy: Given a custom rubric with min_severity major and a minor custom finding, when the custom effective verdict is derived, then the finding is advisory exactly as for a built-in rubric. | 11 | "[test] `resolveEffectiveBuildReviewVerdict` for a custom rubric with min_severity major places a minor custom finding in advisory, leaves the unresolved set empty, and reports an effective PASS." | diff-local |
| Story 5 negative: Given no min_severity declared and a finding at severity nit, when the effective verdict is derived, then the finding is unresolved and blocks, exactly as today. | 10 | "[test] With no threshold a nit finding is unresolved and the effective verdict is FAIL; at threshold nit a nit finding is unresolved; and a persisted finding with no severity is unresolved under any threshold." | diff-local |
| Story 5 negative: Given min_severity nit and a finding at severity nit, when the effective verdict is derived, then the finding is unresolved, because nothing is strictly below nit. | 10 | "[test] With no threshold a nit finding is unresolved and the effective verdict is FAIL; at threshold nit a nit finding is unresolved; and a persisted finding with no severity is unresolved under any threshold." | diff-local |
| Story 5 negative: Given min_confidence 70 and min_severity major and a finding at confidence 40 and severity minor, when the effective verdict is derived, then the finding is suppressed and not advisory, because the confidence floor is checked first. | 10 | "[test] With floor 70 and threshold major, a confidence-40 minor finding is suppressed and not advisory, a confidence-40 critical finding is suppressed, and a confidence-95 critical finding is unresolved." | diff-local |
| Story 5 negative: Given min_confidence 70 and min_severity major and a finding at confidence 40 and severity critical, when the effective verdict is derived, then the finding is suppressed, because a low-confidence severe finding is still suppressed by the confidence floor. | 10 | "[test] With floor 70 and threshold major, a confidence-40 minor finding is suppressed and not advisory, a confidence-40 critical finding is suppressed, and a confidence-95 critical finding is unresolved." | diff-local |
| Story 5 negative: Given min_severity major and a finding at confidence 95 and severity critical, when the effective verdict is derived, then the finding is unresolved, because high confidence never makes a finding advisory. | 10 | "[test] With floor 70 and threshold major, a confidence-40 minor finding is suppressed and not advisory, a confidence-40 critical finding is suppressed, and a confidence-95 critical finding is unresolved." | diff-local |
| Story 5 negative: Given an operator disposition accepting a finding that is also below min_severity, when the effective verdict is derived, then the finding is recorded as accepted and not advisory, because operator resolution is checked first. | 10 | "[test] A finding with an operator disposition that is also below the threshold is in accepted and absent from advisory, matching the classification order accepted, settled, replication, suppressed, advisory, unresolved." | diff-local |
| Story 5 negative: Given a persisted v3 finding with no severity re-evaluated under a declared threshold, when the effective verdict is derived, then the finding is never advisory. | 10 | "[test] With no threshold a nit finding is unresolved and the effective verdict is FAIL; at threshold nit a nit finding is unresolved; and a persisted finding with no severity is unresolved under any threshold." | diff-local |
| Story 5 negative: Given an advisory finding, when operator dispositions are listed, then no accepted-risk disposition exists for it, because advisory is never written as operator accepted risk. | 11 | "[test] After an effective verdict with an advisory finding, `BuildReviewDispositionStore.list` returns no accepted-risk disposition for it, because advisory classification never writes to the operator disposition store." | diff-local |
| Story 6 happy: Given a lap with an advisory finding, when the outer verdict is emitted, then build_review_outer_verdict carries advisoryFindings with the finding id, rubric, severity and threshold. | 14 | "[test] The build_review step runner emits `build_review_outer_verdict` with `advisoryFindings` carrying the advisory finding's id, rubric, severity and threshold." | diff-local |
| Story 6 happy: Given a lap with an advisory finding, when the effective verdict path runs, then a severity-kind entry with the finding id, rubric, summary, severity, threshold and lap is written to the remediation case store before the pass/fail fork. | 13 | "[test] On a lap with an advisory finding, `persistBuildReviewSuppressions` writes a severity-kind entry carrying finding id, rubric, summary, severity, threshold and lap, called before the pass/fail fork, including on a lap whose every finding is advisory and which completes PASS." | diff-local |
| Story 6 happy: Given a lap whose every finding is advisory, when it completes as PASS, then the advisory entries are still persisted, because persistence runs on PASS laps too. | 13 | "[test] On a lap with an advisory finding, `persistBuildReviewSuppressions` writes a severity-kind entry carrying finding id, rubric, summary, severity, threshold and lap, called before the pass/fail fork, including on a lap whose every finding is advisory and which completes PASS." | diff-local |
| Story 6 happy: Given the same advisory finding recurring on a later lap, when it is persisted, then its existing entry is refreshed in place with the new lap and no duplicate entry is created. | 13 | "[test] A recurring advisory finding's entry is refreshed in place to the new lap with exactly one entry for that id, and an entry whose finding stops recurring remains in the store on later laps." | diff-local |
| Story 6 happy: Given a mixed lap that dispatches remediate, when the adjudication context is built, then advisory entries appear in the non-blocking history section and not among the current sources. | 15 | "[test] The built adjudication context lists severity-kind entries in its non-blocking history section and never among currentFindings." | diff-local |
| Story 6 happy: Given a lap with no advisory findings, when the outer verdict is emitted, then the event carries no advisoryFindings field or an empty list and is otherwise unchanged. | 14 | "[test] On a lap with no advisory findings, the event omits advisoryFindings or carries an empty list, and every other field equals the pre-change event for the same fixture." | diff-local |
| Story 6 negative: Given a remediation case store written before this change whose suppression entries carry no kind, when it is read, then each entry is read as a confidence-kind entry with its confidence and floor intact. | 13 | "[test] `RemediationCaseStore.read` returns a kind-less legacy entry as kind confidence with its confidence and floor unchanged, and fails as malformed on a severity-kind entry that carries a floor instead of a threshold." | diff-local |
| Story 6 negative: Given a stored entry whose kind is severity but which carries a floor instead of a threshold, when the store is read, then the store read fails closed as malformed rather than guessing a kind. | 13 | "[test] `RemediationCaseStore.read` returns a kind-less legacy entry as kind confidence with its confidence and floor unchanged, and fails as malformed on a severity-kind entry that carries a floor instead of a threshold." | diff-local |
| Story 6 negative: Given an advisory finding that stops recurring, when later laps run, then its entry is retained and never pruned. | 13 | "[test] A recurring advisory finding's entry is refreshed in place to the new lap with exactly one entry for that id, and an entry whose finding stops recurring remains in the store on later laps." | diff-local |
| Story 6 negative: Given a lap with both a suppressed and an advisory finding, when the outer verdict is emitted, then the suppressed finding appears only in suppressedFindings and the advisory finding appears only in advisoryFindings. | 14 | "[test] On a lap with one suppressed and one advisory finding, the event lists the suppressed finding only in suppressedFindings and the advisory finding only in advisoryFindings." | diff-local |
| Story 7 happy: Given a feature with an advisory finding, when the operator runs build-review findings with JSON output, then the output lists the advisory finding id, rubric, severity, threshold and origin threshold. | 16 | "[test] `build-review findings --json` lists an advisory finding with id, rubric, severity, threshold and origin threshold, and lists a downgraded finding with origin adjudicated." | diff-local |
| Story 7 happy: Given a feature with an advisory finding, when the operator runs build-review findings with human output, then an advisory section lists each advisory finding's id, rubric, severity and summary. | 16 | "[test] Human `build-review findings` output prints an advisory section listing each advisory finding's id, rubric, severity and summary, plus the adjudicator rationale for a downgraded finding." | diff-local |
| Story 7 happy: Given a feature that finishes with an advisory finding, when the PR body is published, then it contains a section headed Advisory build-review findings listing the finding id, rubric, severity, origin and reviewer summary. | 17 | "[test] Finish publication for a feature with an advisory finding writes a PR body containing `## Advisory build-review findings` with that finding's id, rubric, severity, origin threshold and reviewer summary, and lists a downgraded finding with origin adjudicated." | diff-local |
| Story 7 happy: Given a feature with a finding the adjudicator downgraded, when the PR body is published, then the advisory section lists it with origin adjudicated. | 17 | "[test] Finish publication for a feature with an advisory finding writes a PR body containing `## Advisory build-review findings` with that finding's id, rubric, severity, origin threshold and reviewer summary, and lists a downgraded finding with origin adjudicated." | diff-local |
| Story 7 negative: Given a feature with no advisory findings, when the PR body is published, then no Advisory build-review findings section appears. | 17 | "[test] Finish publication for a feature with no advisory findings writes no `## Advisory build-review findings` heading." | diff-local |
| Story 7 negative: Given a worker-authored PR body containing a forged Advisory build-review findings section, when the engine publishes, then the engine's own region replaces it and the forged content is not published. | 17 | "[test] A worker-authored body containing a forged `## Advisory build-review findings` section is published with only the engine-rendered region, because `ENGINE_OWNED_PR_BODY_TEXTS` includes the heading and `pr-body-regions.ts` masks the forged copy." | diff-local |
| Story 7 negative: Given a downgraded finding with an adjudicator rationale, when the PR body is published, then the rationale does not appear in the PR body and remains available in the CLI. | 16, 17 | "[test] The published body never contains the adjudicator rationale of a downgraded finding." | diff-local |
| Story 8 happy: Given implementationQuality min_severity major and a live major finding, when the remediate judgement returns an advisory case for it with adjudicated severity minor, a non-empty rationale and effect none, then the case is accepted, the lap routes no BUILD and charges no kickback. | 18, 19 | "[test] Through the conductor's build_review gate, a lap whose major finding the judgement downgrades to advisory emits no kickback event, leaves the kickback ledger unchanged, and leaves that finding's reviewer severity in the raw aggregate as major." | diff-local |
| Story 8 happy: Given a lap whose only live source is downgraded to advisory, when the adjudication reduces, then the route is PASS. | 19 | "[test] `reduceBuildReviewAdjudication` returns route pass, with no build route, for a lap whose only live source is covered by an advisory case." | diff-local |
| Story 8 happy: Given a downgraded finding, when the raw aggregate is read afterwards, then the finding's reviewer-assigned severity is unchanged. | 19 | "[test] Through the conductor's build_review gate, a lap whose major finding the judgement downgrades to advisory emits no kickback event, leaves the kickback ledger unchanged, and leaves that finding's reviewer severity in the raw aggregate as major." | diff-local |
| Story 8 happy: Given a lap whose context declares a threshold, when the remediate dispatch is prepared under either case-v1 or case-v2 mode, then the judgement contract offers the advisory disposition and the context names each rubric's threshold. | 15 | "[test] When a threshold is declared, the context carries each rubric's declared min_severity and its admitted dispositions include advisory in both case-v1 and case-v2 modes." | diff-local |
| Story 8 negative: Given no rubric in the lap declares min_severity, when the remediate judgement returns an advisory case, then the judgement is rejected as invalid through the existing rejection path. | 18 | "[test] The validator rejects an advisory case through the existing invalid-judgement path when no rubric declares a threshold, or when a source's rubric has no threshold while another rubric declares one." | diff-local |
| Story 8 negative: Given a context that declares no threshold, when the remediate dispatch is prepared, then the advisory disposition is not offered in the judgement contract. | 15 | "[test] When no rubric declares a threshold, the context's admitted dispositions exclude advisory." | diff-local |
| Story 8 negative: Given an advisory case whose source belongs to a rubric without a declared threshold while another rubric declares one, when the judgement is validated, then it is rejected as invalid. | 18, 19 | "[test] Through the adjudication coordinator, which supplies each source's rubric and reviewer severity to `validateRemediationCaseGraph`, an advisory case whose adjudicatedSeverity exceeds the source's reviewer severity, or whose source rubric has no threshold, is rejected through the existing invalid-judgement path." | diff-local |
| Story 8 negative: Given min_severity major, when the remediate judgement returns an advisory case with adjudicated severity major, then it is rejected, because the downgrade must be strictly below the threshold. | 18 | "[test] The validator rejects an advisory case whose adjudicatedSeverity equals the threshold, whose rationale is empty, whose effect is an action effect, or whose adjudicatedSeverity is above the source's reviewer severity." | diff-local |
| Story 8 negative: Given an advisory case with an empty rationale, when the judgement is validated, then it is rejected as invalid. | 18 | "[test] The validator rejects an advisory case whose adjudicatedSeverity equals the threshold, whose rationale is empty, whose effect is an action effect, or whose adjudicatedSeverity is above the source's reviewer severity." | diff-local |
| Story 8 negative: Given an advisory case carrying an action effect, when the judgement is validated, then it is rejected, because an advisory case's effect must be none. | 18 | "[test] The validator rejects an advisory case whose adjudicatedSeverity equals the threshold, whose rationale is empty, whose effect is an action effect, or whose adjudicatedSeverity is above the source's reviewer severity." | diff-local |
| Story 8 negative: Given a case whose adjudicated severity is higher than the reviewer's severity, when the judgement is validated, then it is rejected, because the adjudicator cannot raise severity. | 18, 19 | "[test] Through the adjudication coordinator, which supplies each source's rubric and reviewer severity to `validateRemediationCaseGraph`, an advisory case whose adjudicatedSeverity exceeds the source's reviewer severity, or whose source rubric has no threshold, is rejected through the existing invalid-judgement path." | diff-local |
| Story 8 negative: Given a live finding that the remediate judgement binds to a case holding an operator-accepted source while proposing advisory, when the lap is adjudicated, then the finding resolves as carried operator acceptance, the bound case's disposition is unchanged, and the finding is not listed among advisory findings. | 19 | "[test] Through the adjudication coordinator, a live major finding that the judgement binds by `existingCaseId` to a case holding an operator-accepted source while proposing `advisory` resolves as carried acceptance through `resolveBuildReviewAcceptance`, the bound case's disposition is unchanged, and the finding is absent from the lap's advisory findings." | diff-local |
| Story 9 happy: Given a finalized advisory case for a finding at adjudicated severity minor under min_severity major, when the same finding recurs by exact id on the next lap, then it is removed from the live sources without dispatching remediate. | 21 | "[test] On a lap where the only live source binds by exact id to a settled advisory case, the coordinator removes it from live sources, dispatches no remediate session, and emits `remediation_adjudication_completed` with that case id and an empty new effect id list." | diff-local |
| Story 9 happy: Given a lap emptied of live sources by a settled advisory case, when it finalizes, then remediation_adjudication_completed is emitted with the settled case id and no new effect ids. | 21 | "[test] On a lap where the only live source binds by exact id to a settled advisory case, the coordinator removes it from live sources, dispatches no remediate session, and emits `remediation_adjudication_completed` with that case id and an empty new effect id list." | diff-local |
| Story 9 negative: Given a finalized advisory case at adjudicated severity minor, when the operator lowers implementationQuality min_severity to minor and the same finding recurs, then the case does not settle and the finding is a live source again. | 21 | "[test] After the threshold is lowered to minor or removed, the same recurring finding is a live source on the next lap, and `resolveEffectiveBuildReviewVerdict` called with the resolved thresholds classifies it unresolved, not settled, so the build_review gate blocks." | diff-local |
| Story 9 negative: Given a finalized advisory case, when the operator removes min_severity and the same finding recurs, then the finding is a live source and blocks as unresolved. | 21 | "[test] After the threshold is lowered to minor or removed, the same recurring finding is a live source on the next lap, and `resolveEffectiveBuildReviewVerdict` called with the resolved thresholds classifies it unresolved, not settled, so the build_review gate blocks." | diff-local |
| Story 9 negative: Given a finalized advisory case, when the recurring finding's id has drifted, then the case does not bind and the finding is judged as a live source. | 21 | "[test] A recurring finding whose id drifted does not bind the advisory case and is a live source, and running the predicate leaves the remediation case store content byte-identical." | diff-local |
| Story 9 negative: Given the settled-recurrence predicate evaluating an advisory case, when it runs, then it neither writes, prunes nor resolves the case. | 21 | "[test] A recurring finding whose id drifted does not bind the advisory case and is a live source, and running the predicate leaves the remediation case store content byte-identical." | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-10-19-build-review-finding-severity-advisory-threshold#D1 | task | task-1, task-2, task-5, task-6, task-7 | lists severity in `required` with enum exactly critical, major, minor and nit |
| adr-2026-10-19-build-review-finding-severity-advisory-threshold#D2 | task | task-3, task-4, task-5, task-6 | A v3 finding and a v4 finding with equal rubric, concern kind and anchor produce different ids |
| adr-2026-10-19-build-review-finding-severity-advisory-threshold#D3 | task | task-8, task-9 | `buildReviewThresholds` returns the declared min_confidence and min_severity for both a built-in rubric and a custom rubric id |
| adr-2026-10-19-build-review-finding-severity-advisory-threshold#D4 | task | task-10, task-11, task-12 | a lap whose every finding is advisory records the step done, dispatches no remediate session, emits no kickback event, and leaves the kickback ledger unchanged |
| adr-2026-10-19-build-review-finding-severity-advisory-threshold#D5 | task | task-13, task-14, task-15, task-16, task-17 | `persistBuildReviewSuppressions` writes a severity-kind entry carrying finding id, rubric, summary, severity, threshold and lap |
| adr-2026-10-19-build-review-finding-severity-advisory-threshold#D6 | task | task-15, task-18, task-19, task-20 | an advisory case with adjudicatedSeverity minor, a non-empty rationale and effect none passes |
| adr-2026-10-19-build-review-finding-severity-advisory-threshold#D7 | task | task-21 | `finalizedBuildReviewSourceIds` includes the source of an advisory case at adjudicated severity minor under threshold major and excludes it when the threshold is minor or absent |
| adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication#D1 | no-change | none | Advisory classification happens in the effective reducers before lap classification; it changes neither how infrastructure-only laps are distinguished from mixed laps nor their routes. |
| adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication#D2 | no-change | none | Advisory sources are excluded from live sources exactly as suppressed ones are (D4.4); one remediate dispatch still owns semantic fan-in for the remaining live sources. |
| adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication#D3 | no-change | none | Advisory findings are never content action cases and never infrastructure faults, so the composition of content action and infrastructure blocking is unchanged. |
| adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication#D4 | task | task-3, task-6, task-10, task-12, task-13, task-14 | a lap whose every finding is advisory records the step done, dispatches no remediate session, emits no kickback event, and leaves the kickback ledger unchanged |
| adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication#D5 | task | task-21 | the coordinator removes it from live sources, dispatches no remediate session |
| adr-2026-09-10-portable-build-review-policy#D1 | task | task-8 | `min_severity: 2` on a custom rubric |
| adr-2026-09-10-portable-build-review-policy#D2 | no-change | none | Semantic identity still resolves through the installed-catalog adapters; severity is excluded from every identity grammar. |
| adr-2026-09-10-portable-build-review-policy#D3 | no-change | none | min_severity is applied after judgement and does not enter the bound policy bundle or its fingerprint. |
| adr-2026-09-10-portable-build-review-policy#D4 | task | task-5 | The custom-findings parser returns a v2 finding carrying severity nit |
| adr-2026-09-10-portable-build-review-policy#D5 | no-change | none | Review access and containment are unaffected; no new read or write path is introduced for reviewers. |
| adr-2026-09-10-portable-build-review-policy#D6 | task | task-4, task-9 | `parseBuildReviewCacheEntry` accepts a v4 entry and rejects an entry declaring v5 as invalid |
| adr-2026-09-10-portable-build-review-policy#D7 | task | task-5, task-9, task-11 | A current-lap custom payload declaring version v1 is rejected with a diagnosis naming version must be v2 |
| adr-2026-09-10-portable-build-review-policy#D8 | task | task-15 | the context carries each rubric's declared min_severity |
| adr-2026-09-10-portable-build-review-policy#D9 | task | task-18 | The validator rejects an advisory case whose adjudicatedSeverity equals the threshold |
| adr-2026-09-10-portable-build-review-policy#D10 | no-change | none | The advisory classification and downgrade run in the same shared operation for attended and daemon execution; no second authority is added. |
| adr-2026-09-10-portable-build-review-policy#D11 | task | task-13 | `RemediationCaseStore.read` returns a kind-less legacy entry as kind confidence with its confidence and floor unchanged, and fails as malformed on a severity-kind entry |
| adr-2026-09-10-portable-build-review-policy#D12 | task | task-14 | emits `build_review_outer_verdict` with `advisoryFindings` carrying the advisory finding's id, rubric, severity and threshold |
| adr-2026-08-13-stable-build-review-finding-dispositions#D1 | task | task-6 | A v3 finding and a v4 finding with equal rubric, concern kind and anchor produce different ids from `canonicalizeBuildReviewFindingIdentity` |
| adr-2026-08-13-stable-build-review-finding-dispositions#D2 | task | task-6 | For a v3 disposition evaluated on a v4 lap, `resolveEffectiveBuildReviewVerdict` emits `build_review_disposition_version_invalidated` and leaves the finding unresolved |
| adr-2026-08-13-stable-build-review-finding-dispositions#D3 | task | task-11 | `BuildReviewDispositionStore.list` returns no accepted-risk disposition for it, because advisory classification never writes to the operator disposition store |
| adr-2026-08-13-stable-build-review-finding-dispositions#D4 | task | task-16 | `build-review findings --json` lists an advisory finding with id, rubric, severity, threshold and origin threshold |
| adr-2026-08-13-stable-build-review-finding-dispositions#D5 | no-change | none | `build-review accept` and its external-process closeout events are unchanged; a re-keyed finding is re-accepted through that existing path. |
| adr-2026-08-13-stable-build-review-finding-dispositions#D6 | task | task-17 | is published with only the engine-rendered region, because `ENGINE_OWNED_PR_BODY_TEXTS` includes the heading |
| adr-2026-08-29-build-review-remediate-case-adjudication#D1 | no-change | none | Independent rubric fan-out and the mechanical raw join are unchanged; severity is one more field on each rubric's own finding. |
| adr-2026-08-29-build-review-remediate-case-adjudication#D2 | task | task-19 | resolves as carried acceptance through `resolveBuildReviewAcceptance`, the bound case's disposition is unchanged |
| adr-2026-08-29-build-review-remediate-case-adjudication#D3 | task | task-12 | The adjudication coordinator's live-source set for a lap with one advisory and one unresolved finding contains only the unresolved finding |
| adr-2026-08-29-build-review-remediate-case-adjudication#D4 | task | task-18 | Under threshold major, an advisory case with adjudicatedSeverity minor, a non-empty rationale and effect none passes `remediation-case-artifact` parsing |
| adr-2026-08-29-build-review-remediate-case-adjudication#D5 | task | task-13 | `RemediationCaseStore.read` returns a kind-less legacy entry as kind confidence with its confidence and floor unchanged |
| adr-2026-08-29-build-review-remediate-case-adjudication#D6 | task | task-21 | emits `remediation_adjudication_completed` with that case id and an empty new effect id list |
| adr-2026-08-29-build-review-remediate-case-adjudication#D7 | task | task-12 | A lap with an advisory and an unresolved finding that routes BUILD charges the kickback ledger once, for the unresolved finding's action case only. |
| adr-2026-08-29-build-review-remediate-case-adjudication#D8 | task | task-10 | places a lone minor finding at confidence 96 in advisory with an empty unresolved set and an effective verdict of PASS |
| adr-2026-08-29-build-review-remediate-case-adjudication#D9 | task | task-14 | emits `build_review_outer_verdict` with `advisoryFindings` carrying the advisory finding's id, rubric, severity and threshold |
| adr-2026-08-29-build-review-remediate-case-adjudication#D10 | no-change | none | The adjudication rollout gate is unchanged; threshold classification runs before adjudication, and the advisory disposition exists only where adjudication runs. |

## Verification

- [x] All happy path criteria covered by at least one task
- [x] All negative path criteria covered by at least one task
- [x] No task exceeds 5 minutes of work
- [x] Every task has a `Done when:` block of falsifiable checks; no unbounded quality word is left without its closed enumeration or named mechanism (3c)
- [x] Dependencies are explicit and acyclic
- [ ] Tasks do not invalidate each other's fixtures or assertions (plan review sweeps this at Tier L)
