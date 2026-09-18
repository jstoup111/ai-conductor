# Sequence: build_review testQuality evidence by reference with a projection-size guard

**Last updated:** 2026-09-17
**Scope:** Test-scope evidence assembly, sealed projection, the new projection-size guard, and rubric dispatch. Judgement semantics and scope selection are unchanged.

## Diagram

```mermaid
sequenceDiagram
    participant Blobs as Pinned git blobs
    participant Assembly as Scope assembly
    participant Projection as Sealed rubric projection
    participant SizeGuard as Projection-size guard
    participant Dispatch as Rubric dispatch
    participant Spine as Event spine
    participant Grader as testQuality rubric session
    participant Coordinator as build_review coordinator

    Assembly->>Blobs: read base and head regions at mergeBase and headSha
    Blobs-->>Assembly: region bytes
    Assembly->>Assembly: hash each region into contentHash, discard the bytes
    Assembly-->>Projection: evidence records of path, side, region, startLine, endLine, contentHash
    Projection->>Projection: seal and derive projectionDigest over the reference-only shape

    Projection->>SizeGuard: serialized projection
    SizeGuard->>SizeGuard: measure bytes against the configured bound

    alt projection exceeds the bound
        SizeGuard-->>Coordinator: named oversize cause with the measured and permitted bytes
        Coordinator->>Coordinator: settle without a retried mechanical fault
        Coordinator->>Spine: publish the oversize cause and reduced-coverage evidence
        Note over SizeGuard,Coordinator: A deterministic oversize is reported once, never re-dispatched three times
    else projection within the bound
        SizeGuard-->>Dispatch: admitted projection
        Dispatch->>Spine: emit build_review_rubric_prompt with promptBytes
        Dispatch->>Grader: rubric prompt carrying references, mergeBase and headSha
        Grader->>Blobs: read each cited region with git show and git diff
        Blobs-->>Grader: region bytes
        Grader->>Grader: confirm the read region against its supplied contentHash
        Grader-->>Coordinator: findings and one scopeResolution per candidate
        Coordinator->>Coordinator: validate candidate identity against the projection only
    end
```

## Legend

- **Evidence is a reference, never a payload.** `BuildReviewPinnedScopeEvidence` keeps the region's
  identity (`source`, `region`, `startLine`, `endLine`, `contentHash`) and no longer carries the
  region's source bytes. This is the contract the graded diff already uses via `changedFiles`.
- **`contentHash` is unchanged and still derived from the same pinned bytes**, so the region's
  semantic identity, candidate matching, and finding anchors are untouched. Only the projected
  payload shrinks.
- **The grader re-reads what it cites.** It already runs inside the feature worktree and is already
  instructed to obtain diff content with `git show «mergeBase»:«path»` and
  `git diff «mergeBase»..HEAD -- «path»`; the same seam now serves evidence regions.
- **The size guard is measured, not guessed.** `build_review_rubric_prompt` already publishes
  `promptBytes` on the event spine, so the bound is checked against an observable the spine carries.
- **An oversize is a deterministic defect, not a transient fault.** It is reported once with a named
  cause and its measured bytes rather than consuming the shared mechanical-fault allowance across
  three identical laps.
- **No projection-version advance.** Cache correctness rides the existing
  `projectionDigest` comparison and the `engineIdentity.engineStamp` cache-key member; a shape
  change already misses closed on both.

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-09-17 | Initial diagram. | Make the by-reference evidence contract and the projection-size guard explicit before implementation (#2582). |
