# Architecture Review: Grade the diff for security defects before ship via a build_review security rubric (#2034)

**Date:** 2026-09-14
**Tier:** Medium (lightweight review)
**Technical intent reviewed:** `.docs/track/grade-the-diff-for-security-defects-before-ship-vi.md`, `.docs/complexity/grade-the-diff-for-security-defects-before-ship-vi.md`, and issue jstoup111/ai-conductor#2034
**Stories reviewed:** Not yet authored; review precedes stories on the technical track.
**Diagram reviewed:** `.docs/architecture/grade-the-diff-for-security-defects-before-ship-vi.md`
**Verdict:** APPROVED

## Feasibility

The rubric joins the existing engine-managed `build_review` container; every runtime seam it needs already exists and was read directly.

- **Verified registry seam (100%):** `build-review-registry.ts` exposes `BUILD_REVIEW_RUBRIC_IDS` as a closed tuple and `BUILD_REVIEW_RUBRIC_REGISTRY` as a frozen descriptor map. Adding `security` is a second entry with `skillName: 'build-review-security'`, contract `v3`, projection `v3`, `cachePolicy: 'content-addressed'`, `prerequisite: 'none'`.
- **Verified projection seam (100%):** `build-review-projections.ts` derives `changedFiles` by reference from the frozen whole-branch diff (`git diff <mergeBase>..<frozen HEAD>` in `build-review-inputs.ts`). `BuildReviewRubricProjection` is a one-member type alias and `common()` hardcodes the `testQuality` descriptor; both widen to a union with a `SecurityProjection` that carries only the common fields. No test-scope, preflight, or counterfactual field is needed.
- **Verified result seam (100%):** the provider returns only `findings`; `stampBuildReviewDispatchedCandidate` rebuilds the envelope from the projection. `BUILD_REVIEW_FINDING_VOCABULARIES` and `BuildReviewFindingAnchor` are keyed by rubric id and gain a `security` entry with a closed `concernKind` set and a `content-region` `locus` anchor whose `contentHash` is `sha256` of the normalized hunk content (the rootCause precedent in adr-2026-08-18).
- **Verified aggregate and adjudicator seam (100%):** `joinBuildReviewRubricOutcomes` keys results by rubric id; `projectBuildReviewAggregateSources` emits every judged finding with a canonicalizable anchor as a raw source for the existing `remediate` case-v1 judge. No second judge is introduced.
- **Verified no `beyond` machinery in code (100%):** `boundTo`, `beyondFindingIds`, and `build_review_beyond_filed` do not occur anywhere under `src/conductor/src`. adr-2026-08-22-build-review-opt-in-rubric-container decision 4 retains the record kind "as data for #1810, never produced by this rubric". The plan-binding exemption for security is therefore a contract statement (ADR amendment plus skill text), not an engine change.
- **Verified config seam (100%):** `config.ts` keeps a local `BUILD_REVIEW_RUBRIC_IDS`, `validateBuildReviewRubrics` rejects unknown ids, and every registered rubric is materialized `enabled: false` unless set. `resolved-config.ts` carries `DEFAULT_RUBRIC_ENABLED` and `DEFAULT_RUBRIC_EFFORT` maps. `security` is added default-off, effort `high`.
- **Verified registration obligations (100%):** `test/check_build_review_rubric_skill_vocabularies.sh` hardcodes a `RUBRICS` table and two `for rubric in testQuality` loops; `model-table-metadata.ts` `AUXILIARY_MODEL_TABLE_ROWS` renders `ARCHITECTURE.md`'s generated table; `docs/reference/skills.md` carries counts and the explicit-only list; `step-runners.ts` holds a per-rubric `label` map. All are additive edits in the same change.
- **Stack compatibility:** no new dependency, service, store, event kind, lifecycle step, or consumer config key. Worktree isolation is unchanged: the grader reads the feature worktree as today.

## Alignment

- **Container ADR (adr-2026-08-22-build-review-opt-in-rubric-container) decision 1:** membership is the registry and each member is opt-in. `security` follows exactly; its Context names security as the intended next member. Amended in this change to record the second built-in member.
- **One owner per review question (adr-2026-08-22-one-owner-per-review-question) decision 1:** the map gains one question — *Does the diff introduce a security defect?* — owned by the `security` rubric. The incidental security bullets in `skills/code-review/SKILL.md` are removed so no peer judge shares the substance (the #1630/#1765 deadlock class the ADR exists to prevent). The appender clause is untouched: the rubric never appends a task and never routes to `plan`.
- **Plan-binding (adr-2026-08-21-review-bound-by-plan-done-when-criteria) decisions 3 and 6:** amended so the `security` rubric is exempt — its findings are never `beyond`; they enter the adjudicator, which may `act` (a bounded retry work order under the existing kickback cap), `defer` to intake, or `refute`. Operator-approved 2026-09-14; the alternative (advisory-only) does not meet #2034's outcome.
- **Closed vocabularies (adr-2026-08-16) decision 1 and 5:** a corpus-shaped closed `concernKind` set with no `other`; the CI guard binds skill text to the engine set in both directions. Amended with the security row.
- **Reference schema (adr-2026-08-18):** `security.locus` binds to the existing `content-region` kind (hunk content). No fourth kind; amended with the binding row only.
- **Engine-stamped envelope (adr-2026-08-19), engine identity in the cache key (adr-2026-08-21), mechanical-fault lane (adr-2026-08-18), cumulative bound (adr-2026-08-12):** reused unchanged. A second rubric shares the existing cap of 5; the bound remains deterministic.
- **#2020 and #1986:** #2034 is recorded as the decision adding `security` to the built-in catalog; #2020's general blocking-authority question stays open. The #1986 `custom_rubrics` seam is project-declared only and is not used; when it lands, a lap with any enabled custom member binds `security` to the frozen read-only source view like every other member (adr-2026-09-10 D5), which needs nothing from this feature.
- **Adjacent authorities left alone:** `/assess`'s `cto-security` auditor stays repo-wide and advisory; `skills/pipeline/SKILL.md`'s prose security bullets are unenforced and out of scope; containment advisories stay out of build_review input (#2428).
- **Diagram:** the new sequence diagram reflects this boundary; no container or component diagram changes.

**Focused local pattern basis.** `skills/build-review-test-quality/SKILL.md` is the exemplar for the new skill's shape: frontmatter with `disable-model-invocation: true`, a closed input projection section, a judgement section, a result contract that returns only `findings`, the machine-checked `**Closed vocabulary:**` and `**Reference grammar:**` marker lines, and a verification checklist. Traits to preserve: judgement-only contract, engine-stamped envelope, worktree reads as part of the closed input, one finding per independent defect, integer `confidence`. Allowed variation: no `scopeResolutions` (return `[]` is not required — the security contract omits the field), no `counterfactualSensitivity`, and a multi-member vocabulary. Rediscovery hints: `skills/build-review-test-quality/SKILL.md`, `renderBuildReviewProviderPayloadShape` and `BUILD_REVIEW_FINDING_VOCABULARIES` in `build-review-domain.ts`.

## Wiring Surface

- **`security` registry descriptor** — read by `classifyBuildReviewRubricBranches` and `coordinateBuildReviewRubrics` in `build-review-coordinator.ts`, dispatched by `runRubricBuildReview` in `step-runners.ts` through the existing `executeAuxiliaryProviderCandidates` path.
- **`SecurityProjection`** — produced by `deriveBuildReviewRubricProjections` in `build-review-projections.ts` from the frozen snapshot and consumed by the dispatch prompt and the content-addressed cache key.
- **`security` finding vocabulary and anchor grammar** — consumed by `renderBuildReviewProviderPayloadShape`, `validateBuildReviewDispatchedResult`, `parseBuildReviewFindingAnchor`, and `canonicalizeBuildReviewFindingIdentity`; bound to the skill text by `test/check_build_review_rubric_skill_vocabularies.sh` (integrity check 25).
- **`build_review.rubrics.security` config key** — validated by `validateBuildReviewRubrics`, defaulted by `resolveBuildReviewConfig`, declared in the `config.ts` consumer registry under the existing `build_review.rubrics` entry; documented in `docs/reference/configuration.md` and `docs/explanation/gates.md`.
- **`skills/build-review-security/SKILL.md`** — resolved by `resolveBuildReviewEngineIdentity` for the cache digest and rendered by `renderAuxiliarySkillInvocation` for both hosts; registered in `model-table-metadata.ts` and `docs/reference/skills.md`.
- **`skills/code-review/SKILL.md`** — the security bullets are removed; no engine consumer reads them.
- **This repository's `.ai-conductor/config.yml`** — enables `security` for self-host builds (repo-only half of the change, split per scope-check).

**Scope check.** A: consumer-facing — the build_review container and its config keys exist in every installed project; the self-host enablement is the split repo-only half. B: `skills/` — a build-phase lifecycle capability the engine dispatches in any project. C: agnostic — the engine renders the host-specific skill invocation; the skill text is provider-neutral.

**Early overlap scan.** `ai-conductor overlap-scan` over the wiring-surface paths on 2026-09-14: no overlap detected, no open blockers.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---:|---:|---|
| False-positive security findings cost kickback laps and operator overrides, which is the failure #2034 names as unacceptable. | Technical | Medium | High | Closed vocabulary with per-member definitions and explicit non-findings; integer `confidence` on every finding with the existing `min_confidence` floor; `refute` terminal via the adjudicator; default-off so a project opts in deliberately. |
| A whole-diff grader on a large feature exceeds the provider window or times out. | Performance | Low | Medium | The diff is projected by reference; the grader reads hunks per path. Existing `max_retries`, fallback ladder, and mechanical-fault lane bound the failure. |
| Two rubrics spend the shared cumulative cap of 5 faster. | Integration | Medium | Medium | Bound unchanged and deterministic; the adjudicator merges overlapping substance; per-rubric enablement lets an operator disable one. |
| A security finding whose locus is an unchanged line has no hunk to anchor to. | Data | Medium | Medium | The rubric anchors to the changed hunk that introduces the exposure and cites the unchanged location in `evidenceLocations`; an anchor outside `changedFiles` is rejected by the validator and repaired once, as today. |
| The integrity vocabulary guard is not extended and silently skips the new rubric. | Technical | Medium | Low | The guard's `RUBRICS` table and loops are named as in-scope files; a story criterion requires the guard to fail on a vocabulary drift for `security`. |

## ADRs Created

None. Every structural decision is already governed; the following approved ADRs are amended in place in this change, each with an additive `> **Amended 2026-09-14 by #2034:**` note:

- `adr-2026-08-22-build-review-opt-in-rubric-container` decision 1 and decision 4 — second built-in member, default-off, specialized contract.
- `adr-2026-08-22-one-owner-per-review-question` decision 1 — the map gains the security question and owner.
- `adr-2026-08-21-review-bound-by-plan-done-when-criteria` decision 3 and decision 6 — the `security` rubric is exempt from plan-binding.
- `adr-2026-08-16-closed-build-review-finding-vocabularies` decision 1 — the security vocabulary row.
- `adr-2026-08-18-content-anchored-finding-reference-schema` — the security anchor binding.

## Conditions

None.

## Blocking Issues

None. All load-bearing claims were verified against the current registry, projections, domain, aggregate, coordinator, config, resolved-config, integrity script, and model-table metadata.
