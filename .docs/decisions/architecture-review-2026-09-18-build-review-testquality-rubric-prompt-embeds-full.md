# Architecture Review: build_review testQuality evidence travels by reference with a projection-size guard (#2582)

**Date:** 2026-09-18
**Mode:** lightweight (Medium tier) — feasibility and alignment
**Track:** technical — `.docs/track/build-review-testquality-rubric-prompt-embeds-full.md`
**Scope boundary (binding):** Approach C without a projection-version advance — (1) stop projecting `BuildReviewPinnedScopeEvidence.content`; (2) add a projection-size guard that reports a deterministic oversize once, with a named cause, instead of consuming the shared mechanical-fault allowance. Out of scope: advancing `projectionVersion` past v3, any change to rubric judgement semantics, any widening of scope selection.
**Stories reviewed:** none yet (pre-stories pass); input is the explore output and the track marker.
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

| Check | Finding |
|---|---|
| Stack compatibility | Pure engine change in `src/conductor` plus one sentence of skill text. No new dependency, service, or infrastructure. |
| Prerequisites | None. `git show`/`git diff` at pinned refs is already the grader's read seam for the diff (`step-runners.ts`, `dispatchBuildReviewRubric` prompt; `skills/build-review-test-quality/SKILL.md` "The diff content is not embedded"). |
| Integration surface | Four engine modules and one skill: `build-review-inputs.ts` (record shape, `pinScopeEvidence`), `build-review-projections.ts` (evidence projection), `build-review-coordinator.ts` (guard seam beside the existing `projection-rubric-mismatch` check), `build-review-domain.ts` (closed reason mapping), `step-runners.ts` (deterministic-fault routing at the join), `types/config.ts` (`BuildReviewRubricConfig` byte bound), `types/events.ts` (additive fields), `skills/build-review-test-quality/SKILL.md`. |
| Data implications | Cache: the `projectionDigest` changes with the record shape and `engineIdentity.engineStamp` changes with any engine build, so stored judgements miss closed (`build-review-cache.ts` lookup compares both). No persisted artifact stores `content` outside the sealed projection; no fixture JSON carries it. |
| Performance risk | Removes the only unbounded term in the projection. Verified: `BuildReviewTestScope` and `SupportedTestDeclaration` are span/title-only (`build-review-test-declarations.ts`); `evidence[].content` was the sole byte-bearing field. Grader does extra `git show` reads per cited region — bounded by the evidence count, which is already deduplicated. |
| Worktree isolation | No shared resources. Guard reads a config value; no ports, DBs, or files. |

**Verified claims (verify-claims):**
- `content` is read by no engine logic other than the hash that produces `contentHash` — **97%, verified** by repo-wide search: producer at `pinScopeEvidence`; pass-through at `build-review-projections.ts` (`evidence:` projection); zero references in coordinator, aggregate, cache, domain, scope-identity. Five test assertions in `build-review-inputs.test.ts` and `build-review-projections.test.ts` reference it.
- Occurrence disambiguation does not need `content` — **95%, verified**: `occurrence` comes from the analyzer's `declaration.occurrence` carried on targets/candidates (`build-review-domain.ts`), not from evidence bytes.
- A `projectionVersion` bump is not required for cache correctness — **93%, verified**: lookup misses on `projection-digest-mismatch` and `engine-version-mismatch` independently of `projectionVersion`.
- The existing skill text already describes evidence as references and never names an embedded content field — **verified** (`SKILL.md` lines "represented as immutable content-region references" and "The diff content is not embedded").

**Assumptions surfaced:**
- A1 (confirmed by operator 2026-09-17): no v4 advance. Impact if wrong: none for correctness — only the cache-miss reason string differs.
- A2 (inferred, 85%): a healthy testQuality projection is tens of KB, so a default bound in the hundreds of KB admits every legitimate lap and rejects only the failure class. Confirm at plan time by measuring the serialized projection on a recent green lap before fixing the default; the bound is configurable regardless.

## Alignment

**Governing ADRs (repo-wide sweep, 590 files):**

- `adr-2026-08-13-engine-managed-build-review-rubric-branches` §2 — "The skill receives the projection, not a path through which it can read additional source-snapshot fields." Read literally this collides with a grader that runs `git show`, but #1595 (`031f440b5`) already established diff-by-reference under this ADR without amending it, and the clause's stated purpose (digest completeness) is preserved when the *hash* of the referenced bytes is in the digest. **Amended (D2.1)** to state the by-reference contract explicitly for both the diff and evidence, rather than leaving the precedent implicit.
- `adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane` D2/D3/D4/D5/D6/D10 — the lane retries every mechanical fault up to `MAX_MECHANICAL_FAULTS_BUILD_REVIEW = 3` (`kickback-ledger.ts`), which is exactly what burned the allowance on a deterministic oversize. **Amended (D2.1, D3.1, D10.1)**: a new closed cause `projection-oversized`, charged once and never retried, routed to the existing `needs-human` HALT with the reduced-coverage record as the operator's attributed way past it; the occurrence rides the existing `build_review_rubric_infrastructure_failure` event with additive fields.
- `adr-2026-09-06-engine-owned-test-quality-scope` decisions 6, 8, 11 — already mandate "compact evidence … deduplicated pinned references" and a projection-size comparison; the inlined bytes contradict both. **Amended (D6.1)** to define a pinned reference as identity-not-bytes and to record that v3 is retained.
- `adr-2026-09-10-portable-build-review-policy` D3 — "Exceeding either yields a named policy-loading failure, not truncation." Direct precedent for the guard's shape (named failure, no silent clipping). Applied, not amended.
- `adr-2026-08-16-closed-build-review-finding-vocabularies` D4 — "A contract version changes only when identity semantics change." Applied by analogy to the input projection: identity fields are unchanged.
- `adr-2026-08-21-engine-identity-in-build-review-cache-key` — cache-key composition; relied on, not changed.

**Rejected alternative for the guard's cause:** reusing `scope-incomplete`. adr-2026-09-06 decision 7 defines it as an engine-analysis uncertainty over *which tests are in scope*; a transport-size failure is a different class, and adr-2026-08-18 D2 requires a closed member per class, not a semantic stretch.

**Event spine (`.agents/skills/event-spine/SKILL.md`):**
```
Event spine
  Channel?    no    — reuses build_review_rubric_infrastructure_failure (+ optional measuredBytes/limitBytes) and build_review_rubric_prompt (promptBytes, already emitted)
  Concern:    occurrence — "this lap's projection exceeded the bound"
  Verdict:    extend the union (additive optional fields on an existing variant)
  Exception:  none
```

**Scope check (`.agents/skills/scope-check/SKILL.md`):** Decision A — no repo-only signal fires; the `build_review` engine and the `build-review-test-quality` skill are the shipped engine/catalog and exist in every consumer, so the change is **consumer-facing**: engine in `src/conductor`, skill text in `skills/`. No `HARNESS.md` rule change (defect fix, not a behavioral rule). Decision B — no new skill. Decision C — the byte bound is provider-agnostic by construction (bytes, not a model's token window); the skill sentence names `git`, not a provider.

**Domain boundaries / state:** the closed reason unions stay total at the type level (adr-2026-08-18 D2). No boolean flags; the deterministic-vs-retriable distinction is expressed by membership of the closed reason, not by a parallel flag.

**Diagram accuracy:** `.docs/architecture/build-review-testquality-rubric-prompt-embeds-full.md` (operator-approved) matches this design.

## Wiring Surface

| New/changed production surface | Called from |
|---|---|
| `BuildReviewPinnedScopeEvidence` without `content`; `pinScopeEvidence` hashes and discards | `snapshotTypedTestScope` → `assembleBuildReviewInputs` in `build-review-inputs.ts`, on every build_review lap |
| Coordinator reason `projection-oversized` + domain mapping member | Raised at the coordinator's existing projection check (beside `projection-rubric-mismatch`), consumed by `deriveBuildReviewInfrastructureFailureReason` at the step-runner join |
| `build_review.rubrics.<id>.max_projection_bytes` | Read by the coordinator guard from the resolved `BuildReviewRubricConfig`; validated by the existing config loader |
| Deterministic-fault routing in `runBuildReview` (step-runners) | The existing `infrastructureFailure` branch before `bumpMechanicalFaultsInLedger`; `projection-oversized` skips the bump and publishes the aggregate once |
| `build_review_rubric_infrastructure_failure` additive fields | Emitted at the same site the event is emitted today |
| `skills/build-review-test-quality/SKILL.md` re-read/verify sentence | Loaded by the rubric dispatch via `renderAuxiliarySkillInvocation`; digest participates in the cache key |

Overlap scan over the eight candidate paths: no overlap, no open blockers.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Grader skips the re-read and judges from titles alone | Knowledge | Low | Medium | Skill text names the seam and the hash to verify; rubric already requires "cite the concrete stub-passable assertion", which needs the bytes |
| Default bound set too low admits false oversize halts | Technical | Low | Medium | Measure a recent green lap's serialized projection before fixing the default; bound is per-rubric configurable |
| Pinned engine dist older than current skill text (skills symlink to live checkout) | Integration | Medium | Low | Old engine still inlines `content`; new skill text ignores it — compatible in both directions, which is why no v4 is needed |
| Test fixtures assert on `content` | Technical | Certain | Low | Five assertions in two test files; replace with `contentHash`-based assertions |

## ADRs Created

None. Three governing ADRs amended (additive, original text preserved):
- `adr-2026-08-13-engine-managed-build-review-rubric-branches` — D2.1
- `adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane` — D2.1, D3.1, D10.1
- `adr-2026-09-06-engine-owned-test-quality-scope` — D6.1

## Conditions

1. The byte bound is expressed in bytes on `BuildReviewRubricConfig` with a shipped default; no provider- or model-specific limit anywhere in engine or skill text (scope-check Decision C).
2. `projection-oversized` is added to both closed unions and to the total mapping; the compile must fail if either side is missed (adr-2026-08-18 D2).
3. The oversize path publishes the aggregate exactly once and never calls `bumpMechanicalFaultsInLedger` (adr-2026-08-18 D3.1); a test proves a second lap on the same snapshot is not dispatched.
4. `contentHash` is computed over the same bytes as before; a test proves the projection digest for a fixed snapshot changes only because `content` is absent and that candidate matching and anchors resolve identically.
5. The plan measures a recent green lap's serialized projection before fixing the default bound (A2).
