# Implementation Plan: one rubric's rejected contract no longer resurrects a prior lap's findings (#1740)

**Date:** 2026-08-21
**Design:** .docs/decisions/architecture-review-2026-08-21-one-rubric-s-rejected-contract-discards-the-whole-.md
**Stories:** .docs/stories/one-rubric-s-rejected-contract-discards-the-whole-.md
**Conflict check:** Clean as of 2026-08-21

## Summary
Close the gap in `adr-2026-08-18` D3's premise: a below-cap mechanical fault still publishes no aggregate, but (1) `build_review` completion stops reading a prior lap's non-PASS aggregate as the current verdict, (2) the last mechanical fault becomes a first-class ledger record, and (3) the stale condition is visible on the event spine. 10 tasks.

## Technical Approach
- **Stale-lap guard (Story 1).** In `src/conductor/src/engine/artifacts.ts`'s `build_review` completion predicate, after the existing code-stamp preservation block and the mtime/JSON/schema checks and after `parseBuildReviewAggregate`, compare `aggregate.lapId` to `lap-<HEAD>` (HEAD via `ctx.git ?? makeGitRunner(dir)`, `rev-parse HEAD`; on git failure skip the guard and keep the existing logic). Only when the aggregate's raw `verdict` is not `PASS` and the ids differ, return `{ done: false, routeClass: 'absent', reason: "build-review aggregate belongs to lap <stored>, current lap is <current> — scoring 'no fresh verdict'; a prior lap's FAIL is never kicked back", staleLap: { storedLapId, currentLapId } }`. The PASS path is untouched so `adr-2026-07-22` stamp preservation keeps working. The `CompletionResult` type gains the optional `staleLap` field so the caller can emit the event without re-parsing the reason string (`adr-2026-08-19` routing-by-kind).
- **Event (Story 1).** New `ConductorEvent` member `build_review_stale_aggregate { storedLapId, currentLapId }` in `src/conductor/src/types/events.ts`, declared in `EVENT_SINKS` (`src/conductor/src/engine/event-sinks.ts`) as `{ render: false, persist: true, audit: false }` — the same shape as `build_review_outer_verdict`. Emitted by the conductor at the `build_review` completion call site when `completion.staleLap` is present. Telemetry only; never consulted for control.
- **Ledger record (Story 3).** `KickbackGateEntry.lastMechanicalFault?: { rubric: BuildReviewRubricId; reason: BuildReviewInfrastructureFailureReason; detail: string; lapId: string }` in `src/conductor/src/engine/kickback-ledger.ts`. `isKickbackGateEntry` accepts absent-or-valid (rubric/reason checked against the closed unions exported from `build-review-domain.ts`/registry; `detail`, `lapId` non-empty strings) and rejects anything else. `bumpMechanicalFaults(entry, fault)` sets the record (detail bounded to `RUBRIC_FAILURE_DETAIL_CAP_BYTES`, reuse `boundedHeadTailExcerpt`); `bumpMechanicalFaultsInLedger(projectRoot, gate, fault)` threads it. `creditKickbackGateLaps` additionally drops `lastMechanicalFault` (it is object-valued, so the numeric rule does not reach it). The existing `consumeKickbackBudget` path must not touch it (PASS retention).
- **Producer (Story 2/3).** `step-runners.ts`'s mechanical-fault return passes `{ rubric, reason, detail, lapId }` from the `infrastructureFailure` result into the bump. No aggregate write is added — D3 preserved. Story 2's lap-join behaviour already exists; its task is verify-only with an acceptance-level proof.
- **Readers (Story 3).** `renderExhaustedMechanicalBuildReviewHalt` takes the ledger record as its fallback diagnostic when the current-lap aggregate is unavailable; `build-review-cli.ts`'s `renderHuman` and JSON output add a `Last mechanical fault: <rubric>; cause: <reason>; lap: <lapId>; diagnostic: <detail>` line / `lastMechanicalFault` field only when the record is set (byte-identical otherwise).
- **Local pattern context.** Ledger field validation follows the existing optional-field pattern in `isKickbackGateEntry` (search `mechanicalFaults === undefined ||` in `kickback-ledger.ts`): absent is valid, present must be well-typed, anything else rejects the whole entry. Event declaration follows `build_review_outer_verdict` (search `build_review_outer_verdict` in `event-sinks.ts` and `types/events.ts`). Tests live beside their module in `src/conductor/test/engine/` (`artifacts.test.ts`, `conductor-kickback-ledger.test.ts`, `build-review-cli.test.ts`, `step-runners.test.ts`).
- **Sequencing.** Ledger type + validator first (Tasks 1–2), producer (3), readers (4–5), then the completion guard (6–8), event (9), acceptance proof for the lap join (10).

## Prerequisites
- None. All seams exist on main.

## Tasks

### Task 1: Add `lastMechanicalFault` to the ledger entry type and validator
**Story:** 3
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/conductor-kickback-ledger.test.ts`: (a) a legacy entry without the key parses and `lastMechanicalFault` is `undefined`; (b) an entry with a well-formed record parses with the record intact; (c) an entry whose `reason` is `'bogus'` is rejected as malformed (same class as any other invalid entry); (d) an entry whose record lacks `lapId` is rejected.
2. Verify RED.
3. Implement: add the optional typed field to `KickbackGateEntry` and `PersistedKickbackGateEntry`; extend `isKickbackGateEntry` following the `mechanicalFaults === undefined ||` optional-field pattern; validate `rubric` against the rubric registry ids and `reason` against `BuildReviewInfrastructureFailureReason` (import the closed union/its member list from `build-review-domain.ts`).
4. Verify GREEN.
5. Commit: "feat(kickback-ledger): typed lastMechanicalFault record with absent-or-valid validation"

**Done when:**
- `KickbackGateEntry.lastMechanicalFault` exists with `rubric`, `reason`, `detail`, `lapId` and `reason` typed as `BuildReviewInfrastructureFailureReason`.
- Tests (a)–(d) above pass; (c) and (d) assert the reject path returns the same failure class as an invalid `mechanicalFaults` value.
- `readKickbackLedger` over a fixture ledger written before this change returns unchanged values.

**Files:**
- src/conductor/src/engine/kickback-ledger.ts
- src/conductor/test/engine/conductor-kickback-ledger.test.ts

**Dependencies:** none

### Task 2: Write, replace, bound, credit, and PASS-retain the record
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing tests in `conductor-kickback-ledger.test.ts`: (a) `bumpMechanicalFaults(entry, fault)` sets `lastMechanicalFault` and increments `mechanicalFaults`; (b) a second bump with a different rubric replaces the record and reads 2; (c) a detail longer than `RUBRIC_FAILURE_DETAIL_CAP_BYTES` is stored truncated and the write succeeds; (d) `creditKickbackGateLaps` on an entry with the record returns `mechanicalFaults: 0` and no `lastMechanicalFault` key; (e) `consumeKickbackBudget` on a PASS leaves both fields untouched.
2. Verify RED.
3. Implement: extend `bumpMechanicalFaults` and `bumpMechanicalFaultsInLedger` to accept the fault record; bound `detail` with `boundedHeadTailExcerpt` (export it from where it lives if needed); drop the record in `creditKickbackGateLaps`.
4. Verify GREEN.
5. Commit: "feat(kickback-ledger): record and credit the last mechanical fault"

**Done when:**
- Tests (a)–(e) pass.
- `creditKickbackGateLaps` output for an entry carrying the record has no `lastMechanicalFault` property (asserted with `'lastMechanicalFault' in result === false`).
- No call to `consumeKickbackBudget` changes `lastMechanicalFault` (asserted by deep-equal before/after).

**Files:**
- src/conductor/src/engine/kickback-ledger.ts
- src/conductor/test/engine/conductor-kickback-ledger.test.ts

**Preserves:** a rebase-invalidation credit zeroes every lap-counting field on the gate entry; a build_review PASS clears none of them

**Dependencies:** Task 1

### Task 3: The lap join passes the fault into the ledger
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write a failing test in `src/conductor/test/engine/step-runners.test.ts`: a four-rubric lap with three judged PASS results and one `infrastructure-failure` (`invalid-provider-result`, detail excerpt) below cap → the step returns `success: false`, `currentLapMechanicalFault: true`, the ledger's `gates.build_review.lastMechanicalFault` equals `{ rubric, reason: 'invalid-provider-result', detail, lapId }`, and `.pipeline/build-review.json` is not written.
2. Verify RED (record absent).
3. Implement: at the mechanical-fault return in `step-runners.ts`, call `bumpMechanicalFaultsInLedger(this.projectDir, 'build_review', { rubric, reason, detail, lapId })`.
4. Verify GREEN.
5. Commit: "feat(build-review): record the rejected rubric in the ledger on a mechanical fault"

**Done when:**
- The test above passes and asserts the aggregate file for that lapId does not exist after the step.
- The ledger record's `lapId` equals the `lapId` the lap join used for its branch artifacts.
- `git diff` of `step-runners.ts` adds no `writeFile`/`rename` of `build-review.json` on the below-cap path.

**Files:**
- src/conductor/src/engine/step-runners.ts
- src/conductor/test/engine/step-runners.test.ts

**Preserves:** a below-cap mechanical-fault lap publishes no aggregate and consumes no build_review kickback budget

**Dependencies:** Task 2

### Task 4: The exhausted halt falls back to the ledger record
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write a failing test in `src/conductor/test/engine/conductor-halt.test.ts` (or the file that already tests `renderExhaustedMechanicalBuildReviewHalt`): with an unparseable current-lap aggregate and an entry carrying `lastMechanicalFault`, the rendered halt contains the rubric, the closed reason, the lapId, and the detail; with a parseable aggregate the existing output is unchanged.
2. Verify RED.
3. Implement: widen the `entry` parameter to `Pick<KickbackGateEntry, 'mechanicalFaults' | 'lastMechanicalFault'>` and render the record in the "diagnostic is unavailable" branch.
4. Verify GREEN.
5. Commit: "feat(conductor): exhausted mechanical halt names the last recorded fault"

**Done when:**
- The new test passes for both branches.
- The existing halt-rendering tests pass byte-for-byte unchanged on the aggregate-present branch.

**Files:**
- src/conductor/src/engine/conductor.ts
- src/conductor/test/engine/conductor-halt.test.ts

**Dependencies:** Task 1

### Task 5: `build-review findings` renders the record
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/build-review-cli.test.ts`: (a) with `lastMechanicalFault` set, human output contains `Last mechanical fault: <rubric>; cause: <reason>; lap: <lapId>; diagnostic: <detail>` and JSON output carries `lastMechanicalFault`; (b) with no record, human and JSON output are deep-equal to today's output for the same fixture.
2. Verify RED.
3. Implement: read the full gate entry where `readMechanicalFaults` reads the count; thread the record into `renderHuman` and the JSON result.
4. Verify GREEN.
5. Commit: "feat(build-review-cli): show the last mechanical fault in findings"

**Done when:**
- Tests (a) and (b) pass; (b) asserts byte-identical human output.
- The JSON shape adds exactly one optional key `lastMechanicalFault` (asserted by key-set comparison).

**Files:**
- src/conductor/src/engine/build-review-cli.ts
- src/conductor/test/engine/build-review-cli.test.ts

**Dependencies:** Task 1

### Task 6: Completion classifies a stale non-PASS aggregate as absent
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/artifacts.test.ts` using the existing build_review completion fixtures with an injected `ctx.git` whose `rev-parse HEAD` returns `<B>`: (a) a session-fresh FAIL aggregate with `lapId: lap-<A>` → `done: false`, `routeClass: 'absent'`, reason contains both `lap-<A>` and `lap-<B>`, `staleLap: { storedLapId: 'lap-<A>', currentLapId: 'lap-<B>' }`; (b) a session-fresh FAIL aggregate with `lapId: lap-<B>` and one judged finding → `routeClass: 'named-route'` with that finding's reason.
2. Verify RED.
3. Implement the guard after `parseBuildReviewAggregate` and before the effective-verdict resolution, only when `aggregate.verdict !== 'PASS'`; add the optional `staleLap` field to `CompletionResult`.
4. Verify GREEN.
5. Commit: "fix(artifacts): a prior lap's FAIL aggregate is absent, not a kickback"

**Done when:**
- Tests (a) and (b) pass.
- `CompletionResult` has an optional `staleLap: { storedLapId: string; currentLapId: string }`.
- The guard reads `lapId` from the parsed aggregate, not from the raw JSON or the reason string.

**Files:**
- src/conductor/src/engine/artifacts.ts
- src/conductor/test/engine/artifacts.test.ts

**Dependencies:** none

### Task 7: The guard never reaches a preserved PASS, the mtime floor, or an unresolvable HEAD
**Story:** 1
**Type:** negative-path

**Steps:**
1. Write failing/characterising tests in `artifacts.test.ts`: (a) gate-code-validity enabled, a PASS aggregate with `lapId: lap-<A>`, a `codeStamp` whose delta misses the gate surface, HEAD `<B>` → `done: true`, `verdictFreshness: 'preserved_surface_miss'`, no `staleLap`; (b) a FAIL aggregate with matching `lapId` whose mtime predates the session → the existing mtime reason and `stale_invalidated` freshness, no `staleLap`; (c) `ctx.git` throws on `rev-parse` with a stale FAIL aggregate → result is the existing `named-route` FAIL (no `done: true`, no `staleLap`); (d) a stale PASS aggregate without `codeStamp` and pre-session mtime → the existing `stale_invalidated` absent reason.
2. Verify any RED case (c is expected RED if the guard throws).
3. Implement: wrap HEAD resolution in try/catch; skip the guard on failure.
4. Verify GREEN.
5. Commit: "test(artifacts): stale-lap guard yields to stamp preservation, mtime floor, and git failure"

**Done when:**
- Tests (a)–(d) pass.
- No test in the file asserts `done: true` for any FAIL aggregate.

**Files:**
- src/conductor/src/engine/artifacts.ts
- src/conductor/test/engine/artifacts.test.ts

**Preserves:** a stamped build_review PASS whose code delta misses the gate surface is preserved on re-dispatch; a verdict not rewritten by the judging session is never reused

**Dependencies:** Task 6

### Task 8: A stale absent route leaves the file and the ledger untouched
**Story:** 1
**Type:** negative-path

**Steps:**
1. Write a failing test in `src/conductor/test/engine/conductor-gate-loop.test.ts` (or the conductor test that drives `build_review` completion into the kickback path): with a stale FAIL aggregate on disk, after the completion/route decision, `.pipeline/build-review.json` bytes are unchanged, no `kickback` event was emitted, and `gates.build_review.count`, `cumulative`, `lastReason` are unchanged.
2. Verify RED or characterise.
3. Implement only if the conductor's absent handling mutates any of these; otherwise no production change.
4. Verify GREEN.
5. Commit: "test(conductor): stale build_review aggregate consumes no kickback budget"

**Done when:**
- The test passes with a before/after byte comparison of the aggregate file and a deep-equal of the ledger entry.
- The emitted event list contains no `kickback` event for that decision.

**Files:**
- src/conductor/src/engine/conductor.ts
- src/conductor/test/engine/conductor-gate-loop.test.ts

**Dependencies:** Task 6

### Task 9: Emit `build_review_stale_aggregate` on the spine
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing tests: in `src/conductor/test/engine/event-sinks.test.ts` (or wherever sink totality is tested) the new member is declared with `persist: true`; in the conductor test from Task 8, exactly one `build_review_stale_aggregate` event with `storedLapId`/`currentLapId` is emitted when `completion.staleLap` is present and none otherwise.
2. Verify RED (compile failure on the missing sink declaration is the expected RED for the first test).
3. Implement: add the member to `ConductorEvent`, declare it in `EVENT_SINKS`, emit it at the build_review completion call site in `conductor.ts` from `completion.staleLap`.
4. Verify GREEN.
5. Commit: "feat(events): persist build_review_stale_aggregate"

**Done when:**
- `EVENT_SINKS.build_review_stale_aggregate` equals `{ render: false, persist: true, audit: false }`.
- The conductor test asserts exactly one emission with both lap ids, and zero emissions for a current-lap aggregate.
- The event payload is built from `completion.staleLap`, not from parsing `completion.reason`.

**Files:**
- src/conductor/src/types/events.ts
- src/conductor/src/engine/event-sinks.ts
- src/conductor/src/engine/conductor.ts
- src/conductor/test/engine/conductor-gate-loop.test.ts

**Dependencies:** Task 6, Task 8

### Task 10: Acceptance proof — a rejected rubric loses no verdict and resurrects no finding
**Story:** 2
**Type:** verification
**Verify-only:** yes

**Steps:**
1. In `src/conductor/test/engine/step-runners.test.ts`, drive the real lap join (faked provider adapters) through: lap 1 — rubric X judged FAIL with one finding, aggregate published, kickback reason names that finding; lap 2 (new HEAD) — X and two others judged PASS, the fourth returns a post-repair `dispatch-failure` below cap. Assert: three branch artifacts exist under `.pipeline/build-review/<lap2>/`; no aggregate for `<lap2>`; `currentLapMechanicalFault: true`; ledger `count`/`cumulative` unchanged from after lap 1; completion on the lap-1 aggregate at HEAD `<lap2>` returns `absent` (Task 6) and its reason contains no lap-1 finding id. Lap 3 — the fourth rubric judged PASS → a four-judged PASS aggregate is published.
2. Also assert the at-cap variant (three prior faults) publishes the aggregate with `coverage.<rubric>: infrastructure-failure` and effective FAIL, and the mixed variant (one judged finding + one rejection) publishes with only the current lap's finding in the reasons.
3. Also assert the all-infrastructure variant below cap (Story 2's third negative path): every rubric on the lap returns an infrastructure failure with the ledger below the allowance cap; assert no aggregate is written for that lap and the step result names the first failing rubric and its closed reason.
4. If every assertion passes without a production change, complete with an empty commit carrying `Evidence: skipped already-satisfied-by-tasks-3-and-6`.

**Done when:**
- The three-lap test and all three variants pass — at-cap, mixed, and all-infrastructure-below-cap.
- No production file changes in this task's commit range.

**Files:**
- src/conductor/test/engine/step-runners.test.ts

**Dependencies:** Task 3, Task 6

## Task Dependency Graph
```
Task 1 ─┬─ Task 2 ── Task 3 ──┐
        ├─ Task 4             │
        └─ Task 5             ├── Task 10
Task 6 ─┬─ Task 7             │
        └─ Task 8 ── Task 9   │
        └─────────────────────┘
```

## Integration Points
- After Task 3: a mechanical-fault lap writes a readable ledger record (`conduct-ts build-review findings` after Task 5).
- After Task 6: a same-session prior-lap FAIL aggregate no longer kicks back to build.
- After Task 9: the stale condition is visible in `.pipeline/events.jsonl`.

## Verification
- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks; no unbounded quality word is left without its closed enumeration or named mechanism
- [ ] Dependencies are explicit and acyclic
### Task rem-completeness-1: src/conductor/test/engine/artifacts.test.ts:4136 — add Task 7 case (a) for a stamped PASS at a different HEAD whose codeStamp delta misses the gate surface; assert done true, verdictFreshness preserved_surface_miss, and no staleLap
### Task rem-completeness-2: src/conductor/test/engine/artifacts.test.ts:4136 — add Task 7 case (b) for a matching-lap FAIL whose mtime predates the session; assert the existing mtime rejection, verdictFreshness stale_invalidated, and no staleLap
### Task rem-completeness-3: src/conductor/test/engine/artifacts.test.ts:4136 — add Task 7 case (d) for a pre-session PASS aggregate without codeStamp; assert the existing stale_invalidated absent result and no staleLap
### Task rem-completeness-4: src/conductor/test/engine/conductor-gate-loop.test.ts:1 — add the Task 8 stale-FAIL regression test that snapshots .pipeline/build-review.json bytes and gates.build_review count, cumulative, and lastReason before processing, then asserts unchanged bytes, a deep-equal ledger entry, and no kickback event afterward
### Task rem-completeness-5: src/conductor/test/engine/conductor-gate-loop.test.ts:1 — add Task 9 conductor assertions that a stale completion emits exactly one build_review_stale_aggregate carrying completion.staleLap storedLapId and currentLapId, while a current-lap aggregate emits zero such events
