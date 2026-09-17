# Implementation Plan: Grade the diff for security defects before ship via a build_review security rubric (#2034)

**Date:** 2026-09-14
**Status:** Approved
**Approved by:** James Stoup, 2026-09-14
**Source:** jstoup111/ai-conductor#2034
**Design:** .docs/architecture/grade-the-diff-for-security-defects-before-ship-vi.md
**Architecture review:** .docs/decisions/architecture-review-2026-09-14-grade-the-diff-for-security-defects-before-ship-vi.md
**Stories:** .docs/stories/grade-the-diff-for-security-defects-before-ship-vi.md
**Conflict check:** PASS, 2026-09-14, one blocking contradiction resolved by a companion main-based story PR
**Tier:** M

## Summary

**Amendment 2026-09-17 (prd_audit PLAN_GAP S6.1/S6.9, as-built AB-1):** Task 12 and Story 6 now follow ADR adr-2026-08-29 D4.2 — `confidence` is optional and absent means blocking — and the unchanged-sink negative fixture must prove a finding anchored to the changed hunk rather than zero findings.

Fourteen TDD tasks add `security` as the second built-in, default-off member of the build_review rubric container: registry and config, a whole-diff projection with content-addressed caching, a ten-member closed vocabulary with content-region anchors, aggregate and adjudicator flow with no plan-binding exemption, the shipped `build-review-security` skill, its integrity and model-table registration, and the removal of security grading from the per-batch code-review evaluator.

## Technical Approach

- **Widen the closed catalog, keep it closed.** `BUILD_REVIEW_RUBRIC_IDS` becomes `['testQuality', 'security']` in `build-review-registry.ts`; the derived `RegisteredBuildReviewRubricId` union propagates to `types/config.ts`, `config.ts`, `resolved-config.ts`, `build-review-aggregate.ts`, `build-review-domain.ts`, `build-review-finding-identity.ts`, `build-review-projections.ts`, and the `label` map in `step-runners.ts`. Every site that today enumerates `testQuality` by literal is replaced by iteration over the registry or by an explicit two-member record; no new independent id list is introduced.
- **Projection.** `SecurityProjection` carries exactly the `CommonProjection` fields. `BuildReviewRubricProjection` becomes a discriminated union on `rubric`; `common()` takes the descriptor for the rubric being projected; `deriveBuildReviewRubricProjections` returns both members. Cache identity is unchanged in shape: projection digest + policy fingerprint + engine identity (engine stamp + `skills/build-review-security/SKILL.md` digest).
- **Contract.** `BUILD_REVIEW_FINDING_VOCABULARIES.security` = ten `concernKinds`, anchor field `locus` of kind `content-region` whose `contentHash` is `sha256` over the projected hunk's normalized added+removed lines. `renderBuildReviewProviderPayloadShape('security')` renders `findings` only (no `scopeResolutions`, no `counterfactualSensitivity`). `parseBuildReviewFindingAnchor` accepts `rubric: 'security'` with a content-region locus and rejects coordinate fields. The reviewer-field strip, single repair turn, and refusal-to-infrastructure mapping are reused from the existing validator.
- **Aggregate and adjudication.** `joinBuildReviewRubricOutcomes` iterates the registry; a judged `security` result with findings produces `FAIL` and its findings project as raw sources with `rubric: 'security'`. There is no `beyond` path in the engine; the tasks prove that no rubric-conditional branch drops a security finding before `projectBuildReviewAggregateSources`. Adjudicator routes (`act`, `defer`, `refute`) are existing behaviour proven against security-sourced fixtures.
- **Skill.** `skills/build-review-security/SKILL.md` follows the `build-review-test-quality` exemplar: judgement-only contract, closed input projection, `findings`-only result, the machine-checked `**Closed vocabulary:**` and `**Reference grammar:**` lines, a definition and an explicit non-finding for each of the ten kinds, one finding per independent defect anchored to the introducing hunk. Allowed variation from the exemplar: no scope resolutions, no counterfactual, multi-member vocabulary. Search hints: `skills/build-review-test-quality/SKILL.md`, `renderBuildReviewProviderPayloadShape`, `BUILD_REVIEW_FINDING_VOCABULARIES`.
- **Registration and single ownership.** `test/check_build_review_rubric_skill_vocabularies.sh` gains `security` in its rubric table and both loops; `AUXILIARY_MODEL_TABLE_ROWS` gains the `build-review-security` row and `bin/generate-model-table` regenerates `ARCHITECTURE.md`; `docs/reference/skills.md` counts and the explicit-only list are updated because integrity check 2a enumerates them. `skills/code-review/SKILL.md` loses the Stage 2 `security` checklist mention, the pattern-basis `security` risk word, and the Stage 4 "security vulnerabilities" calibration line; the model-routing criterion naming "security boundaries" is pinned by another accepted story and stays.
- **Testing pattern.** Existing `src/conductor/test/engine/build-review-*.test.ts` files use frozen fixture snapshots and faked provider candidates; new assertions extend those files rather than adding parallel suites. Every third-party boundary stays faked; no live provider call.

## Prerequisites

- Accepted stories, the PASS conflict report, the five ADR amendment notes, and the sequence diagram are in this spec change set.
- Companion PR `fix/re-judges-story-runnable-rubrics` restates the #1805 Story 1 invariant on main; it carries no implementation and does not gate BUILD.
- Advisory overlap scan on 2026-09-14: `origin/spec/daemon-self-host-guardrails` also touches `src/conductor/src/types/config.ts`, `src/conductor/src/engine/config.ts`, and `src/conductor/src/engine/resolved-config.ts`; Tasks 1–2 keep their edits to the rubric id list and the two rubric default maps so a rebase conflict, if any, is local.
- No schema migration, external service, port, database, or fixture installation is required. `bin/generate-model-table` and `test/test_harness_integrity.sh` are the only repository tools invoked.

## Tasks

### Task 1: Register the security descriptor in the closed catalog
**Story:** 1 (S1.1)
**Type:** infrastructure

**Steps:**
1. Write failing tests in `build-review-registry.test.ts` asserting `BUILD_REVIEW_RUBRIC_IDS` equals `['testQuality', 'security']`, `isRegisteredRubric('security')` is true, and `getBuildReviewRubricDescriptor('security')` returns `skillName: 'build-review-security'`, `contractVersion` current, `projectionVersion: 'v3'`, `cachePolicy: 'content-addressed'`, `prerequisite: 'none'`.
2. Run `npx vitest run test/engine/build-review-registry.test.ts` from `src/conductor` and observe RED on the missing id, not a compile error.
3. Add the `security` tuple member and frozen descriptor; widen `BuildReviewRubricId` in `src/conductor/src/types/config.ts` and the local `BUILD_REVIEW_RUBRIC_IDS` in `src/conductor/src/engine/config.ts` to derive from the registry rather than a second literal list.
4. Run the same command and observe GREEN; run `npx tsc --noEmit` and fix every site the widened union breaks only enough to compile (no behaviour yet).
5. Commit with message: `feat(build-review): register the security rubric descriptor`.

**Done when:**
- `BUILD_REVIEW_RUBRIC_IDS` is exactly `['testQuality', 'security']` and `isRegisteredRubric('security')` returns true, as asserted by the registry test.
- `getBuildReviewRubricDescriptor('security')` returns skill name `build-review-security`, projection version `v3`, and cache policy `content-addressed`.
- `BuildReviewRubricId` in `types/config.ts` and the id list in `config.ts` are derived from the registry tuple; no third literal copy of the id list exists in `src/conductor/src`.

**Files:** `src/conductor/src/engine/build-review-registry.ts`; `src/conductor/src/types/config.ts`; `src/conductor/src/engine/config.ts`; `src/conductor/test/engine/build-review-registry.test.ts`

**Dependencies:** none

### Task 2: Validate and default the security rubric policy
**Story:** 1 (S1.2, S1.4, S1.5)
**Type:** negative-path

**Steps:**
1. Write failing tests in `config.test.ts` and `resolved-config.test.ts`: a config omitting `security` resolves `enabled: false`, `effort: 'high'`, `min_confidence: 0`; `enabled: "yes"` fails validation with a message naming `build_review.rubrics.security.enabled` and `boolean`; `effort: extreme` fails naming the key and the allowed set.
2. Run `npx vitest run test/engine/config.test.ts test/engine/resolved-config.test.ts` and observe RED.
3. Extend `validateBuildReviewRubrics` normalization so every registry member is materialized `enabled: false` unless set; add `security: false` to `DEFAULT_RUBRIC_ENABLED` and `security: 'high'` to `DEFAULT_RUBRIC_EFFORT`; keep the `build_review.rubrics` consumer-registry key set unchanged. Enable `security` for this repository in `.ai-conductor/config.yml` beside `testQuality` (repo-only half of the change).

> **Amended 2026-09-15 by operator approval (James Stoup, interactive halt recovery):** Self-host activation is deferred to a separate follow-up after this rubric implementation ships and the running engine recognizes `security`. This feature omits the `security` key from `.ai-conductor/config.yml`; all consumer opt-in behavior and default-off tests remain required. The current daemon rejects an unknown rubric key before `test_suite` starts, even when that key is disabled.

4. Run the same command and observe GREEN.
5. Commit with message: `feat(build-review): resolve the security rubric policy default-off`.

**Done when:**
- `resolveBuildReviewConfig` on a config that omits `security` yields `rubrics.security.enabled === false` and `effort === 'high'`, as asserted by the resolved-config test.
- `validateConfig` rejects `build_review.rubrics.security.enabled: "yes"` and `effort: extreme` with errors that name the offending key, as asserted by the config test.
- `.ai-conductor/config.yml` declares `build_review.rubrics.security.enabled: true` for self-host builds, and the shipped default remains off.

> **Amended 2026-09-15 by operator approval (James Stoup, interactive halt recovery):** Self-host activation is deferred to a separate follow-up after this rubric implementation ships and the running engine recognizes `security`. This feature omits the `security` key from `.ai-conductor/config.yml`; all consumer opt-in behavior and default-off tests remain required. The current daemon rejects an unknown rubric key before `test_suite` starts, even when that key is disabled.

**Files:** `src/conductor/src/engine/config.ts`; `src/conductor/src/engine/resolved-config.ts`; `.ai-conductor/config.yml`; `src/conductor/test/engine/config.test.ts`; `src/conductor/test/engine/resolved-config.test.ts`

**Dependencies:** Task 1

### Task 3: Classify the security branch as dispatchable or skipped
**Story:** 1 (S1.1, S1.3, S1.6)
**Type:** happy-path

**Steps:**
1. Write failing tests in `build-review-coordinator.test.ts`: with `security.enabled: true` classification yields a dispatchable branch `{rubric: 'security', skillName: 'build-review-security', policy}`; with it absent the branch is `{kind: 'skipped', reason: 'disabled'}` and no cache/preflight/dispatch callback fires; with both members disabled the outcome is PASS with reason `build_review_no_rubrics`; with only `security` enabled exactly one dispatch occurs.
2. Run `npx vitest run test/engine/build-review-coordinator.test.ts` and observe RED.
3. Make `classifyBuildReviewRubricBranches` and `coordinateBuildReviewRubrics` iterate the registry, keeping the testQuality-only empty-scope and preflight branches conditional on `rubric === 'testQuality'`; add `security: 'Security'` to the dispatch `label` map in `step-runners.ts`.
4. Run the same command and observe GREEN.
5. Commit with message: `feat(build-review): classify and dispatch the security branch`.

**Done when:**
- `classifyBuildReviewRubricBranches` returns a dispatchable `security` branch carrying the resolved policy when enabled and a skipped branch with reason `disabled` when absent, as asserted by the coordinator test.
- An enabled gate with every member disabled settles PASS with reason `build_review_no_rubrics` and zero dispatch, cache, or preflight callbacks, as asserted by the coordinator test.
- A lap with only `security` enabled invokes `dispatchModel` exactly once with `rubric: 'security'`, and the prompt label for that branch is `Security`.

**Files:** `src/conductor/src/engine/build-review-coordinator.ts`; `src/conductor/src/engine/step-runners.ts`; `src/conductor/test/engine/build-review-coordinator.test.ts`

**Dependencies:** Task 2

### Task 4: Derive the whole-diff security projection
**Story:** 2 (S2.1, S2.6)
**Type:** happy-path

**Steps:**
1. Write failing tests in `build-review-projections.test.ts`: a three-file snapshot yields a `security` projection whose `changedFiles` equals `deriveChangedFileReferences(snapshot.diff)`, whose keys are exactly the common fields plus `rubric: 'security'`, and whose `digest` is stable; an empty post-exclusion diff yields `changedFiles: []`.
2. Run `npx vitest run test/engine/build-review-projections.test.ts` and observe RED.
3. Add `SecurityProjection`, make `BuildReviewRubricProjection` a union, parameterize `common()` by descriptor, and return both members from `deriveBuildReviewRubricProjections`.
4. Run the same command and observe GREEN.
5. Commit with message: `feat(build-review): derive the security projection from the frozen diff`.

**Done when:**
- `deriveBuildReviewRubricProjections` returns a `security` member whose `changedFiles` equals the by-reference parse of the frozen diff and whose field set is exactly the common projection fields, as asserted by the projections test.
- A snapshot with an empty diff after machinery-path exclusion yields a `security` projection with `changedFiles: []` and a sealed digest, as asserted by the projections test.

**Files:** `src/conductor/src/engine/build-review-projections.ts`; `src/conductor/test/engine/build-review-projections.test.ts`

**Dependencies:** Task 1

### Task 5: Prove content-addressed cache identity for security judgements
**Story:** 2 (S2.2, S2.3, S2.4, S2.5, S2.7)
**Type:** negative-path

**Steps:**
1. Write failing tests in `build-review-cache.test.ts` and `build-review-coordinator.test.ts`: identical projection + policy fingerprint + skill digest yields a cache hit and a `build_review_cache_hit` event for `security` with no dispatch; two snapshots with equal hunk content and different `headSha` yield equal `security` digests; a one-byte skill change or a model change yields a miss and a dispatch; an unreadable `skills/build-review-security/SKILL.md` yields an infrastructure failure `cache-read-failed` and no cache write.
2. Run `npx vitest run test/engine/build-review-cache.test.ts test/engine/build-review-coordinator.test.ts` and observe RED where the security branch is not yet exercised.
3. Ensure `resolveBuildReviewEngineIdentity` resolves the skill path from the descriptor's `skillName` and that cache read/write for `security` flows through `BuildReviewCacheFilesystem` unchanged.
4. Run the same command and observe GREEN.
5. Commit with message: `test(build-review): pin security cache identity and unreadable-skill failure`.

**Done when:**
- An identical `security` projection under the same policy fingerprint and skill digest is served from cache with zero `dispatchModel` calls and one `build_review_cache_hit` occurrence naming `security`, as asserted by the coordinator test.
- Two snapshots with equal hunk content and different commit shas produce equal `security` projection digests, as asserted by the projections or cache test.
- A skill-digest change or a policy-fingerprint change produces a cache miss and one dispatch for `security`, as asserted by the cache test.
- An unreadable `skills/build-review-security/SKILL.md` settles the branch as infrastructure failure `cache-read-failed` with no cache write and no judged result, as asserted by the coordinator test.

**Files:** `src/conductor/src/engine/step-runners.ts`; `src/conductor/test/engine/build-review-cache.test.ts`; `src/conductor/test/engine/build-review-coordinator.test.ts`

**Dependencies:** Task 3, Task 4

### Task 6: Add the security vocabulary and content-region anchor grammar
**Story:** 3 (S3.2, S3.4, S3.5, S3.7)
**Type:** negative-path

**Steps:**
1. Write failing tests in `build-review-domain.test.ts` and `build-review-finding-identity.test.ts`: `BUILD_REVIEW_FINDING_VOCABULARIES.security.concernKinds` equals the ten members in the vocabulary ADR amendment; `parseBuildReviewFindingAnchor` accepts `{rubric: 'security', locus: {path, contentHash: 'sha256:…', display}}` and rejects `{…, line: 42}` naming the content-region grammar; `concernKind: 'other'` is rejected naming the closed vocabulary; an anchor path outside `changedFiles` is rejected as outside the frozen input; two findings differing only in `summary`/`evidenceLocations` canonicalize to one id.
2. Run `npx vitest run test/engine/build-review-domain.test.ts test/engine/build-review-finding-identity.test.ts` and observe RED.
3. Add the `security` vocabulary entry, widen `BuildReviewFindingAnchor` to a union keyed by rubric, extend `parseCanonicalAnchor` and `describeBuildReviewJudgedResultRejection` for the security locus, and render the security payload shape as `findings` only.
4. Run the same command and observe GREEN.
5. Commit with message: `feat(build-review): add the security finding vocabulary and anchor grammar`.

**Done when:**
- `BUILD_REVIEW_FINDING_VOCABULARIES.security.concernKinds` is exactly the ten members `committed-secret`, `injection`, `broken-access-control`, `path-traversal`, `unsafe-deserialization`, `cryptographic-failure`, `security-misconfiguration`, `authentication-failure`, `integrity-failure`, `ssrf`, as asserted by the domain test.
- `parseBuildReviewFindingAnchor` accepts a `security` content-region locus and rejects a coordinate-bearing locus with a diagnosis naming the content-region grammar, as asserted by the domain test.
- An out-of-vocabulary `concernKind` and an anchor path outside the projection's `changedFiles` are each rejected with a diagnosis naming the violated rule, as asserted by the domain test.
- `canonicalizeBuildReviewFindingIdentity` for `security` hashes rubric, contract version, concern kind, and anchor only, so two findings differing in summary and evidence share one id, as asserted by the finding-identity test.

**Files:** `src/conductor/src/engine/build-review-domain.ts`; `src/conductor/src/engine/build-review-finding-identity.ts`; `src/conductor/test/engine/build-review-domain.test.ts`; `src/conductor/test/engine/build-review-finding-identity.test.ts`

**Dependencies:** Task 1

### Task 7: Stamp the security envelope and refuse reviewer-supplied identity

> **Amended 2026-09-16 by operator approval (James Stoup, interactive halt recovery for #2568):** Follow adr-2026-08-19-engine-stamped-rubric-judged-result-envelope D4. The title, step 1, and Done when rejection requirement below are superseded: ignore all reviewer-supplied envelope fields, stamp engine-owned metadata, and derive the verdict from validated findings. Envelope echoes never trigger repair or dispatch failure. Invalid security findings and test-quality-only evidence remain rejected. The coordinator tests own this boundary proof.
**Story:** 3 (S3.1, S3.6, S3.8)
**Type:** negative-path

**Steps:**
1. Write failing tests in `build-review-coordinator.test.ts`: a valid `injection` payload produces a judged `security` result whose `kind`, `rubric`, `contractVersion`, `lapId`, `snapshotDigest` come from the projection and whose verdict is `FAIL`; a payload carrying top-level `verdict` or `rubric: 'testQuality'` is rejected and, after one byte-identical repair, settles as a dispatch failure; a reply stating it cannot perform a security review settles as an infrastructure failure, never a PASS.
2. Run `npx vitest run test/engine/build-review-coordinator.test.ts` and observe RED.
3. Route `security` through `stampBuildReviewDispatchedCandidate` and `validateBuildReviewDispatchedResult` with the security vocabulary, reusing the single repair turn and refusal mapping.
4. Run the same command and observe GREEN.
5. Commit with message: `feat(build-review): stamp and validate security judged results`.

**Done when:**
- A valid security payload produces a judged result whose envelope identity fields come from the projection and whose verdict is `FAIL` when findings are non-empty and `PASS` when empty, as asserted by the coordinator test.
- A payload carrying a reviewer-supplied envelope field is rejected, and a byte-identical repair settles the branch as a dispatch failure rather than a PASS, as asserted by the coordinator test.
- A provider refusal settles the `security` branch as an infrastructure failure with no judged result, as asserted by the coordinator test.

**Files:** `src/conductor/src/engine/build-review-coordinator.ts`; `src/conductor/src/engine/build-review-domain.ts`; `src/conductor/test/engine/build-review-coordinator.test.ts`

**Dependencies:** Task 3, Task 6

### Task 8: Apply the security confidence floor
**Story:** 3 (S3.3)
**Type:** happy-path

**Steps:**
1. Write a failing test in `build-review-effective.test.ts`: a `security` finding with `confidence: 40` under `security.min_confidence: 60` lands in the suppressed set, leaves the unresolved set empty, and yields effective PASS; the same finding with `confidence` omitted stays blocking.
2. Run `npx vitest run test/engine/build-review-effective.test.ts` and observe RED.
3. Make `deriveEffectiveBuildReviewVerdictWithDispositions` read the floor per registry member rather than by `testQuality` literal.
4. Run the same command and observe GREEN.
5. Commit with message: `feat(build-review): apply the per-rubric confidence floor to security`.

**Done when:**
- `deriveEffectiveBuildReviewVerdictWithDispositions` suppresses a `security` finding whose confidence is below the resolved `security.min_confidence` floor and derives PASS when nothing else is unresolved, as asserted by the effective-verdict test.
- A `security` finding with no `confidence` remains in the unresolved set under any floor, as asserted by the effective-verdict test.

**Files:** `src/conductor/src/engine/build-review-aggregate.ts`; `src/conductor/test/engine/build-review-effective.test.ts`

**Dependencies:** Task 6

### Task 9: Join security outcomes into the aggregate verdict
**Story:** 4 (S4.1, S4.2, S4.5, S4.8, S4.9)
**Type:** happy-path

**Steps:**
1. Write failing tests in `build-review-aggregate.test.ts`: a lap with one judged `committed-secret` finding joins to `verdict: 'FAIL'` with `security` among the failed rubrics and `projectBuildReviewAggregateSources` yields it with `rubric: 'security'` and `sourceId` prefix `security:`; a zero-finding security result joins to `PASS`; `testQuality` infrastructure failure plus a valid `security` judged result preserves the security findings and records the test-quality failure in coverage; a `security` infrastructure failure yields non-PASS charged to the mechanical-fault lane; an operator-accepted `security` finding under the current contract version is excluded and the lap passes.
2. Run `npx vitest run test/engine/build-review-aggregate.test.ts` and observe RED.
3. Replace the local `RUBRICS` literal in `build-review-aggregate.ts` with the registry tuple; keep `parseBuildReviewAggregate` re-derivation exhaustive over both members.
4. Run the same command and observe GREEN.
5. Commit with message: `feat(build-review): join security outcomes into the aggregate`.

**Done when:**
- Joining a lap with one judged `security` finding yields `verdict: FAIL` with `security` among the failed rubrics, and `projectBuildReviewAggregateSources` yields that finding with `rubric: security`, as asserted by the aggregate test.
- Joining a lap with a zero-finding `security` result yields `verdict: PASS` with no security reason, as asserted by the aggregate test.
- A lap with a `testQuality` infrastructure failure and a valid `security` judged result preserves the security findings in the aggregate and records the failure under coverage, as asserted by the aggregate test.
- A `security` infrastructure failure yields a non-PASS aggregate charged to the mechanical-fault lane, and an operator-accepted `security` finding is excluded from the effective verdict, as asserted by the aggregate and effective-verdict tests.

**Files:** `src/conductor/src/engine/build-review-aggregate.ts`; `src/conductor/test/engine/build-review-aggregate.test.ts`; `src/conductor/test/engine/build-review-effective.test.ts`

**Dependencies:** Task 6

### Task 10: Route security findings through the adjudicator with no plan-binding exemption
**Story:** 4 (S4.3, S4.4, S4.6, S4.7)
**Type:** negative-path

**Steps:**
1. Write failing tests in `build-review-adjudication-context.test.ts`, `build-review-adjudication-coordinator.test.ts`, and `build-review-adjudication.test.ts`: a `security` finding whose location no plan `Done when:` names appears in `currentFindings` unchanged and no `beyond` bucket, record, or intake filing exists on any code path; an `act` case for a security source reduces to route `build` with a work order and no plan append; `defer` files intake with the justification and does not reduce to `pass` on that source; `refute` with evidence settles the source without a kickback charge.
2. Run `npx vitest run test/engine/build-review-adjudication-context.test.ts test/engine/build-review-adjudication-coordinator.test.ts test/engine/build-review-adjudication.test.ts` and observe RED only where a security-sourced fixture is not yet accepted.
3. Ensure `assembleBuildReviewAdjudicationContext` and `reduceBuildReviewAdjudication` treat `security` sources identically to `testQuality` sources; add no rubric-conditional branch.
4. Run the same command and observe GREEN.
5. Commit with message: `test(build-review): route security findings through the adjudicator`.

**Done when:**
- `assembleBuildReviewAdjudicationContext` includes an off-plan `security` finding in `currentFindings`, and `grep -rn "beyond\|boundTo" src/conductor/src/engine` still returns no match, so no rubric-conditional path can drop it, as asserted by the adjudication-context test.
- An `act` case for a `security` source reduces to route `build` with a work order and appends no plan task, as asserted by the adjudication test.
- A `defer` case files intake with its justification and a `refute` case settles the source without charging the kickback ledger, as asserted by the adjudication-coordinator test.

**Files:** `src/conductor/src/engine/build-review-adjudication-context.ts`; `src/conductor/src/engine/build-review-adjudication.ts`; `src/conductor/test/engine/build-review-adjudication-context.test.ts`; `src/conductor/test/engine/build-review-adjudication-coordinator.test.ts`; `src/conductor/test/engine/build-review-adjudication.test.ts`

**Dependencies:** Task 9

### Task 11: Render the security dispatch prompt from its projection and vocabulary
**Story:** 1 (S1.1)
**Type:** happy-path

**Steps:**
1. Write a failing test in `step-runners.test.ts`: dispatching a `security` branch renders a prompt containing the `Security` label, the `findings`-only payload shape with the ten concern kinds, the serialized security projection, and the host-specific invocation of `build-review-security`, and emits `build_review_rubric_prompt` with `rubric: 'security'`.
2. Run `npx vitest run test/engine/step-runners.test.ts` and observe RED.
3. Make `dispatchBuildReviewRubric` select the payload shape and label by descriptor and skip the testQuality scope-resolution context for `security`.
4. Run the same command and observe GREEN.
5. Commit with message: `feat(build-review): render the security dispatch prompt`.

**Done when:**
- `dispatchBuildReviewRubric` for `security` renders a prompt containing the `Security` label, the ten-kind payload shape with no `scopeResolutions`, and the serialized security projection, as asserted by the step-runners test.
- The dispatch emits `build_review_rubric_prompt` with `rubric: security` and invokes the `build-review-security` skill for the selected provider, as asserted by the step-runners test.

**Files:** `src/conductor/src/engine/step-runners.ts`; `src/conductor/test/engine/step-runners.test.ts`

**Dependencies:** Task 4, Task 6

### Task 12: Author the build-review-security skill and its fixture judgements
**Story:** 5 (S5.2)
**Story:** 6 (S6.1, S6.2, S6.3, S6.4, S6.5, S6.6, S6.7, S6.8, S6.9)
**Type:** happy-path

**Steps:**
1. Write failing tests in `build-review-rubric-skills.test.ts` and `build-review-skill-contract.test.ts`: the skill file exists with frontmatter `name: build-review-security`, `disable-model-invocation: true`, `enforcement: gating`, `phase: build`; its `**Closed vocabulary:**` line lists the ten kinds and its `**Reference grammar:**` line binds `anchor.locus` to `content-region`; its result contract names `findings` only and no `boundTo`, `scopeResolutions`, or `counterfactualSensitivity`; fixture payloads for the committed-secret, injection, authorization-removal, and SSRF diffs validate as judged FAIL with the named kinds; fixture payloads for the rename-only, fake-test-credential, manifest-bump, and design-only diffs validate as judged results with zero blocking findings, and the unchanged-sink fixture validates as one finding anchored to the changed hunk with the unchanged line named only in `evidenceLocations`.
2. Run `npx vitest run test/engine/build-review-rubric-skills.test.ts test/engine/build-review-skill-contract.test.ts` and observe RED.
3. Author `skills/build-review-security/SKILL.md` on the test-quality exemplar: purpose, closed input projection (whole diff by reference, worktree reads as part of the input), judgement (one finding per independent defect, anchored to the introducing hunk, unchanged sinks cited only in `evidenceLocations`, a definition and an explicit non-finding for each of the ten kinds, optional integer `confidence`, absent means blocking per ADR D4.2), result contract, verification checklist. Add `agents/openai.yaml` only if the sibling shipped rubric skill carries one.
4. Run the same command and observe GREEN.
5. Commit with message: `feat(skills): add the build-review-security rubric skill`.

**Done when:**
- `skills/build-review-security/SKILL.md` carries the four required frontmatter fields plus `disable-model-invocation: true`, a ten-member `**Closed vocabulary:**` line, and a `**Reference grammar:**` line binding `anchor.locus` to `content-region`, as asserted by the rubric-skills test.
- The skill's result contract returns `findings` only, with no `scopeResolutions`, `counterfactualSensitivity`, or `boundTo` field, and its judgement section defines each of the ten concern kinds with an explicit non-finding and accepts an optional integer `confidence` (absent means blocking, per ADR D4.2), as asserted by the skill-contract test.
- Fixture payloads for the four happy-path diffs validate as judged `FAIL` results with the named concern kinds, and fixture payloads for the four zero-finding negative diffs validate as judged results with zero blocking findings, and the unchanged-sink fixture validates as one finding anchored to the changed hunk with the unchanged line named only in `evidenceLocations`, as asserted by the rubric-skills test.

**Files:** `skills/build-review-security/SKILL.md`; `src/conductor/test/engine/build-review-rubric-skills.test.ts`; `src/conductor/test/engine/build-review-skill-contract.test.ts`

**Dependencies:** Task 6

### Task 13: Bind the security skill to the integrity guard and the generated model table
**Story:** 5 (S5.1, S5.4, S5.5, S5.6)
**Type:** negative-path

**Steps:**
1. Write failing checks: extend `test/check_build_review_rubric_skill_vocabularies.sh` with a `security` entry in its rubric table and both per-rubric loops, and add drift fixtures proving a skill-side extra member and an engine-side extra member each fail naming `security` and the member; add a `build-review-security` row to `AUXILIARY_MODEL_TABLE_ROWS`.
2. Run `bash test/check_build_review_rubric_skill_vocabularies.sh` and `bash test/test_harness_integrity.sh` and observe the vocabulary check and model-table drift check RED.
3. Regenerate `ARCHITECTURE.md` with `bin/generate-model-table`; update `docs/reference/skills.md` counts and the explicit-only list because integrity check 2a enumerates shipped skills.
4. Run the same commands and observe GREEN, including check 5a with a hand-edited table failing and the regenerated table passing.
5. Commit with message: `test(integrity): bind the security rubric vocabulary and model-table row`.

**Done when:**
- `test/check_build_review_rubric_skill_vocabularies.sh` iterates `security` in its rubric table and both per-rubric loops and exits non-zero naming `security` and the drifted member on a skill-side or engine-side one-member drift, as asserted by its drift fixtures.
- `AUXILIARY_MODEL_TABLE_ROWS` carries a `build-review-security` row and `bin/generate-model-table` output matches the committed `ARCHITECTURE.md` table, as asserted by integrity check 5a.
- A hand-edited `ARCHITECTURE.md` security row without the metadata entry fails integrity check 5a.

**Files:** `test/check_build_review_rubric_skill_vocabularies.sh`; `src/conductor/src/engine/model-table-metadata.ts`; `ARCHITECTURE.md`; `docs/reference/skills.md`; `docs/reference/configuration.md`; `docs/explanation/gates.md`

**Dependencies:** Task 12

### Task 14: Remove security grading from the per-batch code-review evaluator
**Story:** 5 (S5.3)
**Type:** refactor

**Steps:**
1. Write a failing assertion in `test/test_skill_pipeline_contract.sh` (or the existing skill-contract shell check that reads `skills/code-review/SKILL.md`) that the Stage 2 checklist does not list `security` among stack-specific checks, the pattern-basis line does not name a `security` risk, and the Stage 4 calibration does not name `security vulnerabilities`, while the model-routing criterion still names `security boundaries`.
2. Run that check and observe RED.
3. Edit `skills/code-review/SKILL.md`: drop `security` from the Stage 2 stack-specific list, from the pattern-basis risk clause, and from the Stage 4 calibration line; leave the Claude model-selection bullet untouched.
4. Run the check and `bash test/test_provider_skill_contracts.sh` and observe GREEN.
5. Commit with message: `refactor(code-review): hand security grading to the build_review rubric`.

**Done when:**
- `skills/code-review/SKILL.md` contains no security-grading instruction in its Stage 2 checklist, pattern-basis clause, or Stage 4 calibration, as asserted by the skill-contract shell check.
- The model-selection bullet naming `security boundaries` is unchanged, as asserted by the same check, and `test/test_provider_skill_contracts.sh` passes.

**Files:** `skills/code-review/SKILL.md`; `test/test_skill_pipeline_contract.sh`

**Dependencies:** none

## Task Dependency Graph

```
Task 1 ─┬─ Task 2 ── Task 3 ─┬─ Task 5
        │                    └─ Task 7
        ├─ Task 4 ─┬─ Task 5
        │          └─ Task 11
        └─ Task 6 ─┬─ Task 7
                   ├─ Task 8
                   ├─ Task 9 ── Task 10
                   ├─ Task 11
                   └─ Task 12 ── Task 13
Task 14 (independent)
```

## Integration Points

- After Task 3: an enabled `security` branch is classified and dispatched through the production coordinator with a faked provider.
- After Task 7: a faked security payload round-trips validation and stamping into a judged result.
- After Task 10: a security finding reaches the adjudicator context and reduces to a route through the production coordinator.
- After Task 13: the shipped skill passes the harness integrity suite end to end.

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-08-22-build-review-opt-in-rubric-container#D1 | task | task-1, task-2 | `isRegisteredRubric('security')` returns true |
| adr-2026-08-22-build-review-opt-in-rubric-container#D2 | no-change | none | Retired rubric keys keep their accepted-key no-op handling; this feature adds a member and touches no retired key. |
| adr-2026-08-22-build-review-opt-in-rubric-container#D3 | no-change | none | test-quality's changed-test intersection, preflight, and empty-scope PASS are conditional on `rubric === 'testQuality'` and are not altered. |
| adr-2026-08-22-build-review-opt-in-rubric-container#D4 | task | task-6 | `parseBuildReviewFindingAnchor` accepts a `security` content-region locus |
| adr-2026-08-22-build-review-opt-in-rubric-container#D5 | no-change | none | S-tier behaviour is tier-independent gate execution; a second default-off member leaves the empty container a no-dispatch PASS at every tier. |
| adr-2026-08-22-one-owner-per-review-question#D1 | task | task-14, task-10 | `skills/code-review/SKILL.md` contains no security-grading instruction |
| adr-2026-08-21-review-bound-by-plan-done-when-criteria#D1 | no-change | none | The land-gate shape rung is unchanged; this feature adds no plan-task binding requirement. |
| adr-2026-08-21-review-bound-by-plan-done-when-criteria#D2 | task | task-12 | no `scopeResolutions`, `counterfactualSensitivity`, or `boundTo` field |
| adr-2026-08-21-review-bound-by-plan-done-when-criteria#D3 | task | task-10 | no rubric-conditional path can drop it |
| adr-2026-08-21-review-bound-by-plan-done-when-criteria#D4 | no-change | none | The `beyond` record kind is retained as data and is never written for `security`; no store change. |
| adr-2026-08-21-review-bound-by-plan-done-when-criteria#D5 | no-change | none | Daemon filing of `beyond` records is unreachable for `security`, which never produces one. |
| adr-2026-08-21-review-bound-by-plan-done-when-criteria#D6 | task | task-12 | returns `findings` only |
| adr-2026-08-16-closed-build-review-finding-vocabularies#D1 | task | task-6 | is exactly the ten members |
| adr-2026-08-16-closed-build-review-finding-vocabularies#D2 | existing | none | `normalizeBuildReviewFindingVocabularyMember` in `build-review-domain.ts` lower-cases and de-underscores every vocabulary member before validation, with the existing ambiguity guard, for every registered rubric. |
| adr-2026-08-16-closed-build-review-finding-vocabularies#D3 | task | task-6 | An out-of-vocabulary `concernKind` and an anchor path outside the projection's `changedFiles` are each rejected |
| adr-2026-08-16-closed-build-review-finding-vocabularies#D4 | no-change | none | Contract version stays at the current value; the security vocabulary is additive under it and no stored disposition is invalidated. |
| adr-2026-08-16-closed-build-review-finding-vocabularies#D5 | task | task-13 | iterates `security` in its rubric table and both per-rubric loops |
| adr-2026-08-16-closed-build-review-finding-vocabularies#D6 | existing | none | `deriveEffectiveBuildReviewVerdictWithDispositions` consults the effective-verdict predicate at each decision for every rubric. |
| adr-2026-08-16-closed-build-review-finding-vocabularies#D7 | no-change | none | No contract bump occurs, so no version-invalidated disposition event is produced by this feature. |
| adr-2026-08-18-content-anchored-finding-reference-schema#D1 | no-change | none | The `path` reference kind is unchanged and unused by the security anchor. |
| adr-2026-08-18-content-anchored-finding-reference-schema#D2 | no-change | none | The `plan-task` reference kind is unchanged and unused by the security anchor. |
| adr-2026-08-18-content-anchored-finding-reference-schema#D3 | task | task-6 | hashes rubric, contract version, concern kind, and anchor only |

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a project config with `build_review.rubrics.security.enabled: true`, when the build_review step classifies its branches, then `security` is a dispatchable branch alongside any other enabled member and carries its resolved `llm_provider`, `model`, `effort`, `model_fallback_ladder`, `max_retries`, `escalate`, and `min_confidence`. | 1, 3 | "returns a dispatchable `security` branch" | diff-local |
| Story 1 happy: Given a project config that never mentions `security`, when configuration is resolved, then `security` resolves to `enabled: false` with default effort `high` and the branch settles as skipped with reason `disabled` without any provider, cache, or preflight work. | 2 | "yields `rubrics.security.enabled === false`" | diff-local |
| Story 1 happy: Given `build_review.rubrics.security.enabled: true` and every other member disabled, when the lap runs, then only `security` is dispatched and the outer verdict is derived from its judged result alone. | 3 | "invokes `dispatchModel` exactly once with `rubric: 'security'`" | diff-local |
| Story 1 negative: Given a project config with `build_review.rubrics.security.enabled: "yes"`, when configuration is validated, then validation fails naming `build_review.rubrics.security.enabled` and its expected boolean type, and no lap is dispatched. | 2 | "rejects `build_review.rubrics.security.enabled: "yes"` and `effort: extreme`" | diff-local |
| Story 1 negative: Given a project config with `build_review.rubrics.security.effort: extreme`, when configuration is validated, then validation fails naming the key and the allowed effort values. | 2 | "rejects `build_review.rubrics.security.enabled: "yes"` and `effort: extreme`" | diff-local |
| Story 1 negative: Given an enabled gate with `security` and `testQuality` both disabled, when the lap runs, then the verdict is PASS with reason `build_review_no_rubrics` and no grader is dispatched. | 3 | "settles PASS with reason `build_review_no_rubrics`" | diff-local |
| Story 2 happy: Given a frozen snapshot whose diff touches three files across two prior batches, when the security projection is derived, then it lists all three files with their change kinds and hunk ranges, carries `mergeBase`, `headSha`, `lapId`, `snapshotDigest`, and `contentDigest`, and contains no test-scope, preflight, or counterfactual field. | 4 | "`changedFiles` equals the by-reference parse of the frozen diff" | diff-local |
| Story 2 happy: Given a prior judged security result cached for a projection digest, when a later lap derives an identical projection under the same policy fingerprint and skill digest, then the branch is served from cache with no dispatch and a `build_review_cache_hit` occurrence for `security`. | 5 | "served from cache with zero `dispatchModel` calls" | diff-local |
| Story 2 happy: Given a rebase that changes commit identities but leaves every hunk's content unchanged, when the projection is derived, then its digest equals the pre-rebase digest and the cached judgement is reused. | 5 | "produce equal `security` projection digests" | diff-local |
| Story 2 negative: Given a cached security result, when `skills/build-review-security/SKILL.md` changes by one byte, then the cache lookup misses and the rubric is re-dispatched. | 5 | "produces a cache miss and one dispatch for `security`" | diff-local |
| Story 2 negative: Given a cached security result, when the resolved `security` policy changes its model, then the cache lookup misses and the rubric is re-dispatched. | 5 | "produces a cache miss and one dispatch for `security`" | diff-local |
| Story 2 negative: Given a snapshot whose diff is empty after machinery-authored path exclusion, when the security projection is derived, then `changedFiles` is empty, the rubric judges no findings, and the branch settles PASS without inventing a scope. | 4 | "yields a `security` projection with `changedFiles: []`" | diff-local |
| Story 2 negative: Given `skills/build-review-security/SKILL.md` cannot be read at dispatch, when the branch runs, then it settles as an infrastructure failure with reason `cache-read-failed` and is never recorded as a cache hit or a PASS. | 5 | "infrastructure failure `cache-read-failed`" | diff-local |
| Story 3 happy: Given a provider payload with one finding whose `concernKind` is `injection` and whose `anchor` is `{rubric: "security", locus: {path, contentHash: "sha256:…", display}}` over a projected hunk, when the result is validated, then the engine stamps a judged envelope for `security` with `kind`, `rubric`, `contractVersion`, `lapId`, and `snapshotDigest` taken from the projection and a `FAIL` verdict. | 7 | "envelope identity fields come from the projection" | diff-local |
| Story 3 happy: Given two findings that differ only in `summary` and `evidenceLocations`, when finding identities are canonicalized, then they yield the same finding id. | 6 | "share one id" | diff-local |
| Story 3 happy: Given a finding with integer `confidence` 40 and a resolved `security.min_confidence` of 60, when the effective verdict is derived, then the finding is suppressed as below the floor and does not fail the lap on its own. | 8 | "suppresses a `security` finding whose confidence is below" | diff-local |
| Story 3 negative: Given a provider payload whose finding has `concernKind: "other"`, when the result is validated, then the payload is rejected naming the closed vocabulary, one repair turn is offered, and a byte-identical repair settles the branch as a dispatch failure rather than a PASS. | 6 | "An out-of-vocabulary `concernKind`" | diff-local |
| Story 3 negative: Given a provider payload whose anchor carries `line: 42` instead of a `contentHash`, when the result is validated, then the payload is rejected naming the content-region grammar and no finding identity is minted. | 6 | "rejects a coordinate-bearing locus" | diff-local |
| Story 3 negative: Given a provider payload that includes `verdict: "PASS"` or `rubric: "testQuality"` at the top level, when the result is validated, then the reviewer-supplied envelope fields are rejected and the engine stamps its own. | 7 | "reviewer-supplied envelope field is rejected" | diff-local |
| Story 3 negative: Given a provider payload whose anchor path is not in the projection's `changedFiles`, when the result is validated, then the finding is rejected as outside the frozen input. | 6 | "anchor path outside the projection's `changedFiles`" | diff-local |
| Story 3 negative: Given a provider reply stating it cannot perform a security review, when the result is validated, then the branch settles as an infrastructure failure, never as an empty-findings PASS. | 7 | "A provider refusal settles the `security` branch as an infrastructure failure" | diff-local |
| Story 4 happy: Given `security` enabled and a judged result with one `committed-secret` finding anchored to the hunk that adds the credential, when the lap is joined, then the aggregate verdict is `FAIL`, the finding is a raw source for the adjudicator with `sourceId` `security:<findingId>`, and the outer verdict event reports the failure before any SHIP step runs. | 9 | "yields `verdict: FAIL` with `security` among the failed rubrics" | diff-local |
| Story 4 happy: Given `security` enabled and a judged result with zero findings, when the lap is joined, then the aggregate verdict is `PASS` and the outer verdict event carries no security reason. | 9 | "yields `verdict: PASS` with no security reason" | diff-local |
| Story 4 happy: Given a security finding whose location no plan task's `Done when:` names, when the lap is joined, then the finding is treated as bound and blocking, no `beyond` bucket or intake filing is produced, and the adjudicator receives it as an ordinary source. | 10 | "includes an off-plan `security` finding in `currentFindings`" | diff-local |
| Story 4 happy: Given the adjudicator returns an `act` case for a security finding, when the route is reduced, then BUILD receives a bounded retry work order under the existing cumulative bound and no plan task is appended. | 10 | "reduces to route `build` with a work order and appends no plan task" | diff-local |
| Story 4 negative: Given `security` and `testQuality` both enabled and `testQuality` settles as an infrastructure failure while `security` returns a valid judged result, when the lap is joined, then the security judged result and its findings are preserved and the lap's coverage records the test-quality failure separately. | 9 | "preserves the security findings in the aggregate" | diff-local |
| Story 4 negative: Given the adjudicator returns `defer` for a security finding, when the route is reduced, then the finding is filed as an intake issue with the deferral justification and the lap does not silently PASS on that finding. | 10 | "A `defer` case files intake with its justification" | diff-local |
| Story 4 negative: Given the adjudicator returns `refute` with evidence for a security finding, when the route is reduced, then the finding settles as refuted without charging the kickback ledger. | 10 | "a `refute` case settles the source without charging the kickback ledger" | diff-local |
| Story 4 negative: Given the security branch ends in an infrastructure failure, when the lap is joined, then the aggregate verdict is not `PASS`, the mechanical-fault lane is charged rather than the kickback budget, and the outer verdict names the failed rubric. | 9 | "charged to the mechanical-fault lane" | diff-local |
| Story 4 negative: Given a security finding that the disposition store already carries as an operator-accepted risk under the current contract version, when the effective verdict is derived, then that finding is excluded and an otherwise clean lap passes. | 9 | "operator-accepted `security` finding is excluded" | diff-local |
| Story 5 happy: Given `skills/build-review-security/SKILL.md` declares the ten-member `**Closed vocabulary:**` line and the `**Reference grammar:**` line for `anchor.locus`, when the rubric vocabulary integrity check runs, then it iterates `security` alongside `testQuality`, executes the engine parser against each declared member, and passes. | 13 | "iterates `security` in its rubric table and both per-rubric loops" | diff-local |
| Story 5 happy: Given `skills/build-review-security/SKILL.md` exists with `name`, `description`, `enforcement: gating`, `phase: build`, and `disable-model-invocation: true`, when the harness integrity suite runs, then the frontmatter, invocation-policy, and model-table checks pass with a generated `build-review-security` row. | 12 | "carries the four required frontmatter fields" | diff-local |
| Story 5 happy: Given the per-batch code-review evaluator prompt, when it is rendered, then it contains no instruction to grade security, and its calibration text no longer names security vulnerabilities as an evaluator target. | 14 | "contains no security-grading instruction" | diff-local |
| Story 5 negative: Given the skill text lists an eleventh vocabulary member the engine does not know, when the rubric vocabulary integrity check runs, then it fails naming `security` and the unknown member. | 13 | "exits non-zero naming `security` and the drifted member" | diff-local |
| Story 5 negative: Given the engine vocabulary gains a member the skill text does not list, when the rubric vocabulary integrity check runs, then it fails naming `security` and the missing member. | 13 | "exits non-zero naming `security` and the drifted member" | diff-local |
| Story 5 negative: Given `ARCHITECTURE.md`'s model table is hand-edited to add the security row without the metadata entry, when the model-table drift check runs, then it fails. | 13 | "A hand-edited `ARCHITECTURE.md` security row without the metadata entry fails integrity check 5a" | diff-local |
| Story 6 happy: Given a diff that adds a string literal matching a live-credential shape to a committed source file, when the security rubric judges it, then it returns one `committed-secret` finding anchored to that hunk with the file path in `evidenceLocations` and a calibrated integer `confidence`. | 12 | "validate as judged `FAIL` results with the named concern kinds" | diff-local |
| Story 6 happy: Given a diff that builds a shell or SQL command by concatenating request-derived input, when the security rubric judges it, then it returns one `injection` finding per independent sink anchored to the hunk that introduces the concatenation. | 12 | "validate as judged `FAIL` results with the named concern kinds" | diff-local |
| Story 6 happy: Given a diff that removes an authorization check from a request handler, when the security rubric judges it, then it returns one `broken-access-control` finding anchored to the hunk that removes the check and cites the now-unprotected handler in `evidenceLocations`. | 12 | "validate as judged `FAIL` results with the named concern kinds" | diff-local |
| Story 6 happy: Given a diff that makes an outbound request to a URL taken from request input without an allow-list, when the security rubric judges it, then it returns one `ssrf` finding anchored to the introducing hunk. | 12 | "validate as judged `FAIL` results with the named concern kinds" | diff-local |
| Story 6 negative: Given a diff that only renames variables and reorders imports in a request handler, when the security rubric judges it, then it returns zero findings. | 12 | "zero blocking findings" | diff-local |
| Story 6 negative: Given a diff that adds a test fixture containing an obviously fake credential under a test directory, when the security rubric judges it, then it returns zero `committed-secret` findings or a finding whose `confidence` is below 50. | 12 | "zero blocking findings" | diff-local |
| Story 6 negative: Given a diff that touches a dependency manifest version without changing any code path, when the security rubric judges it, then it returns zero findings, because vulnerable-component judgement is out of this rubric's vocabulary. | 12 | "zero blocking findings" | diff-local |
| Story 6 negative: Given a diff whose defect is an architectural design choice with no single introducing hunk, when the security rubric judges it, then it returns zero findings rather than anchoring an `insecure-design` concern the vocabulary does not admit. | 12 | "zero blocking findings" | diff-local |
| Story 6 negative: Given a diff that introduces an exposure whose exploitable sink is on an unchanged line, when the security rubric judges it, then the finding anchors to the changed hunk that creates the exposure and names the unchanged line only in `evidenceLocations`. | 12 | "zero blocking findings" | diff-local |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks; no unbounded quality word is left without its closed enumeration or named mechanism
- [ ] Dependencies are explicit and acyclic

## Deferred follow-up: activate security review for self-host builds

Approved by James Stoup on 2026-09-15 as a separate change after #2034 ships.

- Prerequisite: the rubric implementation is merged and the running self-host daemon uses an engine whose registry accepts `security`.
- Deliverable: enable `build_review.rubrics.security.enabled: true` in this repository’s `.ai-conductor/config.yml`.
- Verification: the running engine accepts the configuration and an enabled self-host lap dispatches the security rubric; shipped consumer defaults stay off.
- This activation is intentionally excluded from the current feature’s completion criteria.

### Task rem-as-built-rem-ab1-1: src/conductor/src/engine/artifacts.ts:2166,2198 — derive the verdict rubric contract from the single registry authority: import BUILD_REVIEW_RUBRIC_IDS from './build-review-registry.js' (no import cycle: the registry chain never imports artifacts.ts), replace the literal BUILD_REVIEW_RUBRIC_NAMES = ['testQuality'] with that tuple, and replace the one-member BuildReviewRubric interface with Record<BuildReviewRubricId, boolean> so the type and the runtime list cannot diverge; the flag/findings loops at :2283-2325 and the failedRubrics compatibility mapping at :2425-2432 then cover security without a second list. Add a failing-first test in src/conductor/test/engine/artifacts.test.ts: validateBuildReviewVerdict accepts verdict FAIL with rubric { testQuality: false, security: true } and findings.security non-empty, rejects it when findings omits security, and buildReviewFailureDetails emits the '[security] ...' detail lines; also assert an aggregate-derived security-only FAIL passes the validator that conductor.ts:11042 gates adjudication on. Keep every existing testQuality validator and failure-detail assertion (Task 4) unchanged.
**Gate:** as-built
**Rationale:** src/conductor/src/engine/artifacts.ts:2198 still declares BUILD_REVIEW_RUBRIC_NAMES = ['testQuality'] (and its matched pair, the BuildReviewRubric interface at :2166), so validateBuildReviewVerdict at :2313-2325 rejects a security-only FAIL as 'FAIL requires at least one rubric flag to be true' before Conductor's validator gate at conductor.ts:11042-11043 can enter the adjudication path at :11083-11158; the approved architecture already requires this flow (adr-2026-08-21-review-bound-by-plan-done-when-criteria D3 and plan Task 10, .docs/plans/grade-the-diff-for-security-defects-before-ship-vi.md:224-238), so it is conforming implementation drift with a determinable fix, not an architecture decision. Matched pair named and brought along: the BuildReviewRubric interface and BUILD_REVIEW_RUBRIC_NAMES are both derived from the one registry authority BUILD_REVIEW_RUBRIC_IDS (build-review-registry.ts:19), which build-review-aggregate.ts already uses via RUBRICS, so the two cannot drift again; BuildReviewFindings at :2176 is a mapped type over the interface and follows automatically. Sibling sweep: the failedRubrics compatibility path at artifacts.ts:2425-2432 reads the same constant and is fixed by the same derivation; build-review-aggregate.ts:66,151 keep their deliberate 'testQuality' construction-compatibility and unregistered-rubric fault slot and are found-and-excluded because no plan task admits changing them and the aggregate already joins every registry member at :334-361; no other production site reads verdict.rubric.testQuality. No coverage is removed: Task 4's existing testQuality verdict-validation and buildReviewFailureDetails assertions must stay green unchanged, with security added alongside.
**Governing clause:** adr-2026-08-21-review-bound-by-plan-done-when-criteria D3
**Done when:**
- adr-2026-08-21-review-bound-by-plan-done-when-criteria D3 is satisfied by this task.
- Re-run as-built and confirm task rem-as-built-rem-ab1-1 is complete.

### Task rem-as-built-rem-ab2-1: src/conductor/src/engine/build-review-cli.ts:86 and src/conductor/src/engine/build-review-dispositions.ts:129 — replace both literal one-member sets (BUILD_REVIEW_RUBRICS and REDUCED_COVERAGE_RUBRICS) with the registry authority, using isRegisteredRubric/BUILD_REVIEW_RUBRIC_IDS from './build-review-registry.js' so the CLI predicate at :425-438 and parseReducedCoverageIdentity at :201-207 accept every registered rubric from one source and cannot drift apart. Add failing-first tests in src/conductor/test/engine/build-review-cli.test.ts and src/conductor/test/engine/build-review-dispositions.test.ts: `build-review record-reduced-coverage --rubric security` against an aggregate whose security result is an infrastructure-failure is accepted and writes a reduced-coverage record, the exact command string rendered by conductor.ts:1803-1807 for a security fault is the one accepted, a genuinely unregistered rubric id is still refused 'unknown-rubric', and the stored security identity round-trips through parseReducedCoverageIdentity. Keep the existing testQuality acceptance and unknown-rubric refusal assertions unchanged.
**Gate:** as-built
**Rationale:** conductor.ts:1790-1807 renders the terminal mechanical-fault recovery command from the aggregate's actual failing rubric (so it emits `--rubric security`), but build-review-cli.ts:86 gates the command on BUILD_REVIEW_RUBRICS = new Set(['testQuality']) and refuses it 'unknown-rubric' at :425-438, and build-review-dispositions.ts:129 repeats the same one-member set in REDUCED_COVERAGE_RUBRICS so parseReducedCoverageIdentity at :201-207 could not read the record either; plan Task 1 Done-when already forbids a third literal copy of the rubric id list under src/conductor/src (.docs/plans/grade-the-diff-for-security-defects-before-ship-vi.md:47-50), so this is conforming implementation drift with a determinable fix and no architectural question. Matched pair named and brought along in the same task: the CLI predicate and the disposition-store predicate are two lists that must agree, and both are derived from BUILD_REVIEW_RUBRIC_IDS (build-review-registry.ts:19) rather than fixed separately. Sibling sweep: isRegisteredRubric already exists on that authority and is reused; build-review-cache.ts:117 is the remaining literal pair but it enumerates both ids and is already security-correct, named here as found-and-excluded because widening it is not required to close this finding and no plan task admits reworking the cache parser. No coverage is removed: the existing testQuality reduced-coverage CLI and store tests remain green, with security cases added.
**Parent task:** 1
**Governing clause:** Task 1
**Done when:**
- Task 1 is satisfied by this task.
- Re-run as-built and confirm task rem-as-built-rem-ab2-1 is complete.

> **Amended 2026-09-17 by operator (as-built AB-2 resolution):** Story 5 criterion 1 requires the vocabulary integrity check to execute the engine parser against each declared member, but approved Task 13 delivered only the exported-vocabulary list comparison. The operator kept the sealed criterion and authorized Task 15 to add the parser execution; Task 13's delivered drift comparison stays as-is.

### Task 15: Execute the concern-kind parser against every documented vocabulary member in the integrity guard
**Story:** 5
**Type:** negative-path

**Steps:**
1. Write the failing check first: in the probe script embedded in `test/check_build_review_rubric_skill_vocabularies.sh`, import `parseBuildReviewFindingConcernKind` from the domain module (fail the probe naming the export when absent) and, for each rubric in `RUBRICS`, emit `"<rubric> parses <member>"` for every member of that rubric's `concernKinds` that the parser returns unchanged and `"<rubric> !unparsed <member>"` for any it rejects.
2. In `check_vocabulary_drift`, after the list comparison, run every member from the skill's documented `**Closed vocabulary:**` line through the probe's parser output: a documented member with no `"<rubric> parses <member>"` line, or any `!unparsed` line, fails naming the rubric and the member.
3. Add a drift fixture in the script's fixture block proving that a domain module whose parser rejects one declared member (for example a normalizer that lowercases a member the vocabulary lists in another case) fails naming `security` and that member, while the unmodified domain passes for both `testQuality` and `security`.
4. Run `bash test/check_build_review_rubric_skill_vocabularies.sh` and `bash test/test_harness_integrity.sh` and observe RED then GREEN.
5. Commit with message: `test(integrity): execute the concern-kind parser per documented vocabulary member`.

**Done when:**
- `test/check_build_review_rubric_skill_vocabularies.sh` executes `parseBuildReviewFindingConcernKind` against every documented `**Closed vocabulary:**` member for both `testQuality` and `security` and passes on the committed skill and domain files.
- A fixture in which the parser rejects one declared `security` member makes the check exit non-zero naming `security` and that member, as asserted by the script's own fixture run.
- The existing list-comparison drift fixtures from Task 13 still fail naming the rubric and the drifted member.

**Files:** `test/check_build_review_rubric_skill_vocabularies.sh`

**Dependencies:** Task 13
