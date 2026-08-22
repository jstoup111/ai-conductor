# Implementation Plan: The judging engine is part of the build_review cache identity

**Date:** 2026-08-21
**Issue:** #1759
**Design:** [ADR](../decisions/adr-2026-08-21-engine-identity-in-build-review-cache-key.md)
**Stories:** .docs/stories/cached-rubric-verdicts-survive-an-engine-change-so.md
**Conflict check:** Clean as of 2026-08-21
**Architecture review:** [APPROVED](../decisions/architecture-review-2026-08-21-cached-rubric-verdicts-survive-an-engine-change-so.md)

## Summary

Eleven tasks that add an `engineIdentity` component (engine dist content stamp + per-rubric SKILL.md digest) to the build_review semantic cache identity, classify its two mismatches under named reasons, emit a `build_review_cache_discarded` event on the spine, and inject the identity once per dispatch from `step-runners.ts`.

## Technical Approach

- **New pure module `src/conductor/src/engine/build-review-engine-identity.ts`** owns the value: `BuildReviewEngineIdentity = { engineStamp: string; skillDigest: string }`, `engineStampFromEngineDir(engineDir)` (the 12-hex suffix of a `dist-versions` id via the existing `versionIdFromEngineDir` in `engine-version-id.ts`, else the constant `dev`), and `digestRubricSkill({ harnessRoot, skillName, readFile })` (`sha256:` over raw bytes of `<harnessRoot>/skills/<skillName>/SKILL.md`, where `skillName` comes from the rubric registry descriptor). Filesystem is injected so tests never touch the host.
- **Cache identity (`build-review-cache.ts`)** gains `engineIdentity` on `BuildReviewCacheEntry` (required on write) and `BuildReviewCacheLookup`. The candidate parser changes from an exact 7-key set to: the 7 keys required, `engineIdentity` optional; when present it must be `{ engineStamp: non-empty string, skillDigest: non-empty string }` or the entry is `invalid-entry`. `classifyBuildReviewCacheLookup` keeps its existing order and appends two checks **after** `policy-fingerprint-mismatch`: `engine-version-mismatch` (absent or different `engineStamp`), then `skill-digest-mismatch`. Exactly one reason is ever returned.
- **Coordinator (`build-review-coordinator.ts`)** takes `engineIdentity` as a new required input field and threads it into the lookup and into every written entry. On a miss whose reason is one of the two new ones it emits `build_review_cache_discarded` before `build_review_rubric_started`; every other miss stays silent. The coordinator's `emit` union and `readCache`/`writeCache` shapes widen accordingly. A rubric whose skill digest could not be computed arrives as an infrastructure failure `cache-read-failed` (existing closed reason; detail names the path) — the vocabulary does not grow (conflict-check resolution; PR #1734's total reason→class map).
- **Event spine**: `types/events.ts` gains `build_review_cache_discarded { rubric; lapId; reason: 'engine-version-mismatch' | 'skill-digest-mismatch'; cachedEngineStamp?: string; currentEngineStamp: string }`; `event-sinks.ts` declares it `render: true, persist: true, audit: true` (the record is total — omission is a compile error). The terminal renderer gets a line naming rubric and reason.
- **Dispatch site (`step-runners.ts`, build_review runner, just before `coordinateBuildReviewRubrics`)** resolves the identity once per dispatch: engine dir from `dirname(fileURLToPath(import.meta.url))` (the same derivation `daemon-lock.ts` and `shipped-record-cli.ts` use — search hint: `OWN_ENGINE_DIR`, `resolveEngineVersion`), harness root via `resolveHarnessRoot()` in `install-freshness.ts`. Per-rubric digests are computed for each dispatchable rubric; a digest failure for a rubric produces that rubric's `cache-read-failed` branch, never a throw.
- **Local pattern basis for the event**: copy the shape of `build_review_disposition_version_invalidated` (additive `ConductorEvent` variant + `EVENT_SINKS` declaration + coordinator emission). Allowed variation: payload fields and render text.
- **Reader-visible upkeep (not a task)**: `docs/reference/artifacts.md` lists persisted build_review events; the build keeps it current alongside Task 6 per CLAUDE.md's documentation rule.
- **Sequencing**: value module → cache types/classification → event type → coordinator → dispatch site → renderer → coordinator-level regression tests.

## Prerequisites
- None. `versionIdFromEngineDir`, `resolveHarnessRoot`, `EVENT_SINKS`, and the rubric registry `skillName` field exist on main.

## Tasks

### Task 1: Engine stamp derivation with the `dev` sentinel
**Story:** 1
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/build-review-engine-identity.test.ts`: `engineStampFromEngineDir('/x/dist-versions/20260820T204302Z-31b5c81beaec/engine')` → `'31b5c81beaec'`; `engineStampFromEngineDir('/repo/src/conductor/dist/engine')` → `'dev'`; the result never contains a `T` or `Z` character.
2. Verify RED.
3. Implement `engineStampFromEngineDir` in `src/conductor/src/engine/build-review-engine-identity.ts` using `versionIdFromEngineDir` and splitting on the last `-`; export `BuildReviewEngineIdentity` type with a branded/validated `parseBuildReviewEngineIdentity(value: unknown)` returning the shape or `undefined` (both fields non-empty strings).
4. Verify GREEN.
5. Commit: "feat(build-review): derive the engine content stamp for cache identity"

**Done when:**
- `build-review-engine-identity.test.ts` asserts the three cases in step 1 and passes.
- `parseBuildReviewEngineIdentity` returns `undefined` for `{}`, `{ engineStamp: '' , skillDigest: 'x' }`, and a non-object, and returns the value for a well-formed pair (tested).
- The module imports nothing from `process.env`, `import.meta`, or `node:fs`.

**Files:**
- src/conductor/src/engine/build-review-engine-identity.ts
- src/conductor/test/engine/build-review-engine-identity.test.ts

**Dependencies:** none

### Task 2: Raw-bytes skill digest through an injected filesystem
**Story:** 2
**Type:** infrastructure

**Steps:**
1. Write failing tests: `digestRubricSkill({ harnessRoot: '/h', skillName: 'build-review-scope', readFile })` reads exactly `/h/skills/build-review-scope/SKILL.md` and returns `sha256:<hex>` equal to `createHash('sha256').update(bytes).digest('hex')`; two inputs differing only by a trailing space produce different digests; a `readFile` rejection propagates as a typed `SkillDigestUnavailable` error carrying the path.
2. Verify RED.
3. Implement in `build-review-engine-identity.ts`; `readFile` returns `Buffer`/`Uint8Array` so no encoding normalization occurs.
4. Verify GREEN.
5. Commit: "feat(build-review): digest rubric skill text for cache identity"

**Done when:**
- Test asserts the exact path read and the `sha256:` prefix plus 64 hex chars.
- Whitespace-only difference test yields two distinct digests.
- Unreadable file test observes the typed error with `.path` equal to the requested path; no other exception type is thrown.

**Files:**
- src/conductor/src/engine/build-review-engine-identity.ts
- src/conductor/test/engine/build-review-engine-identity.test.ts

**Dependencies:** Task 1

### Task 3: Cache entry schema gains `engineIdentity` with a staged parse
**Story:** 4
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/build-review-cache.test.ts`: (a) a legacy 7-key entry parses to a candidate with `engineIdentity: undefined`; (b) an entry with `engineIdentity: { engineStamp: '', skillDigest: 'sha256:..' }` parses to `undefined`; (c) an entry with an unknown extra key parses to `undefined`; (d) `writeBuildReviewCacheEntry` throws for an entry lacking `engineIdentity` and writes no file (fake fs records zero writes).
2. Verify RED.
3. Implement: add `engineIdentity: BuildReviewEngineIdentity` to `BuildReviewCacheEntry`, `engineIdentity?: BuildReviewEngineIdentity` to `BuildReviewCacheEntryCandidate`; replace the exact-key-count check with "all 7 required keys present, only keys from the 8-key allowlist present"; validate `engineIdentity` via `parseBuildReviewEngineIdentity` when the key is present; `parseBuildReviewCacheEntry` (the strict form used on write) requires it.
4. Verify GREEN.
5. Commit: "feat(build-review): admit engineIdentity into the cache entry with a staged parse"

**Done when:**
- Tests (a)–(d) pass; existing cache tests still pass.
- `CACHE_VERSION` is unchanged (legacy entries are distinguished by the absent field, not a version bump).
- `writeBuildReviewCacheEntry` on a well-formed entry persists JSON containing `engineIdentity.engineStamp` and `engineIdentity.skillDigest`.

**Files:**
- src/conductor/src/engine/build-review-cache.ts
- src/conductor/test/engine/build-review-cache.test.ts

**Dependencies:** Task 1

### Task 4: Classify `engine-version-mismatch` after the existing checks
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing tests: with all existing components equal, an entry whose `engineStamp` differs → `{ kind: 'miss', reason: 'engine-version-mismatch' }`; a legacy candidate (no `engineIdentity`) → `engine-version-mismatch`; `engineStamp: 'dev'` vs lookup `31b5c81beaec` → `engine-version-mismatch`; mismatched `policyFingerprint` AND mismatched stamp → `policy-fingerprint-mismatch`; mismatched `projectionDigest` AND mismatched stamp → `projection-digest-mismatch`; a `v2` contract legacy entry → `contract-version-mismatch`.
2. Verify RED.
3. Implement: add `engineIdentity` to `BuildReviewCacheLookup`; add `'engine-version-mismatch'` to `BuildReviewCacheMissReason`; insert the check immediately after the policy check.
4. Verify GREEN.
5. Commit: "feat(build-review): miss cached verdicts produced by a different engine stamp"

**Done when:**
- All six cases in step 1 pass as named.
- `BuildReviewCacheMissReason` contains `engine-version-mismatch` and the union is still a closed string literal union (no `string` widening).
- A hit still restamps `lapId`/`snapshotDigest` and reports `provenance.kind: 'cache-hit'` (existing test unchanged).

**Files:**
- src/conductor/src/engine/build-review-cache.ts
- src/conductor/test/engine/build-review-cache.test.ts

**Dependencies:** Task 3

### Task 5: Classify `skill-digest-mismatch` after the engine check
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing tests: equal stamp, different `skillDigest` → `skill-digest-mismatch`; different stamp AND different digest → `engine-version-mismatch` only; equal stamp and digest with all else equal → hit.
2. Verify RED.
3. Implement the check after the engine-stamp check; add the reason to the union.
4. Verify GREEN.
5. Commit: "feat(build-review): miss cached verdicts when the rubric skill text changed"

**Done when:**
- The three cases pass; exactly one `reason` string is returned per call (type is a single literal, not an array).
- `BuildReviewCacheMissReason` now has exactly two more members than on main: `engine-version-mismatch`, `skill-digest-mismatch`.

**Files:**
- src/conductor/src/engine/build-review-cache.ts
- src/conductor/test/engine/build-review-cache.test.ts

**Dependencies:** Task 4

### Task 6: `build_review_cache_discarded` event type and sink declaration
**Story:** 5
**Type:** infrastructure

**Steps:**
1. Write failing test in `src/conductor/test/engine/event-sinks.test.ts` (or the existing sink test file): `EVENT_SINKS.build_review_cache_discarded` equals `{ render: true, persist: true, audit: true }`; `persistedEventTypes()`, `auditedEventTypes()`, and `renderedEventTypes()` each include it.
2. Verify RED (type error until the variant exists).
3. Implement: add the variant to `ConductorEvent` in `src/conductor/src/types/events.ts` with fields `rubric: string; lapId: string; reason: 'engine-version-mismatch' | 'skill-digest-mismatch'; cachedEngineStamp?: string; currentEngineStamp: string`; add the `EVENT_SINKS` entry. If an event-sink count pin test exists, update its expected count by exactly one.
4. Verify GREEN and `tsc` clean.
5. Commit: "feat(events): add build_review_cache_discarded to the spine"

**Done when:**
- The sink test passes with the exact declaration `{ render: true, persist: true, audit: true }`.
- Removing the `EVENT_SINKS` entry locally makes `tsc` fail (total-record guarantee observed once, then restored).
- `docs/reference/artifacts.md`'s persisted build_review event list names the new event.

**Files:**
- src/conductor/src/types/events.ts
- src/conductor/src/engine/event-sinks.ts
- src/conductor/test/engine/event-sinks.test.ts
- docs/reference/artifacts.md

**Dependencies:** none

### Task 7: Coordinator threads `engineIdentity` and emits the discard event
**Story:** 5
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/build-review-coordinator.test.ts` with a fake `readCache` returning a stamp-mismatched candidate: the emitted sequence for that rubric is `build_review_cache_discarded { rubric, lapId, reason: 'engine-version-mismatch', cachedEngineStamp: '<old>', currentEngineStamp: '<new>' }` then `build_review_rubric_started`; the rubric is dispatched; the written entry's `engineIdentity` equals the input identity. Repeat for `skill-digest-mismatch`. For a legacy candidate, `cachedEngineStamp` is absent. For `projection-digest-mismatch`, `policy-fingerprint-mismatch`, `missing`, and `invalid-entry`, no `build_review_cache_discarded` is emitted. With `emit` omitted, the lap still completes and the rubric is dispatched.
2. Verify RED.
3. Implement: add `engineIdentity: BuildReviewEngineIdentity` to the coordinator input; pass it in the lookup; include it in every `writeCache` entry; widen the `emit` union with the new type; emit on exactly the two reasons.
4. Verify GREEN.
5. Commit: "feat(build-review): discard engine-stale cache entries visibly"

**Done when:**
- Coordinator tests assert the emission for both reasons, its payload fields, and its absence for the four other reasons.
- The hit path is unchanged: an equal-identity candidate still yields `build_review_cache_hit` and no model dispatch (existing test passes with the identity supplied).
- `grep -n build_review_cache_discarded src/conductor/src/engine/build-review-coordinator.ts` shows exactly one emission site.

**Files:**
- src/conductor/src/engine/build-review-coordinator.ts
- src/conductor/test/engine/build-review-coordinator.test.ts

**Dependencies:** Task 5, Task 6

### Task 8: Unreadable skill text settles as `cache-read-failed`, never a hit or a write
**Story:** 2
**Type:** negative-path

**Steps:**
1. Write failing coordinator test: a rubric whose identity resolution failed (input supplies a per-rubric identity result of `{ kind: 'unavailable', path }`) settles as `{ kind: 'infrastructure-failure', reason: 'cache-read-failed', detail: <contains path> }`; `readCache` is never called for it; `writeCache` is never called for it; the other rubrics proceed normally.
2. Verify RED.
3. Implement: the coordinator input carries per-rubric identity as `Record<rubric, { kind: 'ready', identity } | { kind: 'unavailable', path }>`; the unavailable branch short-circuits before the cache read with the existing `cache-read-failed` reason and emits `build_review_rubric_infrastructure_failure` as the existing path does.
4. Verify GREEN.
5. Commit: "feat(build-review): settle an unreadable rubric skill as cache-read-failed"

**Done when:**
- Test observes `reason: 'cache-read-failed'` and a `detail` string containing the SKILL.md path.
- No new member is added to the infrastructure-failure reason union (`git diff main -- src/conductor/src/engine/build-review-coordinator.ts` adds no new reason literal).
- `readCache`/`writeCache` call counts for the unavailable rubric are zero in the test.

**Files:**
- src/conductor/src/engine/build-review-coordinator.ts
- src/conductor/test/engine/build-review-coordinator.test.ts

**Dependencies:** Task 7

### Task 9: Dispatch site resolves the identity once and injects it
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing test at the step-runner seam (follow the existing build_review runner tests' injection style — search hint: `build-review-halt-wiring.test.ts` and `build-review-rubric-fanout-and-dispositions.acceptance.test.ts`): across one build_review dispatch with four enabled rubrics, the engine-stamp resolver is invoked once, each rubric's digest once, and the identity passed to the coordinator equals `{ engineStamp, skillDigest }` per rubric.
2. Verify RED.
3. Implement in `step-runners.ts` immediately before `coordinateBuildReviewRubrics`: `engineDir = dirname(fileURLToPath(import.meta.url))`, `harnessRoot = await resolveHarnessRoot()`, compute stamp once and digests per dispatchable rubric via Task 1/2 helpers, catching `SkillDigestUnavailable` into the `unavailable` shape from Task 8. Keep the resolver injectable through the existing runner deps so tests can stub it.
4. Verify GREEN.
5. Commit: "feat(build-review): inject the engine identity into the rubric coordinator"

**Done when:**
- Runner test asserts one stamp resolution and one digest per rubric per dispatch.
- An acceptance-level run with a fake provider and a pre-seeded stamp-mismatched cache entry leaves a `build_review_cache_discarded` record in `.pipeline/events.jsonl` naming that rubric (assert with the existing acceptance harness for build_review).
- `step-runners.ts` contains no `process.env.CONDUCT_ENGINE_SELF_VERSION` read for this purpose.

**Files:**
- src/conductor/src/engine/step-runners.ts
- src/conductor/test/engine/build-review-halt-wiring.test.ts
- src/conductor/test/acceptance/build-review-engine-identity.acceptance.test.ts

**Dependencies:** Task 8

### Task 10: Terminal render names the rubric and the reason
**Story:** 5
**Type:** happy-path

**Steps:**
1. Write failing test against the terminal event renderer (search hint: `TerminalSubscriber` in `src/conductor/src/ui/subscriber.ts`, `renderedEventTypes`, and the existing render handling of a `render: true` event such as `unattributed_progress`): rendering `build_review_cache_discarded { rubric: 'scope', reason: 'skill-digest-mismatch', ... }` produces a line containing both `scope` and `skill-digest-mismatch`.
2. Verify RED.
3. Implement the `case 'build_review_cache_discarded'` in `src/conductor/src/ui/create-renderer.ts` (beside the existing `unattributed_progress` case) and add the type to the subscriber's rendered-type list in `src/conductor/src/ui/subscriber.ts` if that list is hand-maintained rather than derived from `renderedEventTypes()`.
4. Verify GREEN.
5. Commit: "feat(build-review): log discarded cache verdicts by rubric and cause"

**Done when:**
- Render test asserts both substrings appear in one line.
- A `currentEngineStamp` is included in the line when present.
- No other event's rendered text changes (existing renderer tests pass unchanged).

**Files:**
- src/conductor/src/ui/create-renderer.ts
- src/conductor/src/ui/subscriber.ts
- src/conductor/test/ui/create-renderer.test.ts

**Dependencies:** Task 6

### Task 11: Per-rubric invalidation and same-engine reuse at the coordinator level
**Story:** 3
**Type:** happy-path
**Preserves:** a cached judgement over an unchanged projection is served without a model dispatch and restamped to the current lap

**Steps:**
1. Write failing coordinator tests: (a) four cached rubrics with matching identities → four `build_review_cache_hit`, zero dispatches; (b) only `scope`'s `skillDigest` differs → exactly one dispatch (`scope`), three hits; (c) two identities differing only in a hypothetical timestamp are represented by the same `engineStamp` (construct the stamp via Task 1's helper from two dirs sharing the 12-hex) → hit.
2. Verify RED where applicable.
3. Adjust fixtures only; no production change expected.
4. Verify GREEN.
5. Commit: "test(build-review): per-rubric invalidation and same-engine reuse"

**Done when:**
- Tests (a)–(c) pass and assert dispatch counts exactly.
- The rubric-cache-identity regression (rebase with byte-identical content hits) still passes with identities supplied.

**Files:**
- src/conductor/test/engine/build-review-coordinator.test.ts

**Dependencies:** Task 9

## Task Dependency Graph

```
Task 1 ─┬─> Task 2 ─────────────────────────┐
        └─> Task 3 ─> Task 4 ─> Task 5 ─┐   │
Task 6 ─┬───────────────────────────────┴─> Task 7 ─> Task 8 ─> Task 9 ─> Task 11
        └─> Task 10
```

## Integration Points
- After Task 5: the cache module alone can be driven through all eight miss reasons.
- After Task 7: the coordinator emits discards with a fake cache and fake provider.
- After Task 9: a real build_review dispatch on a warm worktree re-judges after an engine change and records the discard in `events.jsonl`.

## Coverage

| Story criterion | Task |
|---|---|
| S1 HP1, NP1, NP2, NP4 | 4 |
| S1 HP2 | 7, 9 |
| S1 HP3, HP4, NP3 | 1, 11 |
| S2 HP1, NP1, NP3 | 2, 5 |
| S2 HP2 | 11 |
| S2 HP3 | 2 |
| S2 NP2 | 8 |
| S3 HP1, HP2 | 11 |
| S3 HP3 | 9 |
| S3 NP1 | 1, 3 |
| S3 NP2 | 3 |
| S4 HP1, NP3 | 4 |
| S4 HP2 | 7 |
| S4 NP1, NP2 | 3 |
| S5 HP1, NP1, NP2 | 7 |
| S5 HP2, NP3 | 6 |
| S5 HP3 | 10 |

## Verification
- [x] All happy path criteria covered by at least one task
- [x] All negative path criteria covered by at least one task
- [x] No task exceeds 5 minutes of work
- [x] Every task has a `Done when:` block of falsifiable checks
- [x] Dependencies are explicit and acyclic
### Task rem-scope-1: src/conductor/src/engine/smoke-runner.ts:145,152,170 — remove the child temp-directory creation, environment override, and cleanup, restoring the planned smoke-runner behavior and removing any imports made unused
> **Operator decision 2026-08-22 — the candidate-home remediation family is REJECTED.**
> The tasks listed below were appended by `remediate` across build_review laps 2-3. They direct the
> cache identity to be resolved from the effective provider candidate's prepared home after
> self-host preparation and fallback selection. That is a real defect, but satisfying it requires
> extending shared provider execution (`provider-execution.ts`), which this plan does not authorize
> and which the `scope` rubric rejected on the same lap that `rootCause` demanded it. The two
> rubrics were enforcing incompatible designs and no implementation could satisfy both.
>
> This feature keeps its approved design: identity resolved once per dispatch from
> `resolveHarnessRoot()`, before `coordinateBuildReviewRubrics`. The candidate-home gap is filed as
> its own intake, **issue #1804**, with both laps' `rootCause` findings as evidence. The headings
> below are retained deliberately — the engine's completion predicate blocks on a recorded
> remediation id missing from the plan — but they are not work items for this feature.
>
> **Rejected:** `rem-provenance-2`, `rem-provenance-3`, `rem-provenance-4`, `rem-scope-3`,
> `rem-root-cause-1`, `rem-completeness-2`, `rem-completeness-3`, `rem-completeness-4`,
> `rem-completeness-5`.
>
> **Partially satisfied:** `rem-provenance-1` — its `projectDir`-fallback half IS delivered. An
> unresolvable harness root now settles as the `unavailable` identity, which the coordinator routes
> to that rubric's `cache-read-failed` branch, instead of silently digesting a checkout-local or
> nonexistent SKILL.md. Its "installed root used by provider invocation" half is deferred to #1804.
>
> **Delivered against this decision:** the candidate-preparation callback, the post-dispatch
> cache-identity override, and the provider-home skill-root derivation were reverted to the planned
> `resolveHarnessRoot` design (commits `52bafa364`, `05ff3a8b1`, `31d41a854`, `de934745c`,
> `682b0b368`).

### Task rem-provenance-1: src/conductor/src/engine/step-runners.ts:2097-2125 — resolve each enabled rubric's SKILL.md from the same installed skill root used by provider invocation; remove the projectDir fallback and return the existing unavailable identity shape when that root or file cannot be read
### Task rem-provenance-2: src/conductor/test/engine/build-review-halt-wiring.test.ts and src/conductor/test/acceptance/build-review-engine-identity.acceptance.test.ts — prove dist-version engine execution hashes the provider-installed rubric skill root and settles unresolved or unreadable roots as cache-read-failed without cache reuse or writes
### Task rem-coordinator-1: src/conductor/src/engine/build-review-coordinator.ts:51-58,115-120,340-342 — make engineIdentity a required BuildReviewRubricIdentities input, delete TRANSITIONAL_ENGINE_IDENTITY and all omitted or single-identity fallback logic, and update coordinator callers to supply resolved per-rubric identities
### Task rem-completeness-1: src/conductor/test/engine/build-review-coordinator.test.ts:289-320 — rename the existing test to describe only missing, projection, policy, and invalid misses, then add a legacy cache candidate lacking engineIdentity and assert build_review_cache_discarded precedes rubric start with reason engine-version-mismatch, currentEngineStamp present, cachedEngineStamp absent, and the rubric dispatched
### Task rem-scope-2: src/conductor/test/tmpdir-leak-guard.ts:52,151-179, src/conductor/test/global-setup.ts:237-245,323-335, and src/conductor/test/tmpdir-leak-guard.test.ts:66-77 — remove RUN_TMP_ROOT_OWNER_PID_ENV and nested-coordinator ownership branching, restore the pre-branch single run-root lifecycle, and remove the ownership-only regression test
### Task rem-provenance-3: src/conductor/src/engine/step-runners.ts:556,2113-2154,2156-2208 — bind each rubric cache lookup and write to the resolved provider candidate's effective invocation home after candidate self-host preparation; recompute the installed SKILL.md digest when fallback selects another provider and never reuse the first configured provider's ambient-home identity
### Task rem-provenance-4: src/conductor/test/engine/step-runners.test.ts:3253-3331 — add candidate-home and fallback coverage proving two provider candidates with different installed rubric bytes produce their own digests and that the successful candidate's digest alone governs cache reuse/write
### Task rem-completeness-2: src/conductor/test/engine/step-runners.test.ts:3253-3331 and src/conductor/test/acceptance/build-review-engine-identity.acceptance.test.ts:87-125 — drive the build_review runner through the real installed-skill-root resolution with a dist-versions engine fixture, then assert the digested path is <candidateProviderHome>/skills/<rubricSkill>/SKILL.md and the injected engine stamp is the directory's 12-hex content id
### Task rem-scope-3: src/conductor/src/engine/provider-execution.ts:190,631-636, src/conductor/src/engine/step-runners.ts:2121-2161,2187-2237, and src/conductor/src/engine/build-review-coordinator.ts:340-405 — preserve the plan-authorized candidate-preparation seam and provider-installed skill roots while replacing the ambient-first lookup/post-dispatch override split with one candidate-bound cache decision used for both lookup and write; do not restore resolveHarnessRoot
### Task rem-root-cause-1: src/conductor/src/engine/provider-execution.ts:190-194,631-636, src/conductor/src/engine/step-runners.ts:2121-2161,2187-2237, and src/conductor/src/engine/build-review-coordinator.ts:340-405 — perform cache lookup and classification after each provider candidate's self-host preparation and before that candidate's model invocation; derive the digest from that candidate's effective environment, settle a matching candidate cache without model invocation, recompute for every fallback candidate, and carry the same identity into any cache write
### Task rem-completeness-3: src/conductor/src/engine/step-runners.ts:2121-2161,2187-2237 and src/conductor/src/engine/build-review-coordinator.ts:340-405 — remove the first-configured-provider ambient identity from the cache-read path and defer lookup/classification until the effective candidate home has been prepared, so the identical candidate digest governs both cache reuse and persistence
### Task rem-completeness-4: src/conductor/test/engine/step-runners.test.ts:3253-3331 — add two-candidate fallback coverage with different prepared provider homes and installed rubric bytes; make the first candidate unavailable and the second succeed, assert each lookup uses that candidate's digest, and assert cache reuse or write is governed by the successful second candidate's digest alone
### Task rem-completeness-5: src/conductor/test/acceptance/build-review-engine-identity.acceptance.test.ts:87-125 — drive the real build_review runner from a dist-versions/<version-id>/engine fixture through the real installed-skill-root and engine-stamp resolvers; assert the read path is <candidateProviderHome>/skills/<rubricSkill>/SKILL.md and the injected engine stamp is the version directory's 12-hex content suffix
### Task rem-build-review-scope-2: src/conductor/src/engine/build-review-coordinator.ts:55,120,340 — delete TRANSITIONAL_ENGINE_IDENTITY, remove the single-identity/omitted-identity compatibility input, and eliminate the fallback branch
### Task rem-br-root-cause-2: src/conductor/src/engine/build-review-coordinator.ts:120,340-342 — require BuildReviewRubricIdentities and use each rubric's resolved engine identity directly for cache lookup and write with no shared fallback
### Task rem-build-review-completeness-2: src/conductor/test/engine/build-review-coordinator.test.ts:156 — update this and the file's other coordinateBuildReviewRubrics callers that omit engineIdentity to pass explicit per-rubric resolved identities, and assert omitted or single shared identities are no longer accepted
