# Architecture Review: build_review re-raises already-decided findings every lap and never converges

**Date:** 2026-10-24
**Mode:** full pre-stories review (Tier L, technical track)
**Inputs reviewed:**
- the explore output and operator-confirmed scope in
  `.docs/track/build-review-re-raises-already-decided-findings-ev.md`;
- `.docs/complexity/build-review-re-raises-already-decided-findings-ev.md`;
- the component and sequence diagrams under `.docs/architecture/`;
- source on main at `bc44c95a27`;
- the governing ADRs listed under Alignment.

**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

Every technical-intent item can be built on the current stack, with no new package, service or
external dependency.

- **Per-lap scope record.** Feasible.
  - Branch artifacts persist per lap and are never pruned (A4). The lap's merge base and head are
    available in `sourceSnapshot` when the record is written.
  - The aggregate holds no merge base, and `build_review_base` is not persisted. That is why the
    record must carry the merge base itself.
- **Settled set.** Feasible as a pure function over existing records:
  - prior branch artifacts, whose findings have ids that can be recomputed;
  - `finalizedBuildReviewSourceIds`;
  - the dispositions store;
  - the current confidence and severity thresholds.

  No lap ordering is needed (verified: none exists durably).
- **Scope decision placement.** In `runRubricBuildReviewInner`, after the lap id is created and
  before `coordinateBuildReviewRubrics` derives projections. The coordinator already accepts
  projection overrides (`input.projections`).
- **Rebase cause.** It is readable at lap time (`.pipeline/gates/build_review.json`), but it was
  rejected as the gate (A3). The merge-base comparison needs only the D1 record.
- **No re-key.** Finding identity excludes extra fields (A2). The provider schema is closed
  (`additionalProperties: false`), so it and `finding()` must both be extended. The custom parser
  is closed by exact key set, so `customFinding`'s optional keys must also be extended.
- **Hunk mapping.** Custom `sourceRegions` and testQuality regions carry line ranges.
  `ChangedFileReference` hunks carry `newStart` and `newCount`. The intersection is computable from
  the frozen diff alone.
- **Repair provenance.** The predecessor lap's branch artifacts list its finding ids, and
  `currentBuildReviewSourceLinks` maps a source id to its case. The join is mechanical. Commits are
  deliberately not used, because `Task:` trailers are telemetry only (#773).
- **Judge digests.** The context has a hard 256 KiB cap (`maxSerializedBytes`) and per-text caps.
  The D8 budget is sized inside it (A7).

Prerequisites: none. #3271, #3292, #3124, #3298 and #3291 have all shipped.

## Complexity

**High.**
- Five engine seams change:
  - runner;
  - projections;
  - domain parsing;
  - both effective reducers;
  - adjudication context and coordinator.
- Four skill contracts change, and the event union grows.
- No split: the operator chose one spec with stacked delivery on 2026-10-24. An estimated 18 to 22
  plan tasks means the plan may need a `**Scope-exception:**` that cites that decision.

## Alignment

- **`adr-2026-08-13-engine-managed-build-review-rubric-branches` §2 (amended).** The snapshot still
  excludes prior grader prose and dispositions. The new `reviewScope` is a D2.1 reference identity
  in the digest, so §7's cache invalidates mechanically and §7 needs no amendment.
- **`adr-2026-08-29-build-review-remediate-case-adjudication` D1 (unchanged).** Rubrics still
  receive neither sibling findings nor case history. The rejected "give every rubric prior history"
  alternative stays rejected, because the rubric receives a computed scope, not history. Not
  amended.
- **`adr-2026-08-13-stable-build-review-finding-dispositions` §2 (amended).** The store is still
  never grader input. It now also informs the pre-projection scope decision.
- **`adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication` D2 and D5 (amended).**
  - D5.1 exact-id equivalence is preserved. Out-of-delta is a scope rule, not an equivalence.
  - D5.8's owner gains repair provenance.
  - D2's context gains bounded digests.
- **`adr-2026-10-19-build-review-finding-severity-advisory-threshold` D4 (amended).** `outOfDelta`
  joins the reducer order and follows the advisory rules.
- **`adr-2026-08-21-review-bound-by-plan-done-when-criteria` Option C.** The deferred lap-monotonic
  engine is adopted, but narrowed. The engine computes the inter-lap scope, and rubrics do not get
  prior findings as input. That keeps the "more ways to suppress a genuine regression" concern
  bounded: any changed hunk, and any hunk with an unfinalized finding, stays in scope.
- **Precedent:** `adr-2026-10-10-source-grounded-adversarial-plan-review-step` D6.
  - **Role:** a bounded later round re-checks only what changed.
  - **Trait preserved:** later rounds use digest identity to select changed material.
  - **Variation:** here the unit is a diff hunk, not a plan task, and there is no hard round limit
    because the lineage and cumulative caps bound it.
  - **Hint:** `planTaskDigests` in the plan-review primitive.
- **CLAUDE.md design principle.** The machinery does the bookkeeping:
  - scope and record;
  - hunk mapping;
  - the membership check;
  - provenance;
  - budgets.

  Judgement stays at the two points that need it: the reviewer's causal claim, and the judge's
  binding or `distinctFrom`. Both are constrained by schema.
- **Event spine.** `reviewScope` is exception C state. The decision and the counts ride the bus.
  No new channel (ADR Event-Spine Verdict).
- **Worktree isolation.** All state is under the worktree's `.pipeline/`. No shared resource is
  added.
- **Production DI defaults.** No in-memory store is introduced. The frontier is pure over
  filesystem records.

## Domain Integrity

- **`reviewScope.mode` and `reason`** are closed unions, not booleans.
- **Exhaustive matching.** `scope-empty` extends the existing closed provenance union, and every
  `switch` over provenance must match it exhaustively.
- **`outOfDelta`** is a named effective class, not a flag on `advisory`. The two have different
  authority: scope versus operator threshold.
- **Hunk identity** is a semantic `ReviewedHunk { path, contentHash }`, shared by the frontier,
  the artifact and `causeHunk`, rather than parallel string pairs.
- **The mapping result** is a closed union: hunks, or file-level. It is never an empty array with
  an implicit meaning.

## Wiring Surface

| New or changed surface | Production caller |
|---|---|
| `build-review-review-frontier.ts` (settled set, scope decision, hunk mapping, provenance candidates) | `runRubricBuildReviewInner` in `step-runners.ts`, before `coordinateBuildReviewRubrics`. The adjudication coordinator calls the provenance helper |
| `reviewScope` field on `BuildReviewBranchArtifact` (`build-review-artifacts.ts`) | written by the existing branch-artifact writers on the fresh, cache-hit and new `scope-empty` paths. The frontier reads it on the next lap |
| `scope-empty` branch outcome | the coordinator's per-rubric dispatch branch, beside cache-hit. It is announced through the existing `build_review_rubric_skipped` event with reason `scope-empty` |
| projection v5 `reviewScope` (`build-review-projections.ts` `common()`, custom input builder) | the existing `deriveBuildReviewRubricProjections` / descriptor `projection.build` call in the coordinator |
| optional `causeHunk` (v4 schema, `finding()`, `customFinding`) | the existing judged-result parsers on every dispatch |
| `outOfDelta` class (`build-review-aggregate.ts` `deriveEffectiveBuildReviewVerdict`, `build-review-effective.ts`) | the existing effective-verdict resolver in `step-runners.ts` and the conductor's outcome path |
| provenance `recurrenceOf` stamping | the existing pre-reconcile lineage check in `build-review-adjudication-coordinator.ts` |
| prior-source `finding` digests (`build-review-adjudication-context.ts`) | the existing context builder used by the remediate dispatch in `conductor.ts` |
| `build_review_review_scope` event and `outOfDeltaCount` | emitted by the runner and by `emitBuildReviewOuterVerdict`, registered in `event-sinks.ts` (persist) |
| skill text: `skills/build-review-*/SKILL.md`, the custom rubric prompt, `skills/remediate/SKILL.md` | loaded by the existing rubric and remediate dispatch |

**Overlap scan (advisory):**
- `src/conductor/src/types/events.ts` overlaps `spec/daemon-repair-queue-and-maintenance-events-admit-i`.
- `step-runners.ts` overlaps `spec/untracked-root-node-modules-symlink-gets-committed`.

Both are shared hot files with no seam conflict. In-flight #3389 changes only `baseKind` in
`build-review-inputs.ts`, which this design does not edit. Its revalidation laps change the merge
base and are therefore correctly full laps.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| A defect in unchanged code exposed by a change elsewhere is classified out of delta | Technical | Medium | High | The reviewer can name the delta cause hunk. Out-of-delta findings are durable and counted, and any merge-base change forces a full lap. |
| Path-level provenance over-attributes, so unrelated defects share a lineage and halt sooner | Technical | Medium | Medium | Opt out with the judge's `distinctFrom` plus a reason (#3124). The lineage halt is operator-recoverable. |
| A reviewer cites an arbitrary delta hunk to keep a stale finding blocking | Technical | Low | Medium | The lineage and cumulative caps still bound it, and the cause is visible in the finding. |
| Hunk merging (adjacent edits fuse hunks) re-keys a settled hunk | Technical | Medium | Low | Fails toward more review, and a clean lap re-settles it. |
| Prior-digest growth pressures the 256 KiB context | Performance | Low | Medium | Fixed 64 KiB budget, oldest-first drop, counted omission. |
| Parallel amendments with open spec PR #2878 | Integration | Medium | Medium | Overlap noted on #1810 on 2026-10-24. The second spec to merge reconciles. |
| A projection v5 change invalidates every cached verdict once | Performance | High | Low | One-time miss at upgrade. |

## ADRs Created

- `adr-2026-10-24-lap-monotonic-build-review-scope` (APPROVED by operator 2026-10-24).
- Amendment notes, additive only, on:
  - `adr-2026-08-13-engine-managed-build-review-rubric-branches` §2, §6, §7 and §8;
  - `adr-2026-08-13-stable-build-review-finding-dispositions` §2;
  - `adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication` D2, D4 and D5;
  - `adr-2026-10-19-build-review-finding-severity-advisory-threshold` D3 and D4;
  - `adr-2026-08-29-build-review-remediate-case-adjudication` D5;
  - `adr-2026-10-20-operator-acceptance-is-durable-case-state` decision 5;
  - `adr-2026-08-22-one-owner-per-review-question` D1;
  - `adr-2026-08-21-review-bound-by-plan-done-when-criteria` D3.
- The conflict check (`.docs/conflicts/2026-10-24-build-review-re-raises-already-decided-findings-ev.md`)
  re-opened this review in amendment mode, and the operator approved the amended design on
  2026-10-24. Five structural gaps were closed:
  - same-head re-laps reuse their recorded scope;
  - a `policyIdentity` change forces a full lap;
  - settledness considers every eligible lap and every open case;
  - `scope-empty` is its own branch outcome;
  - the digest budget is bounded by headroom.

  Two decisions were added: `critical` findings are never out of delta, and `causeHunk` reuses the
  content-region reference shape.

## Conditions

1. **Obligation coverage.** The plan carries Architecture Obligation Coverage rows for every
   decision of each amended ADR, plus D1 to D10 of the new ADR.
2. **Fail-closed scope.** A test proves each `full` reason. A test also proves that an unreadable
   or missing record never yields a delta smaller than the whole diff.
3. **Regression shapes from #3294.** Tests cover three end-to-end shapes:
   - a re-raise on a settled, unchanged hunk is `outOfDelta` and is neither judged nor charged;
   - a repair-introduced defect in a delta hunk still kicks back;
  - a critical finding on settled code still blocks;
  - a same-head re-lap keeps its settled hunks;
   - a feature with no new defects passes on the first lap after its last repair.
4. **Both providers.** The rubric and remediate skill contract changes are verified for both Claude
   and Codex dispatch.
