**Status:** Accepted

# Stories: cached rubric verdicts survive an engine change (#1759)

Track: technical. Tier: M. Design: `adr-2026-08-21-engine-identity-in-build-review-cache-key` (D1–D7).
Scope boundary: engine identity in the cache key, named miss reasons, a discard event. No operator clear command, no rollover bulk clear, no dashboard surfacing.

## Story 1: A cached verdict from a different engine build is not served

**Requirement:** ADR D1, D2 — issue outcome 1 and 2

As the build_review step, I want a cached rubric verdict to be reused only when the engine that produced it has the same content stamp as the engine now running, so that a merged build_review fix reaches every warm feature on its next dispatch with no operator action.

### Acceptance Criteria

#### Happy Path
- Given a cache entry whose `engineIdentity.engineStamp` differs from the running engine's stamp and every other identity component matches, when the lookup is classified, then the result is a miss with reason `engine-version-mismatch`
- Given that miss, when the coordinator proceeds, then the rubric is dispatched to the model and the newly written cache entry carries the running engine's stamp
- Given the running engine dir is `.../dist-versions/20260820T204302Z-31b5c81beaec/engine`, when the engine identity is resolved, then `engineStamp` is exactly `31b5c81beaec` and contains no timestamp characters
- Given two entries written by engines whose dist ids differ only in the timestamp prefix, when the second engine looks up the first's entry, then it is a hit

#### Negative Paths
- Given a cache entry with a matching `engineStamp` but a mismatched `projectionDigest`, when classified, then the miss reason is `projection-digest-mismatch` and no `build_review_cache_discarded` event is emitted
- Given a cache entry with a matching `engineStamp` but a mismatched `policyFingerprint`, when classified, then the miss reason is `policy-fingerprint-mismatch`, checked before any engine-identity comparison
- Given the running engine dir has no `dist-versions` segment, when the engine identity is resolved, then `engineStamp` is the sentinel `dev`
- Given an entry written under `engineStamp: dev` and a running published engine, when classified, then the result is a miss with reason `engine-version-mismatch`

### Done When
- [ ] `BuildReviewCacheMissReason` includes `engine-version-mismatch` and `classifyBuildReviewCacheLookup` returns it for a stamp mismatch after all existing checks
- [ ] `resolveBuildReviewEngineIdentity` (or equivalent) derives the 12-hex stamp from the dist id and returns `dev` when no id is present, with unit tests for both
- [ ] Written cache entries carry `engineIdentity.engineStamp` equal to the running engine's stamp

## Story 2: A rubric whose skill text changed is re-judged

**Requirement:** ADR D1, D3

As the build_review step, I want each rubric's cached verdict bound to a digest of its installed SKILL.md bytes, so that a skill-text edit that ships without a dist publish invalidates exactly the rubric it touches.

### Acceptance Criteria

#### Happy Path
- Given a cache entry whose `engineIdentity.skillDigest` differs from `sha256:` over the current raw bytes of `skills/build-review-<rubric>/SKILL.md` and every other component matches, when classified, then the result is a miss with reason `skill-digest-mismatch`
- Given only the `scope` rubric's SKILL.md changed since the entries were written, when all four rubrics are looked up, then only `scope` misses and the other three hit
- Given the SKILL.md path is resolved through the same skill-resolution seam the provider invocation uses, when a test points that seam at a temp directory, then the digest reflects the temp file's bytes

#### Negative Paths
- Given a SKILL.md edit that changes only whitespace, when the rubric is looked up, then it misses with reason `skill-digest-mismatch` (no normalization)
- Given the rubric's SKILL.md cannot be read, when the rubric branch is resolved, then it is an infrastructure failure with the existing reason `cache-read-failed` whose detail names the unreadable SKILL.md path, no cache hit is served, and no cache entry is written
- Given both `engineStamp` and `skillDigest` mismatch, when classified, then the reason is `engine-version-mismatch` (engine checked first) and exactly one reason is reported

### Done When
- [ ] `BuildReviewCacheMissReason` includes `skill-digest-mismatch`; the closed infrastructure-failure reason vocabulary gains no member (unreadable skill text reuses `cache-read-failed`)
- [ ] Skill digest is computed from raw file bytes via the existing skill-resolution seam, covered by a test using an injected filesystem/root
- [ ] Per-rubric invalidation test: editing one rubric's SKILL.md bytes misses only that rubric

## Story 3: A same-engine, same-projection verdict is still served

**Requirement:** ADR D1, D6 — issue outcome 3

As the build_review step, I want the cache to keep its value when nothing relevant changed, so that adding engine identity does not turn every lap cold.

### Acceptance Criteria

#### Happy Path
- Given a cache entry written by the running engine with matching stamp, skill digest, projection digest, and policy fingerprint, when classified, then the result is a hit with `provenance.kind: cache-hit` and a `build_review_cache_hit` event is emitted as today
- Given a hit, when the result is materialized, then `lapId` and `snapshotDigest` are restamped to the current lap exactly as before this change
- Given the engine identity is resolved once per build_review dispatch, when four rubrics are coordinated, then the resolver is invoked once and the same identity is passed to every lookup and write

#### Negative Paths
- Given the cache module is constructed with an injected engine identity, when a test runs it without `process.env` or `import.meta` access, then classification and writes succeed (no hidden global reads)
- Given a write of an entry lacking `engineIdentity`, when `writeBuildReviewCacheEntry` validates it, then it throws and no file is written

### Done When
- [ ] Existing cache-hit tests pass unchanged in behavior with the identity supplied
- [ ] `coordinateBuildReviewRubrics` accepts `engineIdentity` as input and threads it to `readCache`/`writeCache`; `step-runners.ts` supplies it once per dispatch
- [ ] `writeBuildReviewCacheEntry` rejects entries without a well-formed `engineIdentity`

## Story 4: Legacy cache entries miss with a named reason

**Requirement:** ADR D4

As an operator reading the first lap after this ships, I want pre-existing cache entries that carry no engine identity to be discarded under the engine-version reason, so that the transition is observable per rubric instead of disappearing into a generic parse failure.

### Acceptance Criteria

#### Happy Path
- Given a persisted 7-key entry with no `engineIdentity` field and otherwise valid content, when classified, then the result is a miss with reason `engine-version-mismatch`
- Given that legacy miss, when the coordinator handles it, then a `build_review_cache_discarded` event is emitted with `cachedEngineStamp` absent and `currentEngineStamp` set

#### Negative Paths
- Given a persisted entry whose `engineIdentity` is present but malformed (e.g. `engineStamp` empty or non-string), when classified, then the result is `invalid-entry` and no discard event is emitted
- Given a persisted entry with an unknown extra top-level key, when classified, then the result is `invalid-entry` as today
- Given a persisted `v2` contract entry lacking `engineIdentity`, when classified, then the result is `contract-version-mismatch` (existing ordering preserved; engine identity is checked last)

### Done When
- [ ] `parseBuildReviewCacheEntryCandidate` treats `engineIdentity` as optional-on-read and validates its shape when present
- [ ] Unit tests cover absent, malformed, and extra-key cases with the reasons above

## Story 5: A discard is recorded on the event spine and named in the daemon log

**Requirement:** ADR D5 — issue outcome 4

As an operator, I want a discarded cached verdict to appear in `events.jsonl` and the daemon log naming the rubric and the cause, so that a silent replay and a fresh re-judge never look alike.

### Acceptance Criteria

#### Happy Path
- Given a lookup misses with `engine-version-mismatch` or `skill-digest-mismatch`, when the coordinator proceeds, then it emits `build_review_cache_discarded { rubric, lapId, reason, cachedEngineStamp?, currentEngineStamp }` before dispatching the model
- Given the event reaches the sinks, when `EVENT_SINKS` is consulted, then `build_review_cache_discarded` is declared `render: true, persist: true, audit: true`
- Given the event is rendered, when the daemon log line is produced, then it contains the rubric id and the reason string verbatim

#### Negative Paths
- Given a miss with any other reason (`missing`, `projection-digest-mismatch`, `policy-fingerprint-mismatch`, `invalid-entry`), when the coordinator proceeds, then no `build_review_cache_discarded` event is emitted
- Given the `emit` hook is not supplied to the coordinator, when a discard occurs, then the rubric is still dispatched and the lap completes
- Given the new event type is added to `ConductorEvent`, when `EVENT_SINKS` lacks an entry for it, then the TypeScript build fails (total-record guarantee)

### Done When
- [ ] `types/events.ts` carries the `build_review_cache_discarded` variant and `event-sinks.ts` declares it
- [ ] Coordinator test asserts the event payload for each of the two reasons and its absence for every other reason
- [ ] `tsc` passes with the sink declaration; an acceptance test observes the persisted event in `.pipeline/events.jsonl` after a stamp-mismatch lap with a fake provider
