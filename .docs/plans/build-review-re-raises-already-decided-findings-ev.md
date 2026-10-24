# Implementation Plan: build_review re-raises already-decided findings every lap and never converges

**Date:** 2026-10-24
**Stories:** .docs/stories/build-review-re-raises-already-decided-findings-ev.md
**Conflict check:** Clean as of 2026-10-24 (.docs/conflicts/2026-10-24-build-review-re-raises-already-decided-findings-ev.md)

## Summary

From its second lap at a merge base, build_review judges only the hunks that no earlier lap
settled, and the engine enforces that scope. A finding on settled code blocks only through a cause
hunk in the delta, or when the reviewer rates it critical. A repair-introduced defect joins the
repaired case's #3124 lineage, and the remediate judge sees what prior findings said.

The plan has 26 tasks in two stacked slices. That is above the 20-task advisory line: on 2026-10-24
the operator declined a split, choosing one spec with stacked delivery. Source:
jstoup111/ai-conductor#3294.

## Technical Approach

- **Governing decisions.** `adr-2026-10-24-lap-monotonic-build-review-scope` D1–D10 plus its notes
  on eight approved ADRs. The track's scope boundary is binding:
  - every rubric is scoped, and rubrics receive no case history;
  - the testQuality preflight stays whole-diff;
  - no configuration key or flag;
  - prd_audit and as-built are out of scope.
- **One new pure module, `src/conductor/src/engine/build-review-review-frontier.ts`.** It owns:
  - the per-rubric policy identity;
  - the finding-to-hunk mapping;
  - the settled set;
  - the scope decision;
  - provenance candidates.

  It reads only the active child's lap branch artifacts (`.pipeline/build-review/<lapId>/<rubric>.json`),
  the remediation case store, the dispositions store and the current thresholds. It keeps no ledger
  of its own.
- **Durable record.** Each branch artifact gains `reviewScope` (state, event-spine exception C).
  Hunk identity is the existing `contentHashForHunk` (`+`/`-` text only) plus the path. The record
  carries a `sequence` because laps have no durable order today, and the settled set is a union over
  eligible laps (same merge base and policy identity).
- **Contracts.**
  - Projections move to v5 and carry `reviewScope`.
  - The built-in v4 and custom v2 output schemas gain an optional `causeHunk` in the existing
    content-region shape. It is outside identity, so no finding id re-keys.
- **Reducers.**
  - The built-in reducer (`build-review-aggregate.ts`) and the custom reducer
    (`build-review-effective.ts`) insert `outOfDelta` after settled or carried.
  - `scope-empty` is a new branch outcome: never dispatched, non-failing, announced on
    `build_review_rubric_skipped`.
- **Adjudication.**
  - `outOfDelta` sources are excluded like advisory ones.
  - Provenance stamps `recurrenceOf` through the existing #3124 lineage path.
  - Prior sources gain bounded `finding` digests inside the existing 256 KiB cap.
- **Sequencing.**
  - **Slice 1 (Tasks 1–19):** the frontier, the record, the reducers and the contracts.
    - Task 6 makes the runner record and announce the scope from the start.
    - Until Slice 2's Task 25 passes the decided delta into projections, slice 1 keeps today's
      whole-diff review. A partly merged stack therefore never narrows review without the matching
      admission rules.
  - **Slice 2 (Tasks 20–26):** provenance, digests, and the two production integration points:
    - Task 25 covers the build_review step;
    - Task 26 covers conductor adjudication.
- **Local patterns to follow:**
  - **Closed-key artifact parsers:** search `parseBuildReviewCustomArtifactMember`.
  - **Advisory exclusion from live sources:** search `nonActionable` in
    `build-review-adjudication-coordinator.ts`.
  - **The #3124 lineage seam:** search `classifyBuildReviewRecurrence`, `buildReviewRecurrenceLineage`.
  - **Allowed variation:** helper names and the module split inside the frontier.
  - **Not allowed:**
    - a second hashing of hunks;
    - any read of git commit trailers.

## Prerequisites

- #3291 (#3388), #3124 (#3383), #3298 (#3374), #3271 and #3292 are all on main. No new dependency
  or configuration is needed.

## Slices

| Slice | Title | Tasks |
| --- | --- | --- |
| 1 | Lap-monotonic review scope | 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19 |
| 2 | Repair provenance, judge digests and end-to-end wiring | 20, 21, 22, 23, 24, 25, 26 |

## Tasks

### Task 1: Persist the review scope record in the branch artifact
**Story:** Story 1
**Type:** infrastructure
**Dependencies:** none

**Steps:**
1. Write failing tests in `src/conductor/test/engine/build-review-artifacts.test.ts` for a branch artifact carrying `reviewScope`, for a malformed `reviewScope`, and for a legacy artifact without one.
2. Verify RED.
3. Implement in `build-review-artifacts.ts`: a `BuildReviewReviewScope` type with `mode` (`full` or `delta`), `reason` (closed union `first-lap`, `merge-base-changed`, `version-changed`, `record-unreadable`, `open-source-unmapped`, `delta`), `sequence`, `mergeBase`, `headSha`, `policyIdentity`, `predecessorLapId`, `reviewedHunks`, `deltaHunks` and `outOfDeltaSourceIds`. Hunks are a semantic `ReviewedHunk { path, contentHash }`. `parseBuildReviewBranchArtifact` returns `reviewScope: { kind: "unreadable" }` for a malformed record instead of failing the whole artifact; the reader never writes. Follow the existing closed-key parsers in the same file (search `parseBuildReviewCustomArtifactMember`).
4. Verify GREEN and commit: "feat(build-review): persist the lap review scope in branch artifacts".

**Done when:**
- [test] `writeBuildReviewBranchArtifact` followed by `readBuildReviewBranchArtifact` round-trips a `reviewScope` with mode, reason, sequence, mergeBase, headSha, policyIdentity, predecessorLapId, reviewedHunks, deltaHunks and outOfDeltaSourceIds field-for-field.
- [test] `parseBuildReviewBranchArtifact` given an artifact whose `reviewScope` is malformed returns the artifact with a `reviewScope` of kind `unreadable` instead of throwing, and reading leaves the artifact file byte-identical.
- [test] An artifact written before this change, with no `reviewScope`, parses with `reviewScope` absent.

**Files:** src/conductor/src/engine/build-review-artifacts.ts; src/conductor/test/engine/build-review-artifacts.test.ts

### Task 2: Derive each rubric's policy identity
**Story:** Story 1
**Type:** infrastructure
**Dependencies:** none

**Steps:**
1. Write failing tests in `src/conductor/test/engine/build-review-review-frontier.test.ts` (new) for `buildReviewPolicyIdentity`.
2. Verify RED.
3. Create `src/conductor/src/engine/build-review-review-frontier.ts` and implement `buildReviewPolicyIdentity(rubric, inputs)`. It is a canonical digest of the contract version, projection version, declaration fingerprint, effective skill or policy bundle digest, provider, model and effort, plus for testQuality the test-scope analysis version and binding identity. It reuses the components `build-review-cache.ts` already resolves for the cache key (search `declarationFingerprint`, `effectiveBundleDigest`, `executionPolicyFingerprint`) and deliberately omits `engineStamp`.
4. Verify GREEN and commit: "feat(build-review): derive a per-rubric review policy identity".

**Done when:**
- [test] `buildReviewPolicyIdentity` returns a different identity when the contract version, projection version, declaration fingerprint, effective skill or policy bundle digest, provider, model or effort differs, one fixture per component.
- [test] `buildReviewPolicyIdentity` returns an identical identity for two inputs that differ only in engine identity.
- [test] For testQuality, `buildReviewPolicyIdentity` changes when the test-scope analysis version or binding identity changes.

**Files:** src/conductor/src/engine/build-review-review-frontier.ts; src/conductor/test/engine/build-review-review-frontier.test.ts

### Task 3: Decide a full lap and its reason
**Story:** Story 1
**Type:** happy-path
**Dependencies:** Task 1, Task 2

**Steps:**
1. Write failing tests in `src/conductor/test/engine/build-review-review-frontier.test.ts` for `decideBuildReviewReviewScope` covering each full reason and their precedence.
2. Verify RED.
3. Implement `decideBuildReviewReviewScope(input)` in `src/conductor/src/engine/build-review-review-frontier.ts` as a pure function over the current hunks (from `deriveChangedFileReferences`), the current merge base, head and policy identity, and every readable prior `reviewScope` of the rubric. The latest record is the one with the highest `sequence`. Reasons follow the precedence record-unreadable, first-lap, merge-base-changed, version-changed, open-source-unmapped. The rebase kickback cause is never an input.
4. Verify GREEN and commit: "feat(build-review): decide full review laps with a closed reason".

**Done when:**
- [test] `decideBuildReviewReviewScope` with no readable prior record for R returns mode `full`, reason `first-lap`, sequence 1, the lap's merge base and head, no predecessor lap, `reviewedHunks` and `deltaHunks` equal to every current hunk, and an empty `outOfDeltaSourceIds`.
- [test] `decideBuildReviewReviewScope` returns mode `full` with reason `merge-base-changed` when R's highest-sequence record has a different merge base, for fixtures whose rebase kickback cause is `base-refresh`, `feature-repair` and absent, and it settles nothing from records at the old merge base.
- [test] `decideBuildReviewReviewScope` returns mode `full` with reason `version-changed` when the latest record's policy identity differs in projection version, contract version, skill bundle digest, custom declaration, provider, model or effort.
- [test] `decideBuildReviewReviewScope` returns mode `full` with reason `record-unreadable` when a prior record of R is `unreadable`, and reports reasons by the precedence record-unreadable, first-lap, merge-base-changed, version-changed, open-source-unmapped when several apply.
- [test] A `record-unreadable` full lap lists the unreadable lap ids it saw in its record's `unreadableLapIds`, and the next lap of R ignores an unreadable record already listed there, so it is not `full` because of that record.

**Files:** src/conductor/src/engine/build-review-review-frontier.ts; src/conductor/test/engine/build-review-review-frontier.test.ts

### Task 4: Decide a delta lap against settled hunks
**Story:** Story 1
**Type:** happy-path
**Dependencies:** Task 3, Task 9

**Steps:**
1. Write failing tests in `src/conductor/test/engine/build-review-review-frontier.test.ts` for delta decisions, same-head reuse, infrastructure-failed laps and child scoping.
2. Verify RED.
3. Extend `decideBuildReviewReviewScope` in `src/conductor/src/engine/build-review-review-frontier.ts`: when an eligible record exists, return mode `delta`, reason `delta`, `sequence` one above the highest, `predecessorLapId` the highest-sequence record below the current lap, and `deltaHunks` equal to the current hunks minus `settledBuildReviewHunks` (Task 8). A readable record at the current lap id with the current merge base and policy identity is reused unchanged and excluded from the eligible prior laps. Inputs are the active child's own `.pipeline` records only.
4. Verify GREEN and commit: "feat(build-review): delta-scope later laps against settled hunks".

**Done when:**
- [test] `decideBuildReviewReviewScope` with an L1 record of R at the current merge base and policy identity returns mode `delta`, reason `delta`, sequence 2, `predecessorLapId` L1, and `deltaHunks` equal to the current hunks minus `settledBuildReviewHunks`.
- [test] When only the engine identity differs from L1's record, `decideBuildReviewReviewScope` returns mode `delta`.
- [test] When R already has a readable record at the current lap id, merge base and policy identity, `decideBuildReviewReviewScope` returns that record's mode, reason, sequence, reviewedHunks and deltaHunks unchanged, and excludes that record from the eligible prior laps.
- [test] A prior lap whose R result was an infrastructure failure with no `reviewScope` contributes no reviewed hunks, so a hunk judged only in that lap stays in `deltaHunks`, while a hunk judged in an earlier successful lap at the same merge base is settled.
- [test] `decideBuildReviewReviewScope` for a stacked child reads only that child's branch artifacts and case store, so a sibling child's records settle nothing.

**Files:** src/conductor/src/engine/build-review-review-frontier.ts; src/conductor/test/engine/build-review-review-frontier.test.ts

### Task 5: Register the review-scope occurrence
**Story:** Story 1
**Type:** infrastructure
**Dependencies:** none

**Steps:**
1. Write failing tests in `src/conductor/test/engine/event-persister.test.ts` for the new variant.
2. Verify RED.
3. Add `build_review_review_scope { rubric, lapId, mode, reason, deltaHunkCount, settledHunkCount }` to the `ConductorEvent` union in `src/conductor/src/types/events.ts`, and register it in `event-sinks.ts` with persist true, render false, audit false, otel false, following `build_review_scope_summary`.
4. Verify GREEN and commit: "feat(events): add build_review_review_scope".

**Done when:**
- [test] Emitting `build_review_review_scope` with rubric, lapId, mode, reason, deltaHunkCount and settledHunkCount through `EventPersister` writes exactly one `.pipeline/events.jsonl` line carrying all six fields.
- [test] The `event-sinks.ts` registration for `build_review_review_scope` is persist true and render false, so the operator log renderer writes no line for it.

**Files:** src/conductor/src/types/events.ts; src/conductor/src/engine/event-sinks.ts; src/conductor/test/engine/event-persister.test.ts

### Task 6: The build_review runner decides, records and announces each rubric's scope
**Story:** Story 1
**Type:** happy-path
**Dependencies:** Task 4, Task 5

**Steps:**
1. Write failing step-level tests in `src/conductor/test/engine/build-review-lap-scope-runner.test.ts` (new) that drive the build_review step runner across two laps with a mocked rubric dispatch.
2. Verify RED.
3. In `runRubricBuildReviewInner` (`step-runners.ts`), after the lap id is created and before `coordinateBuildReviewRubrics`, call `decideBuildReviewReviewScope` per enabled rubric, emit `build_review_review_scope`, and pass the decision so every branch-artifact write (fresh, cache-hit and Task 11's `scope-empty`) persists it. This task records and announces the scope; Task 25 wires the delta into projections and reducers.
4. Verify GREEN and commit: "feat(build-review): record and announce each rubric lap scope".

**Done when:**
- [test] Two build_review step runs at the same merge base write `.pipeline/build-review/<lapId>/<rubric>.json` with `reviewScope` mode `full` reason `first-lap` on the first and mode `delta` reason `delta` with predecessor the first lap id on the second, and persist one `build_review_review_scope` event per enabled rubric per lap.
- [test] A step run after the stacked child's parent was restacked with kickback cause `feature-repair`, moving the merge base, records mode `full` reason `merge-base-changed` for every rubric of that child.
- [test] A step run whose prior lap's R artifact holds an unreadable `reviewScope` records R's scope as `full` with reason `record-unreadable`, and the prior artifact file still exists with byte-identical content.
- [test] A second step run at the same head, after a mechanical fault or a disposition-only rejoin, rewrites R's record with the same sequence, reviewedHunks and deltaHunks as the first run at that head.
- [test] When R's dispatch ends as an infrastructure failure, R's branch artifact carries no `reviewScope`, and the next lap's `settledBuildReviewHunks` gains no hunk from that lap.

**Files:** src/conductor/src/engine/step-runners.ts; src/conductor/test/engine/build-review-lap-scope-runner.test.ts

### Task 7: Map every finding to hunks
**Story:** Story 2
**Type:** infrastructure
**Dependencies:** none

**Steps:**
1. Write failing tests in `src/conductor/test/engine/build-review-review-frontier.test.ts` for each rubric kind's mapping.
2. Verify RED.
3. Implement `mapBuildReviewFindingToHunks(finding, changedFiles)` in `src/conductor/src/engine/build-review-review-frontier.ts` returning a closed union: `{ kind: "hunks", hunks }` or `{ kind: "file", path }`. Security and implementationQuality use the anchor's content hash. Custom `sourceRegions` and testQuality anchored test regions intersect new-side hunk ranges (`newStart`, `newCount`) on the same path. Reuse `contentHashForHunk` identity from `build-review-projections.ts`; do not re-hash.
4. Verify GREEN and commit: "feat(build-review): map findings onto diff hunks".

**Done when:**
- [test] `mapBuildReviewFindingToHunks` returns the anchor hunk for a security or implementationQuality finding, keyed by path and `contentHashForHunk`.
- [test] `mapBuildReviewFindingToHunks` returns the hunks whose new-side range intersects a custom finding's `sourceRegions`, or a testQuality finding's anchored test region, on the same path.
- [test] `mapBuildReviewFindingToHunks` returns `{ kind: "file", path }` for a custom or testQuality finding whose region intersects no hunk.
- [test] Two hunks with identical `+`/`-` content at different line numbers map to the same `(path, contentHash)` identity, and two adjacent edits that git fuses into one hunk map to the fused hunk's new content hash only.
- [test] A prior-lap security or implementationQuality source whose anchor `contentHash` is absent from the current diff maps to `{ kind: "file", path }`.

**Files:** src/conductor/src/engine/build-review-review-frontier.ts; src/conductor/test/engine/build-review-review-frontier.test.ts

### Task 8: Settle hunks that every eligible lap judged non-blocking
**Story:** Story 2
**Type:** happy-path
**Dependencies:** Task 1, Task 7

**Steps:**
1. Write failing tests in `src/conductor/test/engine/build-review-review-frontier.test.ts` for each non-blocking route.
2. Verify RED.
3. Implement `settledBuildReviewHunks(input)` in `src/conductor/src/engine/build-review-review-frontier.ts`. Eligible laps are records of the rubric at the current merge base and policy identity. A hunk is settled when an eligible lap reviewed it and every eligible-lap finding mapping to it is non-blocking under the current dispositions, case store (`finalizedBuildReviewSourceIds`, plus a resolved act case with an applied action effect), confidence floor, severity threshold, or that lap's non-critical `outOfDeltaSourceIds`. Prior findings are read from the eligible branch artifacts; ids are recomputed with `judgedFindingIdentityId`.
4. Verify GREEN and commit: "feat(build-review): settle hunks earlier laps judged non-blocking".

**Done when:**
- [test] `settledBuildReviewHunks` settles hunk H for R when an eligible L1 record lists H in `reviewedHunks` and L1 raised no finding mapping to H, and removes H from R's delta.
- [test] `settledBuildReviewHunks` settles H when every eligible-lap finding mapping to H is matched by an exact operator disposition, finalized by `finalizedBuildReviewSourceIds` with disposition reject, defer, refute or advisory, owned by a resolved act case with an applied action effect, below the current confidence floor, or below the current severity threshold, one fixture per route.
- [test] `settledBuildReviewHunks` keeps a line-shifted, content-identical H settled, and does not settle a hunk whose content hash changed since the record, including a hunk fused from H and a settled neighbour, so that hunk is in the delta.
- [test] `settledBuildReviewHunks` evaluated for implementationQuality ignores a security record that lists H, and the settled set is computed from the current dispositions, case store and thresholds passed at call time.
- [test] `settledBuildReviewHunks` settles H when the only eligible-L2 finding mapping to H is a non-critical finding listed in L2's `reviewScope.outOfDeltaSourceIds`, so a third lap L3 does not re-judge H.

**Files:** src/conductor/src/engine/build-review-review-frontier.ts; src/conductor/test/engine/build-review-review-frontier.test.ts

### Task 9: Keep hunks with live or unknown risk in the delta
**Story:** Story 2
**Type:** negative-path
**Dependencies:** Task 8

**Steps:**
1. Write failing tests in `src/conductor/test/engine/build-review-review-frontier.test.ts` for each unsettled route.
2. Verify RED.
3. Extend `settledBuildReviewHunks` and `decideBuildReviewReviewScope` in `src/conductor/src/engine/build-review-review-frontier.ts`: a hunk is never settled while any eligible-lap finding on it still blocks, while an open, `failed` or `reserved` act case (or an applied but still-open act case) owns a source mapping to it, or, for testQuality, while an unresolved marker or indeterminate scope candidate maps to it. A source of an open case whose action effect is not applied that maps at file level, or to an absent anchor, keeps every current hunk on its path in the delta; if the path has no current hunk the lap is `full` with reason `open-source-unmapped`. A source of an applied open case that maps to no current hunk adds nothing (ADR D2).
4. Verify GREEN and commit: "feat(build-review): keep live and unknown risk in the review delta".

**Done when:**
- [test] `settledBuildReviewHunks` does not settle H when a source mapping to H belongs to an open act case, a failed or reserved act case, or an act case with an applied action effect that is still open, one fixture per state, so H stays in R's `deltaHunks`.
- [test] `settledBuildReviewHunks` does not settle H when an L1 finding on H is still blocking, even though a later eligible L2 record lists H with no finding.
- [test] After the severity threshold that made F advisory is lowered to or below F's severity, or removed, `settledBuildReviewHunks` no longer settles F's hunk, so it is in the next delta.
- [test] When an open act case whose action effect is not applied has a source that maps at file level, or to an anchor absent from the current diff, on path P, every current hunk on P is in the delta, and with no current hunk on P `decideBuildReviewReviewScope` returns mode `full` with reason `open-source-unmapped`; the same source of an open case whose action effect is applied adds no hunk beyond the unsettled hunks and forces no full lap.
- [test] For testQuality, `settledBuildReviewHunks` does not settle H while an unresolved marker or indeterminate scope candidate of the current test scope maps to H.

**Files:** src/conductor/src/engine/build-review-review-frontier.ts; src/conductor/test/engine/build-review-review-frontier.test.ts

### Task 10: Projection v5 carries the review scope
**Story:** Story 3
**Type:** happy-path
**Dependencies:** Task 1

**Steps:**
1. Write failing tests in `src/conductor/test/engine/build-review-projections.test.ts` for v5 projections, the custom input and cache identity.
2. Verify RED.
3. In `build-review-projections.ts`, bump the built-in projection version to `v5` and add `reviewScope: { mode, deltaHunks }` to `common()`, keeping `changedFiles` as the whole diff. In `build-review-materialization.ts`, render the same field in `renderBuildReviewFrozenInputScope`. Do not add the field to the provenance-key exclusion list of `projectionDigest`, so it participates in the digest (adr-2026-08-13 D2.1).
4. Verify GREEN and commit: "feat(build-review): carry the review scope in v5 projections".

**Done when:**
- [test] `deriveBuildReviewRubricProjections` for a delta scope returns projectionVersion `v5` projections whose `changedFiles` equals the by-reference parse of the whole frozen diff and whose `reviewScope` is mode `delta` with exactly the supplied delta hunks.
- [test] The custom rubric input rendered by `renderBuildReviewFrozenInputScope` carries the same `reviewScope` mode and delta hunks.
- [test] A serialized delta-lap projection contains no prior findings, case records, dispositions, settled ids, suppression history or prior-lap scope records.
- [test] `projectionDigest` is equal for two projections with the same whole-diff references, delta hunks and versions, and differs when only the delta hunks differ, so `classifyBuildReviewCacheLookup` returns a hit for the first pair and a miss for the second under the same engine identity and policy, and the coordinator dispatches the rubric on the miss.

**Files:** src/conductor/src/engine/build-review-projections.ts; src/conductor/src/engine/build-review-materialization.ts; src/conductor/test/engine/build-review-projections.test.ts

### Task 11: A rubric with an empty delta is scope-empty and is not dispatched
**Story:** Story 3
**Type:** happy-path
**Dependencies:** Task 10

**Steps:**
1. Write failing tests in `src/conductor/test/engine/build-review-coordinator.test.ts` for the `scope-empty` outcome.
2. Verify RED.
3. Add a `scope-empty` member to the branch outcome union in `build-review-coordinator.ts` and to the aggregate `Coverage` type in `build-review-aggregate.ts`. When a rubric's delta is empty, the coordinator makes no dispatch and no preflight call, writes the branch artifact with outcome `scope-empty`, no findings and the scope record, and emits `build_review_rubric_skipped` with reason `scope-empty`. The aggregate treats it as non-failing. The adjudication coordinator excludes a `scope-empty` rubric's sources from the absence-retirement "not raised" input.
4. Verify GREEN and commit: "feat(build-review): skip dispatch for rubrics with nothing unsettled".

**Done when:**
- [test] `coordinateBuildReviewRubrics` with an empty delta for R makes no provider dispatch and no preflight call for R, writes R's branch artifact with outcome `scope-empty`, no findings and its `reviewScope`, and emits `build_review_rubric_skipped` with reason `scope-empty`.
- [test] The aggregate treats a `scope-empty` member as non-failing, and a lap whose every enabled rubric is `scope-empty` returns PASS with zero provider dispatches, no remediate dispatch and zero kickback-ledger charges.
- [test] A `scope-empty` record adds no reviewed hunks: the next lap's `settledBuildReviewHunks` equals the settled set computed before that lap.
- [test] `build-tail-rollup` counts a `scope-empty` rubric as a skip with reason `scope-empty` and never as judged, and the absence-retirement input excludes the sources of a `scope-empty` rubric from the sources not raised this lap.

**Files:** src/conductor/src/engine/build-review-coordinator.ts; src/conductor/src/engine/build-review-aggregate.ts; src/conductor/src/engine/build-review-adjudication-coordinator.ts; src/conductor/test/engine/build-review-coordinator.test.ts

### Task 12: The testQuality preflight keeps whole-diff coverage
**Story:** Story 3
**Type:** negative-path
**Dependencies:** Task 11

**Steps:**
1. Write failing tests in `src/conductor/test/engine/build-review-coordinator.test.ts` for the preflight input in delta laps.
2. Verify RED.
3. In `build-review-coordinator.ts`, keep passing the whole frozen diff and merge base to `materializeTautologyPreflight` regardless of the delta, and skip the call only for a `scope-empty` testQuality branch.
4. Verify GREEN and commit: "fix(build-review): keep the tautology preflight on the whole diff".

**Done when:**
- [test] In a delta lap whose testQuality delta is non-empty, `materializeTautologyPreflight` is called with the whole frozen diff, restoring every changed production file including files with no delta hunk.
- [test] In a delta lap whose testQuality delta is empty, `coordinateBuildReviewRubrics` makes no `materializeTautologyPreflight` call.

**Files:** src/conductor/src/engine/build-review-coordinator.ts; src/conductor/test/engine/build-review-coordinator.test.ts

### Task 13: Rubric skills state the delta contract
**Story:** Story 3
**Type:** happy-path
**Dependencies:** none

**Steps:**
1. Write failing tests in `src/conductor/test/engine/build-review-skill-contract.test.ts` (new) that read the skill files and render prompts for both providers.
2. Verify RED.
3. Add one provider-neutral paragraph to `skills/build-review-security/SKILL.md`, `skills/build-review-implementation-quality/SKILL.md` and `skills/build-review-test-quality/SKILL.md`, and the same text to the custom rubric prompt in `build-review-materialization.ts`: judge the `reviewScope` delta hunks, treat `changedFiles` as context only, and set `causeHunk` to a delta hunk for any finding outside the delta.
4. Verify GREEN and commit: "docs(skills): state the build_review delta contract".

**Done when:**
- [test] Each of the three built-in build-review SKILL.md files and the custom rubric prompt text from `renderBuildReviewFrozenInputScope` contains the instruction to judge the `reviewScope` delta hunks, to treat `changedFiles` as context only, and to set `causeHunk` to a delta hunk for any finding outside the delta.
- [test] The build_review rubric prompt rendered for a Claude candidate and for a Codex candidate embeds the same skill file path and identical contract text.

**Files:** skills/build-review-security/SKILL.md; skills/build-review-implementation-quality/SKILL.md; skills/build-review-test-quality/SKILL.md; src/conductor/src/engine/build-review-materialization.ts; src/conductor/test/engine/build-review-skill-contract.test.ts

### Task 14: Accept an optional cause hunk without re-keying ids
**Story:** Story 4
**Type:** infrastructure
**Dependencies:** none

**Steps:**
1. Write failing tests in `src/conductor/test/engine/build-review-domain.test.ts` for `causeHunk` parsing and identity.
2. Verify RED.
3. In `build-review-domain.ts`, add optional `causeHunk` (the existing content-region reference shape: `path`, `contentHash`, `display`, optional `occurrence`) to `buildReviewJudgedV4Schema` findings, keep it in `finding()` and `BuildReviewFinding`, and add it to the optional keys of `customFinding`. Parse it with the existing `region()` helper. Do not add it to the identity payload.
4. Verify GREEN and commit: "feat(build-review): accept an optional finding cause hunk".

**Done when:**
- [test] `buildReviewJudgedV4Schema` and the custom v2 parser accept a finding with `causeHunk` of shape path, contentHash, display and optional occurrence, and `finding()` keeps it on the parsed finding.
- [test] `judgedFindingIdentityId` returns the same id for a finding with and without `causeHunk`.
- [test] A judged result whose `causeHunk` lacks `contentHash` or carries an extra key is rejected by `diagnoseBuildReviewJudgedResultRejection` as contract-invalid, exactly as for any other malformed finding.

**Files:** src/conductor/src/engine/build-review-domain.ts; src/conductor/test/engine/build-review-domain.test.ts

### Task 15: Classify out-of-delta built-in findings
**Story:** Story 4
**Type:** happy-path
**Dependencies:** Task 7, Task 14

**Steps:**
1. Write failing tests in `src/conductor/test/engine/build-review-aggregate.test.ts` for the built-in reducer.
2. Verify RED.
3. In `deriveEffectiveBuildReviewVerdict` (`build-review-aggregate.ts`), accept the lap's scope per rubric and insert an `outOfDelta` class after settled or carried and before declared replication. In a delta lap a non-critical finding whose mapped hunks (Task 7) are all settled is `outOfDelta` unless its `causeHunk` names a hunk in the lap's delta. A `critical` finding is never `outOfDelta`. A full lap classifies nothing as `outOfDelta`. Return `outOfDeltaFindingIds` beside `advisoryFindingIds`.
4. Verify GREEN and commit: "feat(build-review): classify out-of-delta findings as non-blocking".

**Done when:**
- [test] `deriveEffectiveBuildReviewVerdict` in a delta lap classifies a non-critical security or implementationQuality finding anchored on a settled hunk with no cause hunk as `outOfDelta`, lists its source in the aggregate's `outOfDeltaFindingIds`, and returns an effective verdict in which it does not block.
- [test] The same finding with a `causeHunk` in the lap's delta hunks is classified exactly as without delta scoping and blocks as unresolved, while a `causeHunk` outside the delta or on a path the diff does not change is ignored and the finding is `outOfDelta`.
- [test] A finding with reviewer severity `critical` on a settled hunk without a cause hunk is never `outOfDelta` and is classified exactly as without delta scoping, so an unaccepted, unsettled one blocks, and in a full lap no finding is `outOfDelta`.
- [test] `deriveEffectiveBuildReviewVerdict` classifies in the order accepted, settled or carried, `outOfDelta`, declared replication, suppressed, advisory, unresolved, so a finding whose exact source id is settled or carried is reported settled or carried, not `outOfDelta`.
- [test] The raw aggregate still lists an `outOfDelta` finding among its raw findings with its raw FAIL contribution unchanged; only the effective verdict classifies it `outOfDelta`.

**Files:** src/conductor/src/engine/build-review-aggregate.ts; src/conductor/test/engine/build-review-aggregate.test.ts

### Task 16: Classify out-of-delta custom and testQuality findings
**Story:** Story 4
**Type:** happy-path
**Dependencies:** Task 15

**Steps:**
1. Write failing tests in `src/conductor/test/engine/build-review-effective.test.ts` for the custom reducer and testQuality mapping.
2. Verify RED.
3. Apply the Task 15 class order in the custom reducer in `build-review-effective.ts`, using `mapBuildReviewFindingToHunks` for custom source regions and testQuality test regions, including the file-level fallback and the critical exemption.
4. Verify GREEN and commit: "feat(build-review): classify out-of-delta custom and test findings".

**Done when:**
- [test] `deriveComposedBuildReviewEffectiveVerdict` in a delta lap classifies a non-critical custom finding whose source regions intersect only settled hunks, and a non-critical testQuality finding whose test region intersects only settled hunks, as `outOfDelta` unless its `causeHunk` names a delta hunk.
- [test] A custom or testQuality finding that maps at file level to a path with a delta hunk is in scope and blocks as unresolved.
- [test] The custom reducer applies the same class order as the built-in reducer, so a critical custom or testQuality finding on a settled hunk without a cause hunk is never `outOfDelta` and is classified exactly as without delta scoping, and no finding is `outOfDelta` in a full lap.

**Files:** src/conductor/src/engine/build-review-effective.ts; src/conductor/test/engine/build-review-effective.test.ts

### Task 17: Out-of-delta findings are never judged or charged
**Story:** Story 4
**Type:** negative-path
**Dependencies:** Task 15

**Steps:**
1. Write failing tests in `src/conductor/test/engine/build-review-adjudication-coordinator.test.ts`.
2. Verify RED.
3. In `build-review-adjudication-coordinator.ts`, exclude `outOfDelta` sources from the live sources exactly as advisory sources are excluded (search `nonActionable`).
4. Verify GREEN and commit: "fix(build-review): never judge or charge out-of-delta findings".

**Done when:**
- [test] A coordinator lap whose only non-settled finding is `outOfDelta` passes no live source for it to the remediate dispatch, publishes no BUILD work order, emits no `kickback` event and records zero `chargeEffect` calls.
- [test] A delta lap in which every raised finding is `outOfDelta` completes build_review as PASS without a remediate dispatch.
- [test] An `outOfDelta` finding of any rubric, including testQuality, files no intake issue and appends no remediation task to the plan.

**Files:** src/conductor/src/engine/build-review-adjudication-coordinator.ts; src/conductor/test/engine/build-review-adjudication-coordinator.test.ts

### Task 18: Out-of-delta findings are counted but never accepted risk
**Story:** Story 4
**Type:** negative-path
**Dependencies:** Task 15

**Steps:**
1. Write failing tests in `src/conductor/test/engine/build-review-accepted-risk.test.ts` and for the outer verdict event.
2. Verify RED.
3. Add optional `outOfDeltaCount` to `build_review_outer_verdict` in `src/conductor/src/types/events.ts` and set it where the outer verdict is emitted (`build-review-coordinator.ts`). Exclude `outOfDelta` findings from the accepted-risk listing and its PR section in `build-review-accepted-risk.ts`.
4. Verify GREEN and commit: "feat(build-review): count out-of-delta findings outside accepted risk".

**Done when:**
- [test] `build_review_outer_verdict` for a lap with two `outOfDelta` findings carries `outOfDeltaCount: 2`, and a lap with none omits the field.
- [test] The accepted-risk listing and its published PR section exclude every `outOfDelta` finding.

**Files:** src/conductor/src/types/events.ts; src/conductor/src/engine/build-review-coordinator.ts; src/conductor/src/engine/build-review-accepted-risk.ts; src/conductor/test/engine/build-review-accepted-risk.test.ts

### Task 19: Every verdict reader agrees on out-of-delta
**Story:** Story 4
**Type:** happy-path
**Dependencies:** Task 16

**Steps:**
1. Write failing tests in `src/conductor/test/engine/build-review-effective.test.ts` that drive each reader over one aggregate.
2. Verify RED.
3. Thread the lap scope into the shared resolver in `build-review-effective.ts` so the gate-completion predicate, the conductor build_review exits and clean-PASS settlement (`conductor.ts`) and `ai-conductor build-review findings` (`build-review-cli.ts`) all classify through it; add an out-of-delta section to the findings output.
4. Verify GREEN and commit: "feat(build-review): one out-of-delta classification for every reader".

**Done when:**
- [test] For one aggregate holding an `outOfDelta` finding, the gate-completion predicate, the conductor build_review exit, the adjudication coordinator input, clean-PASS settlement and the `ai-conductor build-review findings` command each report that finding as `outOfDelta`, through the shared `build-review-effective.ts` resolver.
- [test] `ai-conductor build-review findings` lists the `outOfDelta` finding under its own heading, separate from accepted risk.

**Files:** src/conductor/src/engine/build-review-effective.ts; src/conductor/src/engine/build-review-cli.ts; src/conductor/src/engine/conductor.ts; src/conductor/test/engine/build-review-effective.test.ts

### Task 20: Find provenance candidates
**Story:** Story 5
**Type:** happy-path
**Dependencies:** Task 1, Task 7

**Steps:**
1. Write failing tests in `src/conductor/test/engine/build-review-review-frontier.test.ts` for `buildReviewProvenanceCandidates`.
2. Verify RED.
3. Implement `buildReviewProvenanceCandidates(input)` in `src/conductor/src/engine/build-review-review-frontier.ts`. Input: the new case row, its sources' hunk mappings, the lap's delta hunks, the predecessor lap's branch artifacts and the case store. A row qualifies only when it is an unbound `act` row with no exact-source owner (a resolved act case that is the D5.5 authoritative owner of a row source, via `currentBuildReviewSourceLinks`) and a source on a delta hunk of path P. Candidates are act cases with an applied action effect, open or resolved, owning a source raised in the predecessor lap anchored on P. It reads no git history.
4. Verify GREEN and commit: "feat(build-review): find repair provenance candidates".

**Done when:**
- [test] `buildReviewProvenanceCandidates` for a new unbound act case with no exact-source owner and a source on a delta hunk of path P returns every act case with an applied action effect, open or resolved, that owns a source raised in the predecessor lap anchored on P.
- [test] `buildReviewProvenanceCandidates` returns no candidate when no act case with an applied effect owns a source raised in the predecessor lap on P, and excludes an applied act case whose sources were raised only in earlier laps.
- [test] `buildReviewProvenanceCandidates` returns nothing for a case bound by `existingCaseId`, a non-act case, or a case that has an exact-source owner (a resolved act case that is the authoritative owner of a row source).
- [test] `buildReviewProvenanceCandidates` reads only branch artifacts and the case store, so a fixture whose interval commits carry `Task:` trailers naming other tasks returns the same candidates as one without trailers.

**Files:** src/conductor/src/engine/build-review-review-frontier.ts; src/conductor/test/engine/build-review-review-frontier.test.ts

### Task 21: Stamp provenance recurrence and bound its lineage
**Story:** Story 5
**Type:** happy-path
**Dependencies:** Task 20

**Steps:**
1. Write failing tests in `src/conductor/test/engine/build-review-adjudication-coordinator.test.ts`.
2. Verify RED.
3. In the pre-reconcile lineage check of `build-review-adjudication-coordinator.ts` (search `classifyBuildReviewRecurrence`), when no exact-source owner exists, choose the provenance candidate with the most applied attempts in `buildReviewRecurrenceLineage` (lowest case id on a tie) and stamp `recurrenceOf` through the existing reconciler path in `remediation-case-reconciler.ts`. In `remediation-case-validator.ts`, keep a `distinctFrom` entry that names a provenance candidate of the row. The existing limit of 3 and its halt apply unchanged.
4. Verify GREEN and commit: "feat(build-review): bound repair-introduced recurrence lineages".

**Done when:**
- [test] A coordinator lap with one provenance candidate C1 reconciles the judge's unbound act case for S2 with `recurrenceOf` C1 and publishes its BUILD work order.
- [test] With two candidates, the coordinator stamps the one whose `buildReviewRecurrenceLineage` has more applied attempts, and the lowest case id on a tie, and the stamped owner is unchanged when the interval commits carry `Task:` trailers naming other tasks.
- [test] When the chosen lineage already holds three applied attempts, the coordinator halts with `semantic remediation case recurrence limit <id>` naming the lineage before any effect is reserved.
- [test] A judge `distinctFrom` entry naming the provenance candidate with a non-empty reason is kept by the validator, the case is reconciled with no `recurrenceOf`, and the persisted case carries the declaration.
- [test] With no provenance candidate, the reconciled case carries no `recurrenceOf`; with an exact-source owner, `recurrenceOf` names that owner through the existing #3124 path without consulting provenance.

**Files:** src/conductor/src/engine/build-review-adjudication-coordinator.ts; src/conductor/src/engine/remediation-case-validator.ts; src/conductor/src/engine/remediation-case-reconciler.ts; src/conductor/test/engine/build-review-adjudication-coordinator.test.ts

### Task 22: The remediate skill names provenance candidates
**Story:** Story 5
**Type:** happy-path
**Dependencies:** Task 21

**Steps:**
1. Write failing tests in `src/conductor/test/engine/remediate-skill-contract.test.ts` (new).
2. Verify RED.
3. Update the `distinctFrom` paragraph of `skills/remediate/SKILL.md`.
4. Verify GREEN and commit: "docs(skills): remediate distinctFrom may name a provenance candidate".

**Done when:**
- [test] `skills/remediate/SKILL.md` states that a `distinctFrom` entry may name a provenance candidate of the row as well as a resolved act owner of a row source, and that other entries are ignored.
- [test] No provider-specific remediate skill file exists beside `skills/remediate/SKILL.md`.

**Files:** skills/remediate/SKILL.md; src/conductor/test/engine/remediate-skill-contract.test.ts

### Task 23: Prior source digests within a headroom budget
**Story:** Story 6
**Type:** happy-path
**Dependencies:** Task 1

**Steps:**
1. Write failing tests in `src/conductor/test/engine/build-review-adjudication-context.test.ts`.
2. Verify RED.
3. In `build-review-adjudication-context.ts` (`freezePriorCase` and the context builder), add an optional `finding` digest to each of a case's 4 most recent sources, read from the lap branch artifact that raised it. Compute the budget after every prior case, current source and the plan context are serialized: the smaller of 64 KiB and the remaining headroom under `maxSerializedBytes`, recomputed for the expansion round. Drop the oldest digests first and report `priorDigestsOmitted`.
4. Verify GREEN and commit: "feat(build-review): give the judge prior finding digests within budget".

**Done when:**
- [test] `buildBuildReviewAdjudicationContext` gives each of a prior case's 4 most recent sources a `finding` digest with rubric, concernKind, a summary truncated to 1000 bytes, at most 8 evidenceLocations and lapId, read from the source's lap branch artifact, and gives older sources none.
- [test] When every digest fits the budget, every eligible source carries one and `priorDigestsOmitted` is 0; when they exceed it, the oldest digests are dropped first until the budget holds, `priorDigestsOmitted` equals the number dropped, and the context still builds.
- [test] A source whose lap artifact is missing or unreadable carries no digest and the context still builds.
- [test] The digest budget is the smaller of 64 KiB and the headroom under `maxSerializedBytes` after every prior case, current source and the plan context, recomputed for the expansion round, so a context at the maximum case history that serializes within the limit without digests also serializes within it with digests.

**Files:** src/conductor/src/engine/build-review-adjudication-context.ts; src/conductor/test/engine/build-review-adjudication-context.test.ts

### Task 24: The remediate skill treats digests as binding context
**Story:** Story 6
**Type:** happy-path
**Dependencies:** Task 22, Task 23

**Steps:**
1. Write failing tests in `src/conductor/test/engine/remediate-skill-contract.test.ts`.
2. Verify RED.
3. Describe the prior-source `finding` digest in `skills/remediate/SKILL.md`.
4. Verify GREEN and commit: "docs(skills): remediate reads prior finding digests as context".

**Done when:**
- [test] `skills/remediate/SKILL.md` describes the prior-source `finding` digest fields and states that digests are context for binding an equivalent re-raise, never report text.
- [test] The remediate prompt rendered for a Claude candidate and for a Codex candidate embeds the same remediate skill file.

**Files:** skills/remediate/SKILL.md; src/conductor/test/engine/remediate-skill-contract.test.ts

### Task 25: Wire the delta scope through the build_review step
**Story:** Story 7
**Type:** happy-path
**Dependencies:** Task 6, Task 10, Task 11, Task 12, Task 16, Task 17, Task 18

**Steps:**
1. Write failing step-level tests in `src/conductor/test/engine/build-review-lap-scope-runner.test.ts` that run two or more build_review laps through the step runner with mocked rubric dispatch.
2. Verify RED.
3. In `runRubricBuildReviewInner` (`step-runners.ts`) and `coordinateBuildReviewRubrics`, pass each rubric's decided scope into projection derivation, the `scope-empty` branch and the effective-verdict resolver, and write the lap's `outOfDeltaSourceIds` into each rubric's `reviewScope`. This is the production integration point that makes Stories 1 to 4 observable through the build_review step.
4. Verify GREEN and commit: "feat(build-review): judge later laps on the unsettled delta".

**Done when:**
- [test] In a two-lap build_review step fixture, L2's rubric projections carry the frontier's delta, a re-raise on unchanged hunk H of an implementationQuality finding whose case the judge finalized `reject` is classified `outOfDelta` under a different concern kind and wording, and L2 ends without a halt and with zero kickback charges, and a third lap L3 with H unchanged keeps H out of the delta.
- [test] In the same fixture with an L1 finding accepted by exact operator disposition, L2's re-raise on unchanged H under a new id is `outOfDelta` and L2 passes with no new disposition recorded.
- [test] After an L1 kickback whose repair changed only hunk H2, an L2 with no new defect dispatches each rubric with delta hunks exactly H2 and build_review passes on L2; a custom rubric whose ids change every lap raises nothing blocking on L1's settled hunks when the only change is in another file.
- [test] The step writes each rubric's `reviewScope.outOfDeltaSourceIds` with the lap's `outOfDelta` sources, and a delta lap whose every raised finding is `outOfDelta` passes without a remediate dispatch.
- [test] After a base refresh or a parent restack between L1 and L2, L2 is a full lap and an unchanged finding on unchanged H keeps its L1 id and is settled by the existing exact-id predicate.

**Files:** src/conductor/src/engine/step-runners.ts; src/conductor/src/engine/build-review-coordinator.ts; src/conductor/test/engine/build-review-lap-scope-runner.test.ts

### Task 26: Wire provenance and digests through conductor adjudication
**Story:** Story 7
**Type:** happy-path
**Dependencies:** Task 21, Task 23, Task 25

**Steps:**
1. Write failing conductor-level tests in `src/conductor/test/engine/build-review-lap-scope-runner.test.ts` that run build_review laps through the conductor with mocked rubric and remediate dispatch.
2. Verify RED.
3. In `conductor.ts`, pass the predecessor lap id and the lap scope into `coordinateBuildReviewAdjudication`, and build the remediate context with prior-source digests (Task 23). This is the production integration point that makes Stories 5 and 6 observable through the conductor.
4. Verify GREEN and commit: "feat(build-review): wire repair provenance and digests into adjudication".

**Done when:**
- [test] In a two-lap conductor build_review fixture where L1's act case was applied and its repair introduced a defect on hunk H2, L2's finding on H2 kicks back to BUILD and the reconciled case carries `recurrenceOf` the repaired case.
- [test] When an L2 change in the delta breaks unchanged code on settled hunk H and the reviewer names that delta hunk as `causeHunk`, the finding blocks and kicks back.
- [test] In a repair chain fixture where each repair introduces a new defect on the hunk it changed, the fourth applied attempt in the lineage halts with `semantic remediation case recurrence limit` instead of a further kickback.
- [test] The conductor's remediate dispatch receives the adjudication context with prior-source digests, including when `priorDigestsOmitted` is non-zero.

**Files:** src/conductor/src/engine/conductor.ts; src/conductor/src/engine/build-review-adjudication-coordinator.ts; src/conductor/test/engine/build-review-lap-scope-runner.test.ts

## Task Dependency Graph

```text
Slice 1
  1 ─┬─> 3 ─> 4 ─> 6 <─ 5
  2 ─┘          ^
  7 ─> 8 ─> 9 ──┘
  1 ─> 10 ─> 11 ─> 12
  13
  14 ─┬─> 15 ─┬─> 16 ─> 19
  7 ──┘       ├─> 17
              └─> 18
Slice 2
  1, 7 ─> 20 ─> 21 ─> 22 ─> 24 <─ 23 <─ 1
  6, 10, 11, 12, 16, 17, 18 ─> 25
  21, 23, 25 ─> 26
```

## Integration Points

- **After Task 6:** every build_review lap records and announces each rubric's scope
  (`reviewScope`, `build_review_review_scope`). Review stays whole-diff.
- **After Task 19:** every verdict reader classifies `outOfDelta` identically.
- **After Task 25:** later laps judge only the unsettled delta through the build_review step.
- **After Task 26:** repair provenance and prior finding digests reach adjudication through the
  conductor.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a feature's first build_review lap, when R is judged, then R's scope record has mode `full`, reason `first-lap`, sequence 1, the lap's merge base and head, no predecessor lap, every current hunk in reviewed hunks, and an empty out-of-delta list. | 3 | "`decideBuildReviewReviewScope` with no readable prior record for R returns mode `full`, reason `first-lap`, sequence 1, the lap's merge base and head, no predecessor lap, `reviewedHunks` and `deltaHunks` equal to every current hunk, and an empty `outOfDeltaSourceIds`." | diff-local |
| Story 1 happy: Given L1 recorded R at merge base M and L2 reviews the same merge base M with unchanged contract and projection versions, when L2 decides R's scope, then R's mode is `delta` with reason `delta` and its predecessor lap is L1. | 4 | "`decideBuildReviewReviewScope` with an L1 record of R at the current merge base and policy identity returns mode `delta`, reason `delta`, sequence 2, `predecessorLapId` L1, and `deltaHunks` equal to the current hunks minus `settledBuildReviewHunks`." | diff-local |
| Story 1 happy: Given L1 recorded R at merge base M and L2 reviews a different merge base, when L2 decides R's scope, then R's mode is `full` with reason `merge-base-changed`, whatever cause the rebase kickback recorded, including `feature-repair` on a restacked child. | 3 | "`decideBuildReviewReviewScope` returns mode `full` with reason `merge-base-changed` when R's highest-sequence record has a different merge base, for fixtures whose rebase kickback cause is `base-refresh`, `feature-repair` and absent, and it settles nothing from records at the old merge base." | diff-local |
| Story 1 happy: Given any lap's scope decision for R, when it is made, then one `build_review_review_scope` event is persisted carrying the rubric, lap id, mode, reason, delta hunk count and settled hunk count, and it is not rendered to the operator log. | 5, 6 | "Emitting `build_review_review_scope` with rubric, lapId, mode, reason, deltaHunkCount and settledHunkCount through `EventPersister` writes exactly one `.pipeline/events.jsonl` line carrying all six fields." | diff-local |
| Story 1 negative: Given L1's scope record for R is missing because the worktree's pipeline state was recreated, when L2 decides R's scope, then R's mode is `full` with reason `first-lap` and every current hunk is reviewed. | 3 | "`decideBuildReviewReviewScope` with no readable prior record for R returns mode `full`, reason `first-lap`, sequence 1, the lap's merge base and head, no predecessor lap, `reviewedHunks` and `deltaHunks` equal to every current hunk, and an empty `outOfDeltaSourceIds`." | diff-local |
| Story 1 negative: Given L1's branch artifact for R exists but its scope record cannot be parsed, when L2 decides R's scope, then R's mode is `full` with reason `record-unreadable`, and the unreadable artifact is neither rewritten nor deleted. | 6, 1 | "A step run whose prior lap's R artifact holds an unreadable `reviewScope` records R's scope as `full` with reason `record-unreadable`, and the prior artifact file still exists with byte-identical content." | diff-local |
| Story 1 negative: Given L2 ran a `record-unreadable` full lap for L1's unreadable record of R, when L3 decides R's scope, then L1's record is ignored and L3 is not `full` because of it. | 3 | "A `record-unreadable` full lap lists the unreadable lap ids it saw in its record's `unreadableLapIds`, and the next lap of R ignores an unreadable record already listed there, so it is not `full` because of that record." | diff-local |
| Story 1 negative: Given L1 recorded R under projection v5 and L2 runs under a different projection or contract version, when L2 decides R's scope, then R's mode is `full` with reason `version-changed`. | 3 | "`decideBuildReviewReviewScope` returns mode `full` with reason `version-changed` when the latest record's policy identity differs in projection version, contract version, skill bundle digest, custom declaration, provider, model or effort." | diff-local |
| Story 1 negative: Given L1 failed R with an infrastructure fault and so recorded no scope for R, when L2 decides R's scope, then L1 contributes no reviewed hunks for R and only earlier successful laps of R at merge base M can settle anything. | 4 | "A prior lap whose R result was an infrastructure failure with no `reviewScope` contributes no reviewed hunks, so a hunk judged only in that lap stays in `deltaHunks`, while a hunk judged in an earlier successful lap at the same merge base is settled." | diff-local |
| Story 1 negative: Given a rebase that moved the merge base of a stacked child whose kickback cause is `feature-repair`, when the child's next lap decides scope, then no rubric of that child is delta-scoped against records from the old merge base. | 6 | "A step run after the stacked child's parent was restacked with kickback cause `feature-repair`, moving the merge base, records mode `full` reason `merge-base-changed` for every rubric of that child." | diff-local |
| Story 1 negative: Given R already has a readable scope record at the current lap id, merge base and policy identity, as after a mechanical retry, a halt-clear re-dispatch or a disposition-only rejoin, when the lap decides R's scope, then it reuses that record's scope unchanged and R's earlier reviewed hunks are not lost. | 4, 6 | "When R already has a readable record at the current lap id, merge base and policy identity, `decideBuildReviewReviewScope` returns that record's mode, reason, sequence, reviewedHunks and deltaHunks unchanged, and excludes that record from the eligible prior laps." | diff-local |
| Story 1 negative: Given L1 recorded R and before L2 the rubric's skill bundle digest, custom declaration, or provider, model or effort changes, when L2 decides R's scope, then R's mode is `full` with reason `version-changed`. | 3, 2 | "`decideBuildReviewReviewScope` returns mode `full` with reason `version-changed` when the latest record's policy identity differs in projection version, contract version, skill bundle digest, custom declaration, provider, model or effort." | diff-local |
| Story 1 negative: Given L1 recorded R and before L2 only the engine build identity changes, when L2 decides R's scope, then R's mode is `delta`. | 4, 2 | "When only the engine identity differs from L1's record, `decideBuildReviewReviewScope` returns mode `delta`." | diff-local |
| Story 2 happy: Given L1 reviewed H for R at merge base M and raised no finding on H, when L2 at M decides R's scope with H unchanged, then H is settled and absent from R's delta hunks. | 8 | "`settledBuildReviewHunks` settles hunk H for R when an eligible L1 record lists H in `reviewedHunks` and L1 raised no finding mapping to H, and removes H from R's delta." | diff-local |
| Story 2 happy: Given L1 raised finding F on H and the operator accepted F by exact disposition, or the judge finalized F's source with disposition `reject`, `defer`, `refute` or `advisory`, when L2 at M decides scope with H unchanged, then H is settled. | 8 | "`settledBuildReviewHunks` settles H when every eligible-lap finding mapping to H is matched by an exact operator disposition, finalized by `finalizedBuildReviewSourceIds` with disposition reject, defer, refute or advisory, owned by a resolved act case with an applied action effect, below the current confidence floor, or below the current severity threshold, one fixture per route." | diff-local |
| Story 2 happy: Given L1 raised finding F on H and F's case is a resolved `act` case with an applied action effect, when L2 at M decides scope with H unchanged, then H is settled. | 8 | "`settledBuildReviewHunks` settles H when every eligible-lap finding mapping to H is matched by an exact operator disposition, finalized by `finalizedBuildReviewSourceIds` with disposition reject, defer, refute or advisory, owned by a resolved act case with an applied action effect, below the current confidence floor, or below the current severity threshold, one fixture per route." | diff-local |
| Story 2 happy: Given L1 raised finding F on H and F was below R's confidence floor or below R's severity threshold in L1, when L2 decides scope with both thresholds unchanged, then H is settled. | 8 | "`settledBuildReviewHunks` settles H when every eligible-lap finding mapping to H is matched by an exact operator disposition, finalized by `finalizedBuildReviewSourceIds` with disposition reject, defer, refute or advisory, owned by a resolved act case with an applied action effect, below the current confidence floor, or below the current severity threshold, one fixture per route." | diff-local |
| Story 2 happy: Given H is settled after L2 and its content changes before L3, when L3 decides R's scope, then the changed hunk is in R's delta hunks. | 8, 4 | "`settledBuildReviewHunks` keeps a line-shifted, content-identical H settled, and does not settle a hunk whose content hash changed since the record, including a hunk fused from H and a settled neighbour, so that hunk is in the delta." | diff-local |
| Story 2 happy: Given a pure rebase that keeps H's `+`/`-` content but shifts its line numbers, when H is compared with prior records at the same merge base, then H keeps its identity and its settled state. | 8 | "`settledBuildReviewHunks` keeps a line-shifted, content-identical H settled, and does not settle a hunk whose content hash changed since the record, including a hunk fused from H and a settled neighbour, so that hunk is in the delta." | diff-local |
| Story 2 negative: Given L1 raised F on H and F's case is an open `act` case, or a `failed` or `reserved` act case, when L2 decides scope with H unchanged, then H is not settled and stays in R's delta hunks. | 9 | "`settledBuildReviewHunks` does not settle H when a source mapping to H belongs to an open act case, a failed or reserved act case, or an act case with an applied action effect that is still open, one fixture per state, so H stays in R's `deltaHunks`." | diff-local |
| Story 2 negative: Given L1 raised F on H and F's case is an `act` case whose action effect is applied but which is still open, when L2 decides scope, then H is not settled and stays in R's delta hunks. | 9 | "`settledBuildReviewHunks` does not settle H when a source mapping to H belongs to an open act case, a failed or reserved act case, or an act case with an applied action effect that is still open, one fixture per state, so H stays in R's `deltaHunks`." | diff-local |
| Story 2 negative: Given L1 settled H only because F was below R's severity threshold, and the operator then lowers or removes that threshold so F is no longer below it, when L2 decides scope, then H is not settled and is judged again. | 9 | "After the severity threshold that made F advisory is lowered to or below F's severity, or removed, `settledBuildReviewHunks` no longer settles F's hunk, so it is in the next delta." | diff-local |
| Story 2 negative: Given H was settled by security in L1, when L2 decides implementationQuality's scope, then security's record does not settle H for implementationQuality. | 8 | "`settledBuildReviewHunks` evaluated for implementationQuality ignores a security record that lists H, and the settled set is computed from the current dispositions, case store and thresholds passed at call time." | diff-local |
| Story 2 negative: Given two adjacent edits fuse H and a neighbouring settled hunk into one hunk with a new content hash, when the next lap decides scope, then the fused hunk is in the delta and neither original hunk's settled state is applied to it. | 8, 7 | "`settledBuildReviewHunks` keeps a line-shifted, content-identical H settled, and does not settle a hunk whose content hash changed since the record, including a hunk fused from H and a settled neighbour, so that hunk is in the delta." | diff-local |
| Story 2 negative: Given L1 raised a blocking finding F on H that is still unresolved, and L2 judged H and raised nothing, when L3 decides scope with H unchanged, then H is not settled, because F from L1 still blocks. | 9 | "`settledBuildReviewHunks` does not settle H when an L1 finding on H is still blocking, even though a later eligible L2 record lists H with no finding." | diff-local |
| Story 2 negative: Given an open act case whose action effect is not applied and whose source maps to no current hunk on path P, when R's scope is decided, then every current hunk on P is in R's delta, and when P has no current hunk R's lap is `full` with reason `open-source-unmapped`. | 9 | "When an open act case whose action effect is not applied has a source that maps at file level, or to an anchor absent from the current diff, on path P, every current hunk on P is in the delta, and with no current hunk on P `decideBuildReviewReviewScope` returns mode `full` with reason `open-source-unmapped`; the same source of an open case whose action effect is applied adds no hunk beyond the unsettled hunks and forces no full lap." | diff-local |
| Story 2 negative: Given an open act case whose action effect is applied and whose source's anchor hunk the repair rewrote, when R's scope is decided, then that source adds no hunk to R's delta beyond the unsettled hunks, and R's lap is not `full` because of it. | 9 | "When an open act case whose action effect is not applied has a source that maps at file level, or to an anchor absent from the current diff, on path P, every current hunk on P is in the delta, and with no current hunk on P `decideBuildReviewReviewScope` returns mode `full` with reason `open-source-unmapped`; the same source of an open case whose action effect is applied adds no hunk beyond the unsettled hunks and forces no full lap." | diff-local |
| Story 2 negative: Given testQuality's current test scope holds an unresolved marker or an indeterminate candidate that maps to H, when testQuality's scope is decided, then H is not settled. | 9 | "For testQuality, `settledBuildReviewHunks` does not settle H while an unresolved marker or indeterminate scope candidate of the current test scope maps to H." | diff-local |
| Story 3 happy: Given L2 is a delta lap for R, when R's projection is derived, then it is projection v5 with `changedFiles` listing the whole diff and a `reviewScope` naming mode `delta` and exactly R's delta hunks. | 10 | "`deriveBuildReviewRubricProjections` for a delta scope returns projectionVersion `v5` projections whose `changedFiles` equals the by-reference parse of the whole frozen diff and whose `reviewScope` is mode `delta` with exactly the supplied delta hunks." | diff-local |
| Story 3 happy: Given L2 is a delta lap for a custom rubric, when its input is assembled, then the input carries the same `reviewScope` with mode and delta hunks. | 10 | "The custom rubric input rendered by `renderBuildReviewFrozenInputScope` carries the same `reviewScope` mode and delta hunks." | diff-local |
| Story 3 happy: Given L2 is a delta lap for R and R's delta is empty, when the coordinator reaches R, then R is not dispatched and runs no preflight, its branch outcome is `scope-empty` with no findings and with its scope record, `build_review_rubric_skipped` is emitted with reason `scope-empty`, and R counts as non-failing in the aggregate. | 11 | "`coordinateBuildReviewRubrics` with an empty delta for R makes no provider dispatch and no preflight call for R, writes R's branch artifact with outcome `scope-empty`, no findings and its `reviewScope`, and emits `build_review_rubric_skipped` with reason `scope-empty`." | diff-local |
| Story 3 happy: Given an earlier lap of R with the same v5 projection digest, covering the whole-diff references and the delta, and with the same engine identity and policy, when L2 looks up R's cache, then the earlier judged result is reused as a cache hit. | 10 | "`projectionDigest` is equal for two projections with the same whole-diff references, delta hunks and versions, and differs when only the delta hunks differ, so `classifyBuildReviewCacheLookup` returns a hit for the first pair and a miss for the second under the same engine identity and policy, and the coordinator dispatches the rubric on the miss." | diff-local |
| Story 3 happy: Given the rubric and remediate skill contracts, when a Claude dispatch and a Codex dispatch render R, then both read the same skill text, which tells the rubric to judge the delta hunks, to treat the whole diff as context only, and to name a cause hunk in the delta for any finding outside it. | 13 | "Each of the three built-in build-review SKILL.md files and the custom rubric prompt text from `renderBuildReviewFrozenInputScope` contains the instruction to judge the `reviewScope` delta hunks, to treat `changedFiles` as context only, and to set `causeHunk` to a delta hunk for any finding outside the delta." | diff-local |
| Story 3 negative: Given L2 is a delta lap for R, when R's projection is serialized, then it contains no prior findings, case records, dispositions, settled ids, suppression history or scope records of earlier laps. | 10 | "A serialized delta-lap projection contains no prior findings, case records, dispositions, settled ids, suppression history or prior-lap scope records." | diff-local |
| Story 3 negative: Given L1 and L2 have identical diffs but different delta hunks for R, when L2 looks up R's cache, then the lookup misses and R is judged again. | 10 | "`projectionDigest` is equal for two projections with the same whole-diff references, delta hunks and versions, and differs when only the delta hunks differ, so `classifyBuildReviewCacheLookup` returns a hit for the first pair and a miss for the second under the same engine identity and policy, and the coordinator dispatches the rubric on the miss." | diff-local |
| Story 3 negative: Given L2 is a delta lap and testQuality's counterfactual preflight runs, when the preflight restores merge-base production content, then it covers every changed production file of the whole diff, not only files with delta hunks. | 12 | "In a delta lap whose testQuality delta is non-empty, `materializeTautologyPreflight` is called with the whole frozen diff, restoring every changed production file including files with no delta hunk." | diff-local |
| Story 3 negative: Given every enabled rubric has an empty delta in L2, when the lap completes, then the lap passes with no rubric dispatch, no remediate dispatch and no kickback charge. | 11 | "The aggregate treats a `scope-empty` member as non-failing, and a lap whose every enabled rubric is `scope-empty` returns PASS with zero provider dispatches, no remediate dispatch and zero kickback-ledger charges." | diff-local |
| Story 3 negative: Given R recorded a `scope-empty` result in L2, when L3 decides R's scope, then L2 adds no reviewed hunks for R and the hunks settled before L2 remain settled. | 11 | "A `scope-empty` record adds no reviewed hunks: the next lap's `settledBuildReviewHunks` equals the settled set computed before that lap." | diff-local |
| Story 3 negative: Given R is `scope-empty` in L2, when judged-rate metrics and absence retirement are computed for L2, then R is counted as a skip with reason `scope-empty` and never as judged, and R gives no evidence that any of its sources is no longer raised. | 11 | "`build-tail-rollup` counts a `scope-empty` rubric as a skip with reason `scope-empty` and never as judged, and the absence-retirement input excludes the sources of a `scope-empty` rubric from the sources not raised this lap." | diff-local |
| Story 4 happy: Given L2 is a delta lap for security or implementationQuality and a non-critical finding is anchored on a settled hunk without a cause hunk, when the effective verdict is derived, then the finding is classified `outOfDelta`, is recorded in the lap's out-of-delta ids and the aggregate, and does not block. | 15, 25 | "`deriveEffectiveBuildReviewVerdict` in a delta lap classifies a non-critical security or implementationQuality finding anchored on a settled hunk with no cause hunk as `outOfDelta`, lists its source in the aggregate's `outOfDeltaFindingIds`, and returns an effective verdict in which it does not block." | diff-local |
| Story 4 happy: Given the same finding names as its cause hunk a hunk that is in L2's delta hunks, when the effective verdict is derived, then the finding is classified exactly as it would be without delta scoping and can block. | 15 | "The same finding with a `causeHunk` in the lap's delta hunks is classified exactly as without delta scoping and blocks as unresolved, while a `causeHunk` outside the delta or on a path the diff does not change is ignored and the finding is `outOfDelta`." | diff-local |
| Story 4 happy: Given a non-critical custom rubric finding whose source regions intersect only settled hunks, or a non-critical testQuality finding whose anchored test region intersects only settled hunks, when L2's effective verdict is derived, then the finding is `outOfDelta` unless it names a delta cause hunk. | 16 | "`deriveComposedBuildReviewEffectiveVerdict` in a delta lap classifies a non-critical custom finding whose source regions intersect only settled hunks, and a non-critical testQuality finding whose test region intersects only settled hunks, as `outOfDelta` unless its `causeHunk` names a delta hunk." | diff-local |
| Story 4 happy: Given a lap with out-of-delta findings, when `build_review_outer_verdict` is emitted, then it carries their count. | 18 | "`build_review_outer_verdict` for a lap with two `outOfDelta` findings carries `outOfDeltaCount: 2`, and a lap with none omits the field." | diff-local |
| Story 4 happy: Given a finding with a cause hunk, when its id is computed, then the id equals the id the same finding would have without the cause hunk. | 14 | "`judgedFindingIdentityId` returns the same id for a finding with and without `causeHunk`." | diff-local |
| Story 4 happy: Given an `outOfDelta` finding, when the gate-completion predicate, the conductor exits, the adjudication coordinator, clean-PASS settlement and `build-review findings` each classify it, then all of them report it as `outOfDelta`. | 19 | "For one aggregate holding an `outOfDelta` finding, the gate-completion predicate, the conductor build_review exit, the adjudication coordinator input, clean-PASS settlement and the `ai-conductor build-review findings` command each report that finding as `outOfDelta`, through the shared `build-review-effective.ts` resolver." | diff-local |
| Story 4 negative: Given an `outOfDelta` finding in L2, when the lap is adjudicated, then the finding is not among the remediate judge's live sources, routes no BUILD work, emits no kickback and charges nothing to the kickback ledger. | 17 | "A coordinator lap whose only non-settled finding is `outOfDelta` passes no live source for it to the remediate dispatch, publishes no BUILD work order, emits no `kickback` event and records zero `chargeEffect` calls." | diff-local |
| Story 4 negative: Given an `outOfDelta` finding, when operator accepted risk is listed or published, then the finding does not appear as accepted risk. | 18 | "The accepted-risk listing and its published PR section exclude every `outOfDelta` finding." | diff-local |
| Story 4 negative: Given a non-critical finding that names a cause hunk not present in L2's delta hunks, or a cause hunk on a path the diff does not change, when the effective verdict is derived, then the cause is ignored and the finding is `outOfDelta`. | 15 | "The same finding with a `causeHunk` in the lap's delta hunks is classified exactly as without delta scoping and blocks as unresolved, while a `causeHunk` outside the delta or on a path the diff does not change is ignored and the finding is `outOfDelta`." | diff-local |
| Story 4 negative: Given a custom or testQuality finding whose region intersects no hunk and whose path has a delta hunk, when L2's effective verdict is derived, then the finding is in scope and can block. | 16 | "A custom or testQuality finding that maps at file level to a path with a delta hunk is in scope and blocks as unresolved." | diff-local |
| Story 4 negative: Given a full lap, whether the first lap or one forced by a merge-base change, when the effective verdict is derived, then no finding is classified `outOfDelta`. | 15, 16 | "A finding with reviewer severity `critical` on a settled hunk without a cause hunk is never `outOfDelta` and is classified exactly as without delta scoping, so an unaccepted, unsettled one blocks, and in a full lap no finding is `outOfDelta`." | diff-local |
| Story 4 negative: Given a finding whose exact source id is already settled or carried, when it also lies outside the delta, then it is classified settled or carried, not `outOfDelta`. | 15 | "`deriveEffectiveBuildReviewVerdict` classifies in the order accepted, settled or carried, `outOfDelta`, declared replication, suppressed, advisory, unresolved, so a finding whose exact source id is settled or carried is reported settled or carried, not `outOfDelta`." | diff-local |
| Story 4 negative: Given L2 is a delta lap and a finding with reviewer severity `critical` in any rubric is anchored on a settled hunk without a cause hunk, when the effective verdict is derived, then it is not `outOfDelta` and is classified exactly as it would be without delta scoping, so an unaccepted, unsettled critical finding blocks. | 15, 16 | "A finding with reviewer severity `critical` on a settled hunk without a cause hunk is never `outOfDelta` and is classified exactly as without delta scoping, so an unaccepted, unsettled one blocks, and in a full lap no finding is `outOfDelta`." | diff-local |
| Story 4 negative: Given a judged result whose cause hunk is malformed, for example a missing content hash or extra keys, when the result is parsed, then it is rejected exactly like any other contract-invalid result. | 14 | "A judged result whose `causeHunk` lacks `contentHash` or carries an extra key is rejected by `diagnoseBuildReviewJudgedResultRejection` as contract-invalid, exactly as for any other malformed finding." | diff-local |
| Story 5 happy: Given L1 raised source S1 on path P, its act case C1 was applied, and L2 raises a new source S2 on a delta hunk of P with no exact-source owner, when the judge returns an unbound act case for S2, then the case kicks back to BUILD and the engine stamps `recurrenceOf` C1. | 21 | "A coordinator lap with one provenance candidate C1 reconciles the judge's unbound act case for S2 with `recurrenceOf` C1 and publishes its BUILD work order." | diff-local |
| Story 5 happy: Given two candidate act cases with applied effects, each owning a source raised in the predecessor lap on the same path, when the engine chooses a provenance owner, then it picks the one whose lineage has more applied attempts, breaking a tie by the lowest case id. | 21 | "With two candidates, the coordinator stamps the one whose `buildReviewRecurrenceLineage` has more applied attempts, and the lowest case id on a tie, and the stamped owner is unchanged when the interval commits carry `Task:` trailers naming other tasks." | diff-local |
| Story 5 happy: Given a provenance lineage that already holds three applied attempts, when another unbound act case on a delta hunk joins it, then the build halts with the existing recurrence-limit halt, which names the lineage, before any effect reservation. | 21 | "When the chosen lineage already holds three applied attempts, the coordinator halts with `semantic remediation case recurrence limit <id>` naming the lineage before any effect is reserved." | diff-local |
| Story 5 happy: Given the judge declares `distinctFrom` naming the provenance candidate with a non-empty reason, when the case is reconciled, then it starts a fresh lineage and the declaration is persisted. | 21 | "A judge `distinctFrom` entry naming the provenance candidate with a non-empty reason is kept by the validator, the case is reconciled with no `recurrenceOf`, and the persisted case carries the declaration." | diff-local |
| Story 5 negative: Given L2 raises a new act source on a delta hunk of a path where no act case with an applied effect owns a source raised in L1 on that path, when the case is reconciled, then no `recurrenceOf` is stamped and the case is a fresh lineage. | 21, 20 | "With no provenance candidate, the reconciled case carries no `recurrenceOf`; with an exact-source owner, `recurrenceOf` names that owner through the existing #3124 path without consulting provenance." | diff-local |
| Story 5 negative: Given an act case with an applied effect that owns no source raised in the predecessor lap, when L2's new act case on the same path is reconciled, then that case is not a provenance candidate. | 20 | "`buildReviewProvenanceCandidates` returns no candidate when no act case with an applied effect owns a source raised in the predecessor lap on P, and excludes an applied act case whose sources were raised only in earlier laps." | diff-local |
| Story 5 negative: Given an unbound act case that already has an exact-source owner, when it is reconciled, then the existing recurrence rule applies and provenance is not consulted. | 21, 20 | "With no provenance candidate, the reconciled case carries no `recurrenceOf`; with an exact-source owner, `recurrenceOf` names that owner through the existing #3124 path without consulting provenance." | diff-local |
| Story 5 negative: Given a new act case bound by `existingCaseId`, or a case whose disposition is not `act`, when it is reconciled, then provenance stamps nothing. | 20 | "`buildReviewProvenanceCandidates` returns nothing for a case bound by `existingCaseId`, a non-act case, or a case that has an exact-source owner (a resolved act case that is the authoritative owner of a row source)." | diff-local |
| Story 5 negative: Given commits in the interval carry `Task:` trailers that name other tasks, when provenance is derived, then the trailers have no effect on the chosen owner. | 20, 21 | "With two candidates, the coordinator stamps the one whose `buildReviewRecurrenceLineage` has more applied attempts, and the lowest case id on a tie, and the stamped owner is unchanged when the interval commits carry `Task:` trailers naming other tasks." | diff-local |
| Story 6 happy: Given a prior case whose sources were raised in laps whose branch artifacts exist, when the adjudication context is built, then each of its latest 4 sources carries a digest with rubric, concern kind, a summary of at most 1000 bytes, at most 8 evidence locations and the lap id. | 23 | "`buildBuildReviewAdjudicationContext` gives each of a prior case's 4 most recent sources a `finding` digest with rubric, concernKind, a summary truncated to 1000 bytes, at most 8 evidenceLocations and lapId, read from the source's lap branch artifact, and gives older sources none." | diff-local |
| Story 6 happy: Given the digests of all prior cases fit in 64 KiB, when the context is built, then every eligible source carries its digest and `priorDigestsOmitted` is zero. | 23 | "When every digest fits the budget, every eligible source carries one and `priorDigestsOmitted` is 0; when they exceed it, the oldest digests are dropped first until the budget holds, `priorDigestsOmitted` equals the number dropped, and the context still builds." | diff-local |
| Story 6 negative: Given the digests exceed 64 KiB, when the context is built, then the oldest digests are dropped first until the budget holds, `priorDigestsOmitted` counts them, and the context still builds and dispatches. | 23, 26 | "When every digest fits the budget, every eligible source carries one and `priorDigestsOmitted` is 0; when they exceed it, the oldest digests are dropped first until the budget holds, `priorDigestsOmitted` equals the number dropped, and the context still builds." | diff-local |
| Story 6 negative: Given a prior source whose lap artifact is missing or unreadable, when the context is built, then that source carries no digest and the context still builds. | 23 | "A source whose lap artifact is missing or unreadable carries no digest and the context still builds." | diff-local |
| Story 6 negative: Given a case with more than 4 sources, when the context is built, then only its 4 most recent sources carry digests. | 23 | "`buildBuildReviewAdjudicationContext` gives each of a prior case's 4 most recent sources a `finding` digest with rubric, concernKind, a summary truncated to 1000 bytes, at most 8 evidenceLocations and lapId, read from the source's lap branch artifact, and gives older sources none." | diff-local |
| Story 6 negative: Given a context whose prior cases, current sources and plan context leave less than 64 KiB under the existing 256 KiB limit, including the maximum case history, when digests are added, then they use only the remaining headroom and the context never overflows because of them. | 23 | "The digest budget is the smaller of 64 KiB and the headroom under `maxSerializedBytes` after every prior case, current source and the plan context, recomputed for the expansion round, so a context at the maximum case history that serializes within the limit without digests also serializes within it with digests." | diff-local |
| Story 7 happy: Given an implementationQuality finding on L1's hunk H whose case the judge finalized as `reject`, and L2 re-raises the same concern on unchanged H under a different concern kind and wording, when L2 is adjudicated, then the re-raise is `outOfDelta`, the feature does not halt, and no kickback is charged. | 25 | "In a two-lap build_review step fixture, L2's rubric projections carry the frontier's delta, a re-raise on unchanged hunk H of an implementationQuality finding whose case the judge finalized `reject` is classified `outOfDelta` under a different concern kind and wording, and L2 ends without a halt and with zero kickback charges, and a third lap L3 with H unchanged keeps H out of the delta." | diff-local |
| Story 7 happy: Given a finding accepted by exact operator disposition on L1's hunk H, and L2 re-raises the same concern on unchanged H under a new id, when L2 is adjudicated, then the re-raise is `outOfDelta` and no operator re-acceptance is needed. | 25 | "In the same fixture with an L1 finding accepted by exact operator disposition, L2's re-raise on unchanged H under a new id is `outOfDelta` and L2 passes with no new disposition recorded." | diff-local |
| Story 7 happy: Given L1 kicked back one act case and its repair changed only hunk H2, when L2 runs with no new defect, then only H2 is judged and build_review passes on L2. | 25 | "After an L1 kickback whose repair changed only hunk H2, an L2 with no new defect dispatches each rubric with delta hunks exactly H2 and build_review passes on L2; a custom rubric whose ids change every lap raises nothing blocking on L1's settled hunks when the only change is in another file." | diff-local |
| Story 7 happy: Given L1 kicked back and the repair introduced a genuine defect in hunk H2, when L2 runs, then the defect is raised on H2, kicks back, and is recorded as a recurrence of the repaired case. | 26 | "In a two-lap conductor build_review fixture where L1's act case was applied and its repair introduced a defect on hunk H2, L2's finding on H2 kicks back to BUILD and the reconciled case carries `recurrenceOf` the repaired case." | diff-local |
| Story 7 happy: Given a custom rubric whose finding ids change every lap, when L2 judges a feature whose only change since L1 is in another file, then the custom rubric raises nothing on L1's settled hunks that blocks. | 25 | "After an L1 kickback whose repair changed only hunk H2, an L2 with no new defect dispatches each rubric with delta hunks exactly H2 and build_review passes on L2; a custom rubric whose ids change every lap raises nothing blocking on L1's settled hunks when the only change is in another file." | diff-local |
| Story 7 negative: Given a change in L2's delta that breaks unchanged code on settled hunk H, when the reviewer names the delta hunk as cause, then the finding blocks and kicks back. | 26 | "When an L2 change in the delta breaks unchanged code on settled hunk H and the reviewer names that delta hunk as `causeHunk`, the finding blocks and kicks back." | diff-local |
| Story 7 negative: Given a base refresh between L1 and L2, when L2 re-raises an unchanged finding on unchanged H with the same concern kind, then L2 is a full lap, the finding keeps its L1 id, and the existing exact-id settlement applies. | 25 | "After a base refresh or a parent restack between L1 and L2, L2 is a full lap and an unchanged finding on unchanged H keeps its L1 id and is settled by the existing exact-id predicate." | diff-local |
| Story 7 negative: Given a repair chain in which every repair introduces a new defect on the hunk it changed, when the fourth applied attempt in the lineage is due, then the feature halts with the recurrence-limit halt instead of continuing to kick back. | 26 | "In a repair chain fixture where each repair introduces a new defect on the hunk it changed, the fourth applied attempt in the lineage halts with `semantic remediation case recurrence limit` instead of a further kickback." | diff-local |
| Story 7 negative: Given a stacked child whose parent was repaired and restacked between L1 and L2, when the child's L2 runs, then L2 is a full lap and the child's unchanged hunks keep their L1 ids, so exact-id settlement still applies. | 25 | "After a base refresh or a parent restack between L1 and L2, L2 is a full lap and an unchanged finding on unchanged H keeps its L1 id and is settled by the existing exact-id predicate." | diff-local |
| Story 7 negative: Given a delta lap in which every finding any rubric raises is `outOfDelta`, when the lap completes, then build_review passes without a remediate dispatch. | 25, 17 | "The step writes each rubric's `reviewScope.outOfDeltaSourceIds` with the lap's `outOfDelta` sources, and a delta lap whose every raised finding is `outOfDelta` passes without a remediate dispatch." | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-10-24-lap-monotonic-build-review-scope#D1 | task | task-1, task-6 | round-trips a `reviewScope` with mode, reason, sequence |
| adr-2026-10-24-lap-monotonic-build-review-scope#D2 | task | task-8, task-9 | settles hunk H for R when an eligible L1 record lists H in `reviewedHunks` |
| adr-2026-10-24-lap-monotonic-build-review-scope#D3 | task | task-3, task-4, task-11 | reports reasons by the precedence record-unreadable, first-lap, merge-base-changed, version-changed, open-source-unmapped |
| adr-2026-10-24-lap-monotonic-build-review-scope#D4 | task | task-10 | contains no prior findings, case records, dispositions, settled ids, suppression history or prior-lap scope records |
| adr-2026-10-24-lap-monotonic-build-review-scope#D5 | task | task-15, task-14 | is never `outOfDelta` and is classified exactly as without delta scoping |
| adr-2026-10-24-lap-monotonic-build-review-scope#D6 | task | task-17, task-15, task-19 | records zero `chargeEffect` calls |
| adr-2026-10-24-lap-monotonic-build-review-scope#D7 | task | task-21, task-20 | halts with `semantic remediation case recurrence limit <id>` naming the lineage |
| adr-2026-10-24-lap-monotonic-build-review-scope#D8 | task | task-23 | the smaller of 64 KiB and the headroom under `maxSerializedBytes` |
| adr-2026-10-24-lap-monotonic-build-review-scope#D9 | task | task-13, task-22, task-24 | embeds the same skill file path and identical contract text |
| adr-2026-10-24-lap-monotonic-build-review-scope#D10 | no-change | none | D10 adds no configuration key and no flag; the tasks above ship the behavior default-on, and re-enabling implementationQuality stays an operator configuration decision outside this plan |
| adr-2026-08-13-engine-managed-build-review-rubric-branches#D1 | no-change | none | build_review stays one public engine gate: the scope is decided inside the existing build_review runner (Task 6) and no step is added |
| adr-2026-08-13-engine-managed-build-review-rubric-branches#D2 | task | task-10 | returns projectionVersion `v5` projections whose `changedFiles` equals the by-reference parse of the whole frozen diff |
| adr-2026-08-13-engine-managed-build-review-rubric-branches#D3 | task | task-12 | is called with the whole frozen diff, restoring every changed production file |
| adr-2026-08-13-engine-managed-build-review-rubric-branches#D4 | task | task-13 | embeds the same skill file path and identical contract text |
| adr-2026-08-13-engine-managed-build-review-rubric-branches#D5 | task | task-2 | returns a different identity when the contract version, projection version, declaration fingerprint, effective skill or policy bundle digest, provider, model or effort differs |
| adr-2026-08-13-engine-managed-build-review-rubric-branches#D6 | task | task-11 | writes R's branch artifact with outcome `scope-empty`, no findings and its `reviewScope` |
| adr-2026-08-13-engine-managed-build-review-rubric-branches#D7 | task | task-10 | returns a hit for the first pair and a miss for the second |
| adr-2026-08-13-engine-managed-build-review-rubric-branches#D8 | task | task-8, task-15 | matched by an exact operator disposition |
| adr-2026-08-13-engine-managed-build-review-rubric-branches#D9 | task | task-5 | is persist true and render false |
| adr-2026-08-13-stable-build-review-finding-dispositions#D1 | task | task-14 | returns the same id for a finding with and without `causeHunk` |
| adr-2026-08-13-stable-build-review-finding-dispositions#D2 | task | task-8 | matched by an exact operator disposition |
| adr-2026-08-13-stable-build-review-finding-dispositions#D3 | no-change | none | the review frontier only reads the dispositions and case stores when deciding scope and adds no writer, so the existing build-review state lock and atomic writes are unchanged |
| adr-2026-08-13-stable-build-review-finding-dispositions#D4 | task | task-19 | lists the `outOfDelta` finding under its own heading, separate from accepted risk |
| adr-2026-08-13-stable-build-review-finding-dispositions#D5 | no-change | none | no external-process event is added; `build_review_review_scope` is emitted in-process through the existing emitter (Task 5), so the external ledger and its reader contract are unchanged |
| adr-2026-08-13-stable-build-review-finding-dispositions#D6 | task | task-18 | exclude every `outOfDelta` finding |
| adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication#D1 | no-change | none | `scope-empty` and `outOfDelta` are content-free and non-failing, never infrastructure outcomes, so the infrastructure-only versus mixed-lap distinction is unchanged |
| adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication#D2 | task | task-23 | the smaller of 64 KiB and the headroom under `maxSerializedBytes` |
| adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication#D3 | task | task-17 | passes no live source for it to the remediate dispatch |
| adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication#D4 | task | task-8 | below the current confidence floor |
| adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication#D5 | task | task-21 | stamps the one whose `buildReviewRecurrenceLineage` has more applied attempts |
| adr-2026-10-19-build-review-finding-severity-advisory-threshold#D1 | task | task-15 | A finding with reviewer severity `critical` |
| adr-2026-10-19-build-review-finding-severity-advisory-threshold#D2 | task | task-14 | returns the same id for a finding with and without `causeHunk` |
| adr-2026-10-19-build-review-finding-severity-advisory-threshold#D3 | task | task-9 | is lowered to or below F's severity, or removed |
| adr-2026-10-19-build-review-finding-severity-advisory-threshold#D4 | task | task-15, task-17, task-18, task-25 | classifies in the order accepted, settled or carried, `outOfDelta`, declared replication, suppressed, advisory, unresolved |
| adr-2026-10-19-build-review-finding-severity-advisory-threshold#D5 | no-change | none | advisory findings keep their existing durable record and listing; out-of-delta findings are listed separately by Task 19, so no advisory behavior changes |
| adr-2026-10-19-build-review-finding-severity-advisory-threshold#D6 | no-change | none | the adjudicator downgrade rule is untouched: out-of-delta findings never reach the adjudicator (Task 17) |
| adr-2026-10-19-build-review-finding-severity-advisory-threshold#D7 | task | task-8 | below the current severity threshold |
| adr-2026-08-29-build-review-remediate-case-adjudication#D1 | task | task-10 | contains no prior findings, case records, dispositions, settled ids, suppression history or prior-lap scope records |
| adr-2026-08-29-build-review-remediate-case-adjudication#D2 | task | task-18 | exclude every `outOfDelta` finding |
| adr-2026-08-29-build-review-remediate-case-adjudication#D3 | task | task-17 | passes no live source for it to the remediate dispatch |
| adr-2026-08-29-build-review-remediate-case-adjudication#D4 | task | task-21 | is kept by the validator |
| adr-2026-08-29-build-review-remediate-case-adjudication#D5 | task | task-21 | reconciles the judge's unbound act case for S2 with `recurrenceOf` C1 |
| adr-2026-08-29-build-review-remediate-case-adjudication#D6 | no-change | none | no effect kind or outbox entry is added; provenance only stamps `recurrenceOf` before any effect reservation, through the existing reserved idempotent outbox |
| adr-2026-08-29-build-review-remediate-case-adjudication#D7 | task | task-17 | records zero `chargeEffect` calls |
| adr-2026-08-29-build-review-remediate-case-adjudication#D8 | task | task-17, task-25 | completes build_review as PASS without a remediate dispatch |
| adr-2026-08-29-build-review-remediate-case-adjudication#D9 | task | task-5 | writes exactly one `.pipeline/events.jsonl` line carrying all six fields |
| adr-2026-08-29-build-review-remediate-case-adjudication#D10 | no-change | none | rollout gating of case adjudication is unchanged; this feature adds no gate, flag or default |
| adr-2026-10-20-operator-acceptance-is-durable-case-state#D1 | no-change | none | the case store schema stays v3: the frontier and provenance read it and add no field |
| adr-2026-10-20-operator-acceptance-is-durable-case-state#D2 | no-change | none | `finalize` remains the only writer of acceptance origins; no task writes origins |
| adr-2026-10-20-operator-acceptance-is-durable-case-state#D3 | task | task-15 | is reported settled or carried, not `outOfDelta` |
| adr-2026-10-20-operator-acceptance-is-durable-case-state#D4 | task | task-8 | finalized by `finalizedBuildReviewSourceIds` |
| adr-2026-10-20-operator-acceptance-is-durable-case-state#D5 | task | task-11, task-9, task-17 | excludes the sources of a `scope-empty` rubric from the sources not raised this lap |
| adr-2026-10-20-operator-acceptance-is-durable-case-state#D6 | no-change | none | this feature adds no case-store occurrence, so nothing new goes through the case-store outbox |
| adr-2026-10-20-operator-acceptance-is-durable-case-state#D7 | no-change | none | `build-review resolve-case` is unchanged and remains the one operator command that writes case state |
| adr-2026-10-20-operator-acceptance-is-durable-case-state#D8 | no-change | none | carried and operator-resolved rows keep their existing visibility; out-of-delta rows are listed separately (Task 19) |
| adr-2026-10-20-operator-acceptance-is-durable-case-state#D9 | task | task-4 | reads only that child's branch artifacts and case store |
| adr-2026-08-22-one-owner-per-review-question#D1 | task | task-15 | is never `outOfDelta` and is classified exactly as without delta scoping |
| adr-2026-08-21-review-bound-by-plan-done-when-criteria#D1 | no-change | none | the land gate of D1 is unaffected; this feature changes only build_review lap behavior |
| adr-2026-08-21-review-bound-by-plan-done-when-criteria#D2 | no-change | none | this feature adds no `boundTo` field or grammar |
| adr-2026-08-21-review-bound-by-plan-done-when-criteria#D3 | task | task-15, task-17 | classifies a non-critical security or implementationQuality finding anchored on a settled hunk with no cause hunk as `outOfDelta` |
| adr-2026-08-21-review-bound-by-plan-done-when-criteria#D4 | no-change | none | no `beyond` record is written: out-of-delta findings are engine bookkeeping and never filed |
| adr-2026-08-21-review-bound-by-plan-done-when-criteria#D5 | no-change | none | daemon filing is unchanged; out-of-delta findings are not filed (Task 17 publishes no work order for them) |
| adr-2026-08-21-review-bound-by-plan-done-when-criteria#D6 | no-change | none | the `boundTo` contract text and spine are unchanged by this feature |

## Verification

- [x] All happy path criteria covered by at least one task
- [x] All negative path criteria covered by at least one task
- [x] No task exceeds 5 minutes of work
- [x] Every task has a `Done when:` block of falsifiable checks; no unbounded quality word is left without its closed enumeration or named mechanism (3c)
- [x] Dependencies are explicit and acyclic
- [x] Tasks do not invalidate each other's fixtures or assertions (swept by plan review at Tier L)
