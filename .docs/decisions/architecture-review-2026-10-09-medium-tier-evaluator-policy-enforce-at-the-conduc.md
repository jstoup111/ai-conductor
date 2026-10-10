# Architecture Review: build_review implementation-quality rubric (#475)
**Date:** 2026-10-09
**Mode:** Lightweight (Tier M): §2 Technical Feasibility and §4 Architectural Alignment
**Input:** `.docs/track/medium-tier-evaluator-policy-enforce-at-the-conduc.md` (technical track; stories not yet written),
`.docs/complexity/medium-tier-evaluator-policy-enforce-at-the-conduc.md`,
`.docs/architecture/medium-tier-evaluator-policy-enforce-at-the-conduc.md` (approved)
**Verdict:** APPROVED WITH CONDITIONS

## Summary

The engine gets a third built-in `build_review` rubric, `implementationQuality`, which is enabled by
default. It judges code quality (duplication, complexity, readability) and domain modelling (primitive
obsession, representable invalid states, non-exhaustive domain matching, non-semantic naming) over the
feature diff. These are the `/pipeline` batch evaluator's review dimensions that no gate owns.

The review first ran BLOCKED. The original intent also had the rubric grade acceptance-criteria
compliance. That conflicts with APPROVED `adr-2026-08-22-one-owner-per-review-question` D1:
`prd_audit` owns acceptance criteria as the completion authority, and the BUILD-time `completeness`
rubric that judged the same question was retired because peer judges deadlocked (#1630, #1765).

The operator chose to drop the acceptance-criteria dimension (2026-10-09). The track, complexity,
and diagram artifacts were narrowed in place. Follow-on intake #3056 received a correcting comment.

## Feasibility

| Check | Assessment |
|---|---|
| Stack compatibility | No new dependency. The rubric is a registry member, a projection, a closed vocabulary, a judged-result schema, and a skill, following `security` (#2568, commit `54bd23936c`). Verified: 95%. |
| Prerequisites | None. `DEFAULT_RUBRIC_ENABLED` (`resolved-config.ts`) is a per-rubric map, so a default of `true` for one member is a value change, not a schema change. Verified. |
| Integration surface | One subsystem, `build_review`: the registry, domain parsing, projections, resolved config, the step-runner prompt maps, the aggregate default, adjudication context, finding identity, cache, CLI, dispositions, the model-table row, and the vocabulary integrity check. `build-review-policy-claude.ts` and `build-review-policy-codex.ts` carry no per-rubric routing, so they do not change. Verified by inventory: 85%. |
| Data implications | No persisted schema migration. `.pipeline/build-review.json` gains a rubric member, and the existing verdict rubric map in `artifacts.ts` admits registered ids. The config key `rubrics.implementationQuality` is new and optional. Config schema is a canonical breaking surface, so the PR carries a migration block or an internal-only waiver (CLAUDE.md release gates). |
| Performance risk | Default-on adds one provider dispatch per `build_review` lap to every consumer build. Today a default build makes no dispatch. Content-addressed caching avoids re-judging an unchanged projection. The cumulative convergence caps (`MAX_CUMULATIVE_KICKBACKS_BUILD_REVIEW=5`, `KICKBACK_LEDGER_MAX_PER_GATE=2`) bound the retries. |
| Worktree isolation | No ports, databases, or shared state. Per-worktree `.pipeline/`. |

## Alignment

- **The one-owner map (`adr-2026-08-22-one-owner-per-review-question` D1):** the map gains two
  questions, code-quality defects and domain-modelling defects, owned by the new rubric (amendment
  added in this spec). The rubric may fail a lap and route through the shared adjudicator. It never
  appends a plan task and never routes to `plan`. Its findings reach BUILD only as `act` tasks that
  cite admitted plan task ids, enforced by the case-v2 admission validator in
  `remediation-case-validator.ts`. Otherwise they are deferred to intake or refuted. The rubric
  carries no plan, stories, or ADR context. This is deliberate, so it cannot drift into
  `prd_audit`'s or the as-built review's questions.
- **The rubric container (`adr-2026-08-22-build-review-opt-in-rubric-container`):** decision 1 is
  amended for the third member and its default-on value, which departs from the member-is-default-off
  pattern. The operator explicitly authorized that departure: #3056 retires the batch evaluators, and
  default-off would leave these questions with no reviewer. Decision 4 is amended so the member
  reuses the preserved contracts: the engine-stamped judged envelope, the content-region `locus`
  anchor, stable identity and dispositions, the mechanical-fault lane, and the cache key, which
  resolves the new `SKILL.md`.
- **Closed vocabularies (`adr-2026-08-16-closed-build-review-finding-vocabularies`):** the rubric gets
  its own closed `concernKind` set. The CI guard `test/check_build_review_rubric_skill_vocabularies.sh`
  binds the skill text to the engine set in both directions.
- **Reference schema (`adr-2026-08-18-content-anchored-finding-reference-schema`):** anchors are
  content-region references over the changed content regions, as for `security`. Line numbers are
  forbidden.
- **Per-child build region (`adr-2026-10-07-per-child-build-region`, #3050 landed and not yet built):**
  the container ADR's #2942 amendment makes every rubric grade each child's diff, except `security`.
  `implementationQuality` takes that default with no leaf-only exception. Under the flat loop, one
  snapshot serves all rubrics. Neither landing order needs a special case.
- **Declared pattern replication (`adr-2026-08-09-declared-pattern-replication-in-build` D5):**
  conflict-check found that a diff-only grader would flag a declared `Pattern-source:` copy as
  `duplication`, and a repair would then undo the planned copy. Resolution (operator, 2026-10-09):
  after judging, the engine suppresses and records `duplication` findings anchored in a declared target
  whose evidence names only the declared source. The projection stays diff-only. D5 carries a
  #475 amendment.
- **Done-when binding (`adr-2026-08-21-review-bound-by-plan-done-when-criteria` D3):** amended by
  #475 on the same terms as #2034's `security` amendment. Implementation-quality findings are never
  graded `beyond`.
- **Event spine:** no new event kind. The existing rubric-branch and verdict events carry the new
  rubric id.
- **Focused local pattern basis: the `security` rubric member.**
  - *Role:* a built-in rubric with no preflight and a common-fields-only projection.
  - *Traits to preserve:* the projection is `common(source, id)`; content-region `locus` anchors
    match the changed content regions; findings carry no test evidence fields; skip reasons are
    limited to `disabled`.
  - *Why it applies:* it is the only built-in that judges production code rather than tests.
  - *Allowed variation:* a different vocabulary, a different default (`true`), and per-child rather
    than leaf-only placement.
  - *Rediscovery hints:* the `security` entry in `BUILD_REVIEW_RUBRIC_CATALOG`
    (`build-review-registry.ts`), `deriveBuildReviewRubricProjections` (`build-review-projections.ts`),
    `BUILD_REVIEW_FINDING_VOCABULARIES` and `BUILD_REVIEW_JUDGED_V3_SCHEMAS`
    (`build-review-domain.ts`), `skills/build-review-security/`.
- **Scope check:** the change is consumer-facing, because `build_review` runs in every consumer
  install. So the new skill belongs in the shipped `skills/` catalog, with an `agents/openai.yaml`
  for Codex parity like `build-review-security`. It is provider-agnostic: rubric dispatch is
  engine-managed through the provider-neutral policy.
- **Overlap with the TDD domain reviewer:** the per-cycle TDD domain reviewer asks similar
  domain-modelling questions inside BUILD. It is an implementation aid, not a gate, and it does not
  appear in the one-owner map, so this is not a peer-judge conflict.

## Wiring Surface

| New surface | Production caller |
|---|---|
| `implementationQuality` entry in `BUILD_REVIEW_RUBRIC_IDS` and the rubric catalog | Read by the existing `resolveBuildReviewConfig` effective catalog and `classifyBuildReviewRubricBranches` in the `build_review` step runner |
| `DEFAULT_RUBRIC_ENABLED.implementationQuality = true` | The existing `resolveBuildReviewConfig` in `resolved-config.ts`, called by the `build_review` step |
| The projection member in `deriveBuildReviewRubricProjections` | The registry descriptor's `projection.build`, called by the existing rubric coordinator |
| The closed vocabulary and judged-v3 schema | The existing `parseBuildReviewJudgedResult` and branch validation in the coordinator |
| `skills/build-review-implementation-quality/SKILL.md` and `agents/openai.yaml` | Dispatched by the existing coordinator via the descriptor's `skillName`; its digest enters the cache key |
| Config key `build_review.rubrics.implementationQuality` | Parsed by the existing per-rubric config path (`BuildReviewRubricsConfig` derives from the registry ids) |
| Model-table row | The existing `bin/generate-model-table` from `model-table-metadata.ts` |

Advisory overlap scan (`ai-conductor overlap-scan`) found that `resolved-config.ts` is also touched
by `origin/spec/daemon-self-host-guardrails`. This is non-blocking. Conflict-check should look at it.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Subjective quality findings cycle across laps (the canonical `build_review` cycling class) | Technical | Medium | High | Shared adjudicator with stable finding identity, dispositions, and refute; cumulative and per-gate kickback caps; `min_confidence` suppression; a closed vocabulary that limits findings to concrete, anchorable defects, with no style preferences |
| Default-on adds provider cost and latency to every consumer build | Performance | High | Medium | Content-addressed cache; per-rubric low effort default like the existing rubrics (#2628); `enabled: false` opt-out documented |
| A finding demands a mechanism the plan does not authorize | Technical | Low | High | Case-v2 admission: an `act` task must cite admitted plan tasks, otherwise it is deferred to intake; the never-appends-tasks rule in the one-owner amendment |
| A consumer repo gets a blocking gate it never configured | Integration | High | Medium | Release note plus a migration or waiver note; the PR documents the opt-out key |
| Drift between skill text and the engine vocabulary | Technical | Low | Medium | The existing bidirectional vocabulary CI guard |

## ADRs Created

None. The structural prerequisite is not met: this adds a registry member under an existing container
design, so no new boundary, decomposition, or integration pattern is decided. This follows the
`security` precedent (#2034), which also amended rather than created. The governing ADRs, both
APPROVED and both amended in this spec:

- `adr-2026-08-22-build-review-opt-in-rubric-container`: decision 1 (third member, default-on) and
  decision 4 (contracts reused)
- `adr-2026-08-22-one-owner-per-review-question`: D1 map gains the code-quality and domain-modelling
  questions

## Conditions

1. The rubric judges no acceptance-criteria compliance and no ADR conformance. Its projection
   carries only the common fields: no plan body, stories, or ADRs.
2. Stories must include a negative-path criterion showing that a project with
   `rubrics.implementationQuality.enabled: false` (and the other two rubrics left at their defaults)
   gets the `build_review_no_rubrics` no-dispatch PASS.
3. The closed vocabulary admits only concrete, anchorable defects. A finding must cite a
   content-region `locus` in the changed regions. Pure style preferences are not a `concernKind`.
4. The PR carries a migration block, or a waiver if the classifier flags a surface that is
   internal-only, and a release note that names the new default and the opt-out key.
5. Retiring the pipeline evaluators stays out of scope (#3056).
