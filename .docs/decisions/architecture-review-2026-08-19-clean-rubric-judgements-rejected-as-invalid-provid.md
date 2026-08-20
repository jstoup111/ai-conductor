# Architecture Review: Clean rubric judgements rejected as invalid-provider-result

**Date:** 2026-08-19
**Issue:** #1683
**Tier:** Medium (lightweight mode — Feasibility and Alignment in full; complexity assessed by
`/conduct`, domain integrity handled per-cycle by the TDD domain reviewer)
**Track:** technical
**Stories reviewed:** none yet — this review runs before `/stories`, per
`adr-2026-06-29-architecture-before-stories-convergent-kickback`. Its input is the operator-confirmed
scope boundary in `.docs/track/clean-rubric-judgements-rejected-as-invalid-provid.md` and the
technical intent from `/explore`.
**Verdict:** APPROVED WITH CONDITIONS

## Scope boundary (binding)

Four seams, operator-confirmed 2026-08-19: (A) diagnosis integrity, (B) the `anchor.planTask`
canonical-form regression, (C) engine-owned judged-result envelope, (D) a drift guard pinning
parser-enforced reference grammars to the rubric contract text. The retry-budget accounting and the
operator lever for a drained budget are **excluded** and remain with the in-flight
`review-infrastructure-failures-are-operator-unreco` feature. This review does not widen that
boundary.

## Feasibility

| Check | Assessment |
|---|---|
| Stack compatibility | Yes. No new dependency, service, or runtime. Every seam is a change to existing TypeScript in `src/conductor/src/engine/`, four existing Markdown contracts, and one existing shell integrity check. |
| Prerequisites | None external. The rubric registry, closed reason vocabulary, projection reference context, and the vocabulary drift guard all already exist. |
| Integration surface | One subsystem. The provider boundary is crossed but not changed in kind — only the payload narrows. No new module boundary. |
| Data implications | None. Seam C deliberately leaves the at-rest artifact and cache entry shapes unchanged, so cache identity is stable and no judgement is invalidated. Persisted `v1`/`v2`/`v3` records keep parsing. |
| Performance risk | Net negative cost. The rendered shape template drops five echo placeholders, and seam A's byte-identical guard removes repair turns that cannot converge. No new I/O, no new query path. |
| Worktree isolation | Unaffected. No new port, service, database, queue, or shared file. All state stays under the existing per-feature `.pipeline/`. |

**Feasibility risk that is real:** seam C's four rubric contracts, the rendered template, and the
drift guard must move together. A partial landing leaves the contract prose describing a shape the
engine no longer requires — which is the precise failure mode seam D exists to prevent. Condition 2
binds this.

## Alignment

**Approved decisions.** The design is governed by, and conforms to,
`adr-2026-08-13-engine-managed-build-review-rubric-branches` (amended here by §2 note),
`adr-2026-08-16-closed-build-review-finding-vocabularies` D3/D4,
`adr-2026-08-18-content-anchored-finding-reference-schema`,
`adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane` D1/D2,
`adr-2026-08-17-build-review-rubric-repetition-short-circuit` D2/D3,
`adr-2026-07-13-retry-classify-rerun-vs-route`, and
`adr-2026-08-13-stable-build-review-finding-dispositions` §1/§4. The rulings and their reasoning are
recorded in `adr-2026-08-19-engine-stamped-rubric-judged-result-envelope`; they are not restated
here.

**Domain boundaries.** The change moves work *toward* the owner that already holds the data. It
does not introduce coupling: the coordinator and dispatch layer already hold the projection and the
registry, so no new dependency edge is created. `adr-2026-08-13-stable-build-review-finding-dispositions`
§1 already draws this line — "The LLM judges what concern and anchors apply… Everything after that
judgement — schema validation, canonicalization, ID creation, collision handling, and matching — is
deterministic." Echoing an engine-held digest sits on the deterministic side of that line, so seam C
moves a misplaced responsibility back rather than relocating a well-placed one.

**Pattern consistency.** Every seam extends a mechanism that already exists and works, which is why
this stays Medium rather than Large: identity stamping already exists on the cache-hit path; the
closed infrastructure-reason vocabulary already exists; the drift guard already exists for closed
vocabularies. No new structural pattern is introduced.

**State management.** No new states, no new booleans, no new transitions. Seam A's byte-identical
guard is a comparison of two values already in hand within one dispatch, not a new persisted flag.

**Diagram accuracy.** `.docs/architecture/clean-rubric-judgements-rejected-as-invalid-provid.md` and
its sequence sibling were authored for this feature and validated by the operator on 2026-08-19.
Both render clean under `conduct-ts render-diagrams --check`. They reflect the post-change boundary
and label each seam.

**Security boundaries.** The provider trust boundary tightens rather than loosens: strictly less
model-authored data is admitted into engine-held state. No new user input, no new endpoint, no
change to what the projection exposes to a rubric.

**Production DI defaults.** Not applicable — no dependency-injected store is added or changed.

**Local pattern basis.** The cache-hit stamping path in `coordinateBuildReviewRubrics` is the
precedent seam C should follow. Traits to preserve: the artifact is written with the *current*
projection's `lapId` and `snapshotDigest` regardless of what the reused result body carried;
provenance is recorded explicitly rather than inferred; and the written artifact is re-validated
before the branch settles. What may vary freely: where the stamp is applied within the dispatch
path, and how the narrowed wire payload is typed. Rediscover it by searching
`build-review-coordinator.ts` for the cache-hit branch that calls `writeArtifact` with
`provenance: { kind: 'cache-hit' }`, and resolve the traits against HEAD at implementation time
rather than against this description.

## Wiring Surface

| New/changed production surface | Where it is called from in production |
|---|---|
| Narrowed judged-result wire parse (seam C) | `dispatchBuildReviewRubric` in `step-runners.ts`, on the path already reached from the `build_review` step runner; and `validateBuildReviewDispatchedResult` at coordinator settlement in `coordinateBuildReviewRubrics` |
| Envelope stamp from projection + rubric registry (seam C) | Same dispatch path, between candidate extraction and the authoritative predicate |
| Engine-side rubric invariant (ADR D5) | Coordinator settlement, alongside the existing per-branch resolution in `coordinateBuildReviewRubrics` |
| Canonical plan-task normalizer (seam B) | The anchor parse inside `parseFindings` in `build-review-domain.ts`, reached from both the dispatch predicate and the at-rest artifact/cache parse |
| Reference-context-bound rejection diagnosis (seam A) | `validateRubricOutput` in `step-runners.ts`, which already calls `describeBuildReviewJudgedResultRejection`; the added argument is the projection it already holds |
| Byte-identical repair guard (seam A) | The validate-and-repair loop in `dispatchBuildReviewRubric`, before the repair invocation is spent |
| Rendered shape template without echo placeholders (seam C) | `renderBuildReviewJudgedResultShape`, consumed by both the dispatch prompt and the repair prompt |
| Extended reference-grammar drift guard (seam D) | `test/check_build_review_rubric_skill_vocabularies.sh`, already invoked by `test/test_harness_integrity.sh` |

Every entry lands on a path that already exists and is already reached in production. This feature
introduces no new entry point, no new subscriber, and no new scheduled work, so there is no
green-but-unwired surface for the SHIP reachability sweep to discover.

## Early overlap scan (advisory)

`conduct-ts overlap-scan` was run over the Wiring Surface paths. It is reported here as
**low-signal, not clean**: it returned 308 overlapping branches for
`build-review-coordinator.ts` alone, and comparable counts for the other engine paths, because
long-lived unmerged `spec/*` branches diverge from an old base and therefore match nearly every
engine file. No dependency conclusion is drawn from it.

The genuine overlap was identified instead by the repository-wide ADR sweep and is named in
Condition 3: `review-infrastructure-failures-are-operator-unreco`, whose approved plan adds a total
branch-reason-to-closed-cause mapping over the same `BuildReviewInfrastructureFailureReason` union
this feature reduces the inputs to.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Seam C lands partially — engine narrowed, one rubric contract still describing the old shape | Integration | Medium | Medium | Condition 2: seam D's extended drift guard must land in the same change and must fail on exactly this divergence |
| The branch-reason mapping in `review-infrastructure-failures-are-operator-unreco` lands first and shifts the reason vocabulary under this work | Integration | Medium | Medium | Condition 3: read the current mapping at implementation time; declare the dependency rather than duplicating D2 |
| Nothing verifies findings were shaped by the stamped `contractVersion` | Technical | Low | Medium | Prompt and stamp render from one constant; recorded as an accepted negative consequence in the ADR |
| Concurrent branch results cross, now unguarded by a `rubric` echo | Technical | Low | High | ADR D5's engine-side invariant, which does not rest on the 90%-confidence inference that crossing is unreachable |
| Diagnosis rewrite silently loses an existing enumerated check while adding reference-scoped ones | Technical | Medium | Medium | Condition 1: every currently enumerated rejection cause keeps a test that fails if its specific message stops being produced |
| A future parser tightening ships without its instruction, recreating the #1696 regression | Knowledge | Medium | High | Seam D — this is the class fix, and Condition 2 makes it non-optional |

## ADRs Created

- `adr-2026-08-19-engine-stamped-rubric-judged-result-envelope` — **Status: APPROVED**
  (operator-approved 2026-08-19). Amends `adr-2026-08-13-engine-managed-build-review-rubric-branches`
  §2; that ADR carries an additive amendment note pointing here. Structural prerequisite: it revises
  the integration pattern at the provider seam — what crosses it and which side owns identity
  binding.

No other ADR is created. Seams A, B and D make no structural decision: A is a correctness repair to
a diagnostic function, B is input normalization ahead of an existing closed reference kind (ADR D9),
and D is an integrity check. Each is recorded above and governed by the ADR's D6, D9 and D10
respectively.

## Conditions

1. **No enumerated rejection cause is lost.** Seam A rewrites `describeBuildReviewJudgedResultRejection`.
   Every cause it enumerates today must retain a test that fails if that specific diagnosis stops
   being produced, so the rewrite cannot trade the catch-all defect for silent coverage loss.
2. **Seam C and seam D land together.** The narrowed contract must not reach any rubric SKILL.md
   without the extended drift guard that pins engine definition to contract text. A change that
   moves the engine and the prose but not the guard leaves the exact gap that produced this issue.
3. **Read the branch-reason mapping at implementation time.** `review-infrastructure-failures-are-operator-unreco`
   is an approved, in-flight feature amending the same reason vocabulary. Resolve the current shape
   against HEAD when the work starts; do not implement its D2 mapping here, and do not assume this
   review's description of it is still current.
4. **The at-rest/on-the-wire split is discoverable at the parse boundary.** The stored artifact
   remains a full envelope while the wire payload is `findings` only. That asymmetry must be legible
   where the parsing happens, not only in the ADR, or the next reader will infer the provider
   supplied the stored envelope.

## Verdict

**APPROVED WITH CONDITIONS.** Proceed to `/stories`. The four conditions are tracked into the plan
and checked at code review; unmet conditions at `/finish` are blocking.
