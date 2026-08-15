**Status:** Accepted

# Stories: Content-only rubric cache identity (rebase-stable build_review cache)

Source: jstoup111/ai-conductor#1597 · Track: technical · Tier: S

Technical intent: the build_review per-rubric semantic cache keys on a projection digest
that currently varies with commit SHAs (`mergeBase`/`headSha` anchors, `lapId` derived
from `headSha`, and a snapshot digest that includes `baseRef`/`mergeBase`/`headSha`), so
a rebase voids the cache for a byte-identical diff. Identity must become content-only
while the SHA anchors remain readable provenance for the grader.

## Story 1: A rebase with byte-identical content produces cache hits

As the build_review coordinator, I want rubric cache identity derived only from judged
content so that a history rewrite that changes no content re-uses prior judgements.

### Acceptance Criteria

#### Happy Path
- Given a rubric judgement cached from a source snapshot, when a new lap presents a
  snapshot whose diff text, plan body, and per-rubric context (repair context, accepted
  widenings, operator reseals, removal context, tautology inputs) are byte-identical but
  whose `mergeBase`, `headSha`, `baseRef`, and lap id all differ (a rebase), then the
  cache lookup resolves as a hit for that rubric and no model dispatch occurs.
- Given such a hit, when the current-lap result is materialized, then its `lapId` and
  `snapshotDigest` carry the CURRENT lap's values and its provenance records
  `kind: "cache-hit"` with the cached lap's original `lapId`/`snapshotDigest`.
- Given four cached rubrics where only the plan body changed after a rebase, when the
  lookup runs, then only the plan-carrying rubrics (scope, rootCause, completeness)
  re-judge and tautology still hits.

#### Negative Paths
- Given a cached judgement, when the new snapshot's diff text differs by a single byte
  while all commit SHAs are unchanged, then every rubric's digest differs and the lookup
  misses with `projection-digest-mismatch`.
- Given a cached judgement, when only one rubric's projected context changes (e.g. a new
  accepted scope widening, which only the scope projection carries), then the scope
  lookup misses and the other three rubrics still hit.

### Done When
- [ ] A projection-identity test constructs two projection sources identical except for
      `mergeBase`, `headSha`, `baseRef`, and lap id, and asserts all four rubric digests
      are equal.
- [ ] A companion test flips each content input in turn (diff text, plan body, repair
      context, accepted widenings, removal context, tautology preflight evidence) and
      asserts the affected rubric's digest changes.
- [ ] A coordinator-level test drives a cached-then-rebased sequence and asserts
      `build_review_cache_hit` is emitted for unchanged rubrics with zero
      `dispatchModel` calls for them, and the materialized result carries current-lap
      `lapId`/`snapshotDigest` with cache-hit provenance.

## Story 2: Identity stays sound across versions and anchors stay readable

As the build_review engine, I want the SHA anchors kept as non-digested provenance and
old cache entries excluded by version so that graders keep working and no stale entry
ever false-hits.

### Acceptance Criteria

#### Happy Path
- Given a sealed projection, when it is handed to the grader session, then it still
  carries `mergeBase` and `headSha` usable for by-reference reads
  (`git diff <mergeBase>..HEAD -- <path>`), even though neither participates in the
  digest.
- Given the digest derivation, when a projection is sealed, then its digest is stable
  and deterministic (same content → same digest across processes).

#### Negative Paths
- Given a cache entry written before this change (projection version v1), when the new
  engine performs a lookup, then the entry is rejected as a miss via version mismatch —
  it is never accepted as a hit — and the next fresh judgement atomically replaces it
  with a current-version entry.
- Given a crafted cache entry whose projection version matches but whose digest was
  computed from different content, when the lookup runs, then it misses with
  `projection-digest-mismatch` (no fallback to SHA-based comparison).

### Done When
- [ ] Sealed projections expose `mergeBase`/`headSha` fields verbatim from the snapshot,
      and a test asserts changing them changes neither the digest nor lookup identity.
- [ ] A test feeds a v1-era cache entry (old projection version) to the lookup and
      asserts a miss with a version-mismatch reason, never a hit.
- [ ] The projection version constant is bumped in exactly one registry location, and
      cache parse/lookup accept only the current version.

## Story 3: Cross-feature and cross-repository isolation is unchanged

As an operator running multiple features, I want a cache hit to serve only the feature
and repository that produced it so that content-only identity never leaks judgements.

### Acceptance Criteria

#### Happy Path
- Given two features in separate worktrees with different diffs and plans, when each
  runs build_review, then each reads and writes only its own project-root-scoped cache
  entries and each lookup resolves against its own feature's content digest.

#### Negative Paths
- Given feature A's cache entry copied into feature B's cache directory, when feature
  B's lookup runs with its own (different) diff and plan, then the lookup misses with
  `projection-digest-mismatch` — the foreign judgement is never surfaced as B's result.

### Done When
- [ ] A test asserts the cache path remains scoped under the feature's own project root
      (`.pipeline/build-review/cache/<rubric>.json`) and is unchanged by this fix.
- [ ] A test plants a foreign-content entry in the cache and asserts the lookup misses,
      then a fresh judgement overwrites it.
