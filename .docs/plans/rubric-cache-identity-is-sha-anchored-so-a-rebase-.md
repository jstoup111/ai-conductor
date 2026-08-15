# Implementation Plan: Content-only rubric cache identity (rebase-stable build_review cache)

**Date:** 2026-08-15
**Stories:** .docs/stories/rubric-cache-identity-is-sha-anchored-so-a-rebase-.md
**Conflict check:** Skipped (Tier S)

## Summary

Make the build_review rubric cache identity content-only so a rebase that leaves diff
content and plan byte-identical produces cache hits on all previously-judged rubrics.
Six tasks across `build-review-inputs.ts`, `build-review-projections.ts`,
`build-review-registry.ts`, `build-review-cache.ts`, and the coordinator tests.

## Technical Approach

SHA-anchoring currently enters the projection digest through three paths: the
`mergeBase`/`headSha` anchor fields on every projection, `lapId` (derived as
`lap-${headSha}` in `step-runners.ts`), and `snapshotDigest` (computed over the snapshot
including `baseRef`/`mergeBase`/`headSha`). The fix:

- **`build-review-inputs.ts`** — add a `contentDigest` field to
  `BuildReviewSourceSnapshot`: sha256 over the shared snapshot's content fields only
  (diff, planBody, repairContext, removalContext), excluding
  `digest`, `baseRef`, `mergeBase`, `headSha`, and the scope-only fields
  `acceptedWidenings` and `operatorReseals`.
  The existing `digest` (full identity) is unchanged and stays on the snapshot.
  *(Operator ruling 2026-08-15, resolving the Task 5 stall: cache identity is
  rubric-specific. `acceptedWidenings` is consumed only by the scope projection, so it
  must not enter the shared `contentDigest`; it reaches scope's cache key through
  `projectionDigest()` over `ScopeProjection`'s own fields — exactly like
  `operatorReseals`. A newly accepted widening therefore invalidates only scope's
  cache entry, preserving Task 5's selectivity criterion: scope misses and
  re-dispatches while the other three rubrics still hit.)*
- **`build-review-projections.ts`** — `common()` carries `contentDigest`;
  `projectionDigest()` digests the projection excluding `digest`, `lapId`,
  `snapshotDigest`, `mergeBase`, and `headSha`. Content sensitivity is preserved
  because `contentDigest` (full diff text) and every per-rubric context field remain in
  the digested view; the anchors stay on the projection as non-digested provenance for
  the grader's by-reference git reads. `changedFiles` (hunk ranges) is diff-derived and
  rebase-stable, so it stays digested.
- **Semantic-identity principle (operator ruling 2026-08-15, second amendment).**
  The five named top-level exclusions above are instances of a general rule, and the
  rule — not the field list — is the authorized design: **cache identity digests
  semantic content only; commit-addressed and execution provenance is excluded from
  digested identity wherever it appears in any projection, at any nesting depth.**
  Provenance means: commit/blob SHAs (including `acceptedWidenings[].sha`,
  `operatorReseals[].fromCommit`/`toCommit`, `testSuiteProof.provenanceHeadSha`,
  preflight `sourceIdentities`), execution timing (`startedAt`, `endedAt`,
  `durationMs`), and any other rebase- or rerun-volatile field that does not change
  the meaning of the evidence. The semantic remainder of each record (paths,
  rationales, task ids, reasons, classifications, verdicts, selector lists) stays
  digest-sensitive. Normalizing such a field out of digested identity is in-plan for
  Task 2 and requires no further scope authorization; excluded provenance may remain
  on the projection as non-digested context for the grader. Every normalization must
  carry a test proving the volatile field no longer perturbs the digest while a
  semantic flip of the same record still does.
- **`build-review-registry.ts` + type literals** — bump `projectionVersion` to `'v2'`
  in the registry descriptors and every `'v1'` projectionVersion literal
  (projections, cache entry/lookup, coordinator, artifacts). Pre-fix cache entries then
  miss closed via `projection-version-mismatch` in the strict cache parse.
- **No coordinator/cache logic change** — `classifyBuildReviewCacheLookup` already
  rewrites the hit result's `lapId`/`snapshotDigest` to the current lap's values, so
  cross-rebase hits materialize correctly with existing machinery. `lapId` stays
  `lap-${headSha}`.

Sequencing: content digest first (T1), then the projection digest change that consumes
it (T2), then the version bump (T3), then the provenance/negative/isolation tests
(T4–T6) which exercise the completed identity.

## Prerequisites

None — all touched modules exist; unit tests use the injected cache filesystem seam.

## Tasks

### Task 1: Content-only snapshot digest
**Story:** Story 1 (rebase-stable identity — content digest foundation)
**Type:** infrastructure

**Steps:**
1. Write failing test in `build-review-inputs.test.ts`: two snapshots identical except
   `baseRef`/`mergeBase`/`headSha` have equal `contentDigest`; flipping one byte of
   `diff` or `planBody` changes it; `operatorReseals` does not affect it.
2. Verify test fails (RED).
3. Implement: add `readonly contentDigest: string` to `BuildReviewSourceSnapshot`;
   compute it in the snapshot freeze path from the content fields only (diff, planBody,
   repairContext, acceptedWidenings, removalContext).
4. Verify test passes (GREEN).
5. Commit: "feat(build-review): add content-only snapshot digest"

**Files likely touched:**
- src/conductor/src/engine/build-review-inputs.ts — contentDigest field + derivation
- src/conductor/test/engine/build-review-inputs.test.ts — digest equality/sensitivity tests

**Dependencies:** none

### Task 2: Projection digest excludes SHA-anchored fields
**Story:** Story 1 (happy: SHA-only change → equal digests; negative: any content flip → digest change)
**Type:** happy-path

**Steps:**
1. Write failing test in `build-review-projections.test.ts`: two projection sources
   identical except `mergeBase`/`headSha`/`baseRef`/lap id yield equal digests for all
   four rubrics; then flip each content input in turn (diff text, planBody,
   repairContext, acceptedWidenings, removalContext, tautology preflight evidence,
   changed test selectors) and assert the affected rubric's digest changes.
2. Verify test fails (RED).
3. Implement: `common()` carries `contentDigest` from the snapshot;
   `projectionDigest()` strips `digest`, `lapId`, `snapshotDigest`, `mergeBase`,
   `headSha` before canonicalizing.
4. Verify test passes (GREEN).
5. Commit: "fix(build-review): derive projection digest from content only"

**Files likely touched:**
- src/conductor/src/engine/build-review-projections.ts — contentDigest in common(), digest exclusions
- src/conductor/test/engine/build-review-projections.test.ts — identity tests

**Dependencies:** 1

### Task 3: Bump projectionVersion to v2 so v1 entries miss closed
**Story:** Story 2 (negative: pre-fix entry misses via version mismatch, never a false hit)
**Type:** negative-path

**Steps:**
1. Write failing test: `build-review-registry.test.ts` expects `projectionVersion: 'v2'`
   for all four descriptors; `build-review-cache.test.ts` feeds a stored v1-era entry to
   `classifyBuildReviewCacheLookup` with a current v2 lookup and asserts a miss with
   reason `projection-version-mismatch` (and a v2 entry with a foreign digest misses
   with `projection-digest-mismatch`).
2. Verify test fails (RED).
3. Implement: change every projectionVersion `'v1'` literal (registry descriptors,
   `CommonProjection`, cache entry/lookup interfaces + parse guard, coordinator,
   artifacts provenance) to `'v2'`.
4. Verify test passes (GREEN).
5. Commit: "feat(build-review): bump rubric projection version to v2"

**Files likely touched:**
- src/conductor/src/engine/build-review-registry.ts — descriptor projectionVersion
- src/conductor/src/engine/build-review-projections.ts — type literal
- src/conductor/src/engine/build-review-cache.ts — entry/lookup literals + parse guard
- src/conductor/src/engine/build-review-coordinator.ts — lookup literal
- src/conductor/src/engine/build-review-artifacts.ts — provenance literal if version-typed
- src/conductor/test/engine/build-review-registry.test.ts — descriptor expectations
- src/conductor/test/engine/build-review-cache.test.ts — v1-entry miss test

**Dependencies:** 2

### Task 4: Anchors remain readable, non-digested provenance
**Story:** Story 2 (happy: grader still gets mergeBase/headSha; digest deterministic)
**Type:** happy-path

**Steps:**
1. Write failing test in `build-review-projections.test.ts`: sealed projections expose
   `mergeBase`/`headSha` verbatim from the snapshot; recomputing `projectionDigest` on
   the sealed value round-trips (digest stable/deterministic); changing only the anchor
   fields leaves `projection.digest` unchanged.
2. Verify test fails (RED) — or, if T2's implementation already satisfies it, record it
   as the proving assertion and keep the test.
3. Implement: none expected beyond T2; adjust only if the round-trip reveals a gap.
4. Verify test passes (GREEN).
5. Commit: "test(build-review): prove anchors are non-digested provenance"

**Files likely touched:**
- src/conductor/test/engine/build-review-projections.test.ts — provenance + determinism tests

**Verify-only:** yes

**Dependencies:** 2

### Task 5: Coordinator serves cache hits across a rebase
**Story:** Story 1 (coordinator-level: hits emitted, zero dispatch, current-lap result values; per-rubric selectivity)
**Type:** happy-path

**Steps:**
1. Write failing test in `build-review-coordinator.test.ts`: run the coordinator once to
   populate the cache, then re-run with a source identical except rewritten
   `mergeBase`/`headSha`/`baseRef`/lap id — assert `build_review_cache_hit` for all four
   rubrics, `dispatchModel` never called, and each materialized result carries the
   CURRENT lap's `lapId`/`snapshotDigest` with `kind: "cache-hit"` provenance recording
   the cached lap. Add the selectivity case: same rebase plus a new accepted scope
   widening → scope misses and re-dispatches, the other three still hit.
2. Verify test fails (RED).
3. Implement: none expected (identity change lands in T1–T3); fix coordinator wiring
   only if the test exposes a gap.
4. Verify test passes (GREEN).
5. Commit: "test(build-review): rebase-stable cache hits at the coordinator"

**Files likely touched:**
- src/conductor/test/engine/build-review-coordinator.test.ts — rebase hit + selectivity tests

**Verify-only:** yes

**Dependencies:** 3

### Task 6: Cross-feature isolation holds under content-only identity
**Story:** Story 3 (happy: project-root-scoped cache path unchanged; negative: foreign entry misses then is overwritten)
**Type:** negative-path

**Steps:**
1. Write failing test in `build-review-cache.test.ts`: `cacheEntryPath` remains
   `<projectRoot>/.pipeline/build-review/cache/<rubric>.json`; plant feature A's valid
   v2 entry (different content digest) as feature B's cache file, assert B's lookup
   misses with `projection-digest-mismatch`, and assert a subsequent
   `writeBuildReviewCacheEntry` atomically replaces it.
2. Verify test fails (RED) — or record as proving assertions if already green.
3. Implement: none expected; the digest comparison provides isolation.
4. Verify test passes (GREEN).
5. Commit: "test(build-review): foreign cache entries never hit"

**Files likely touched:**
- src/conductor/test/engine/build-review-cache.test.ts — isolation tests

**Verify-only:** yes

**Dependencies:** 3

## Task Dependency Graph

```
T1 (content digest)
 └─ T2 (projection digest exclusions)
     ├─ T3 (version bump v2)
     │   ├─ T5 (coordinator rebase hits)
     │   └─ T6 (isolation)
     └─ T4 (anchor provenance)
```

## Integration Points

- After Task 3: the full identity change is live — projections digest content only and
  stale v1 entries miss closed; T4–T6 prove it end-to-end at each seam.

## Verification

- [ ] All happy path criteria covered by at least one task (T2, T4, T5, T6)
- [ ] All negative path criteria covered by at least one task (T2 content flips, T3 v1
      miss + crafted digest, T5 selectivity, T6 foreign entry)
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies are explicit and acyclic
