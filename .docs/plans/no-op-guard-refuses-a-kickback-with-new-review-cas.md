# Implementation Plan: the no-op guard tells new review work from a repeated cycle (#3661)

**Date:** 2026-11-15
**Design:** none (technical track); decision recorded in `.docs/decisions/adr-2026-08-05-build-settle-outcome-stamp.md` (D3, amended 2026-11-15 by #3661)
**Stories:** .docs/stories/no-op-guard-refuses-a-kickback-with-new-review-cas.md
**Conflict check:** skipped (Tier S)

## Summary

Make BUILD's pre-dispatch no-op refusal compare the build-review cases a kickback carries with the cases
the previous no-op BUILD was delivered, and spend a refusal once so clearing its HALT retries BUILD.
Four tasks.

## Technical Approach

- **Record shape (`src/conductor/src/engine/build-outcome.ts`).** `BuildOutcomeRecord` gains two optional
  fields: `deliveredCaseIds?: string[]` (the case ids of the build-review work order delivered to that
  BUILD, sorted; `[]` when none) and `refusalSpent?: true`. `isBuildOutcomeRecord` accepts both when
  absent and validates them when present (an array of strings; the literal `true`). Absence keeps the
  sidecar's existing fail-open read.
- **Guard (`sameNoOpCycle`).** `NoOpCycleInput` gains `deliveredCaseIds?: readonly string[]` (absent means
  `[]`). A definite match now also requires that the prior record's refusal is not spent and that every
  current delivered case id appears in the prior record's `deliveredCaseIds`, where an absent prior
  field means `[]`. So a legacy record keeps refusing an empty-work kickback (the original wiring_check
  and prd_audit purpose, and every existing refusal test) and dispatches any kickback that carries a case.
  Case identity is the adjudicator's judgement; the guard compares ids and never re-derives equivalence.
- **Halt text (`composeBuildOutcomeHaltReason`).** The first line ends
  `Investigate the unchanged build before retrying. Clearing this HALT retries BUILD once.`; the
  `Build note:` line is unchanged. The exact-string expectation in `build-outcome.test.ts` is updated.
- **Delivered cases (`src/conductor/src/engine/conductor.ts`).** `durableBuildReviewRetryContext` already
  reads and stamps the work order at BUILD step entry, before the attempt loop. Its `ready` result gains
  `caseIds` (the order's `cases[].caseId`, sorted). The build step keeps one step-local
  `deliveredBuildReviewCaseIds` (`[]` unless the result was `ready`, and `[]` when adjudication is
  disabled). It is passed to the guard's `sameNoOpCycle` input and to `recordBuildOutcome`, which takes a
  required `deliveredCaseIds` input and writes it on the record. All four call sites pass it: the
  routed-prerequisite `failed` settle, the `authFailure` no-verdict stamp, the post-loop `failed` stamp,
  and the `done` stamp.
- **Spending a refusal (same file, the guard branch at BUILD entry).** Before writing the `needs-human`
  HALT, the refusing pass rewrites the sidecar with the latest record marked `refusalSpent: true`, through
  `writeBuildOutcomeBestEffort`. A failed write is swallowed and the HALT is still written. Daemon re-kick
  skips `needs-human` HALTs, so only an operator clear (`halt clear`, or removing `.pipeline/HALT` and
  `.pipeline/HALT.class`) reaches the next BUILD entry. That entry finds a spent record and dispatches,
  and the retried BUILD appends a fresh record, so a second identical empty cycle is refused again.
  The record is guard authority state (event-spine exception C); the refusal itself is already emitted
  on the spine through `emitLoopHalt`.
- **Test pattern.** Unit tests sit beside the existing `sameNoOpCycle` table in
  `src/conductor/test/engine/build-outcome.test.ts` (`priorOutcome` factory). Conductor tests for
  build-review work use the `fixture({ startFrom: 'build', seedPipeline })` helper in
  `src/conductor/test/engine/conductor-build-review-adjudication.test.ts`. The test `recovers the accepted
  work order and BUILD navigation point from disk alone after a restart` seeds
  `.pipeline/build-review-work-order.json` and `.pipeline/remediation-cases.json` and reads BUILD's retry
  reason. Also seed `.pipeline/kickback-ledger.json` with a `build_review` entry whose `priorVerdict` is
  false, and `.pipeline/build-outcome.json` with the prior record. Take `treeAfter` from `currentTreeHash`
  (`src/conductor/src/engine/project-prelude.ts`) on the fixture root. Take `rung` from the stamped record
  of a first fixture run, as `stamps an escalated no-movement attempt at its actual rung` in
  `src/conductor/test/engine/conductor-kickback-transition.test.ts` does. The non-review gate cases use
  that file's `runBuild(pendingRepair, ledger, { treeHash, buildOutcome })` helper. Assert the provider
  boundary through the fixture's dispatched-step list or the `build` mock, never by token counts.

## Prerequisites

- None.

## Tasks

### Task 1: The guard and record recognize delivered cases and spent refusals
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/build-outcome.test.ts`, extending the `sameNoOpCycle` table that uses `priorOutcome`. A new case `c2` against a prior record with `deliveredCaseIds: ['c1']` returns false. Case `c1` against a prior record without the field returns false. Equal sets `['c1','c2']`, the subset `['c1']` of `['c1','c2']`, and an absent current field against a prior record without the field each return true. A prior record with `refusalSpent: true` returns false. Add a `readBuildOutcome` round-trip for a record carrying both fields, a corrupt-sidecar case where `deliveredCaseIds` is `[1]`, and a `composeBuildOutcomeHaltReason` check for the new sentence; update the existing exact-string expectation.
2. Verify the new cases fail (RED).
3. Implement in `src/conductor/src/engine/build-outcome.ts` as described in Technical Approach: the two optional record fields and their validation, the optional `deliveredCaseIds` input, the subset and not-spent conditions in `sameNoOpCycle`, and the new halt sentence.
4. Verify GREEN, including every pre-existing case in the file unchanged except the updated exact string.
5. Commit: "feat(build-outcome): key the no-op cycle on delivered review cases".

**Done when:**
- [test] `sameNoOpCycle` returns `false` when a current delivered case id is missing from the prior record's `deliveredCaseIds`, and `false` for current `['c1']` against a prior record with no `deliveredCaseIds` field, asserted in `build-outcome.test.ts`.
- [test] `sameNoOpCycle` returns `true` when the other components match and the current delivered ids equal the prior ids, are a subset of them, or are both empty or absent, asserted in `build-outcome.test.ts`.
- [test] `sameNoOpCycle` returns `false` for an otherwise matching prior record carrying `refusalSpent: true`, asserted in `build-outcome.test.ts`.
- [test] `readBuildOutcome` returns a record carrying `deliveredCaseIds` and `refusalSpent` unchanged, and returns the empty record set for a sidecar whose record has `deliveredCaseIds: [1]`.
- [test] `composeBuildOutcomeHaltReason` returns a reason containing both `build_review kickback-to-build refused` and `Clearing this HALT retries BUILD once.`

**Files likely touched:**
- `src/conductor/src/engine/build-outcome.ts` — record fields, validator, guard input and conditions, halt sentence
- `src/conductor/test/engine/build-outcome.test.ts` — new guard, round-trip, and halt-text cases

**Dependencies:** none

### Task 2: BUILD records its delivered cases and the guard compares them
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing conductor tests in `src/conductor/test/engine/conductor-build-review-adjudication.test.ts` using `fixture({ startFrom: 'build', seedPipeline })`, following the seeding pattern in Technical Approach (work order, case store with open action cases, kickback ledger with a pending `build_review` entry, prior `no-movement` build-outcome record at the fixture's real tree hash and stamped rung). (a) The prior record was delivered `c1` and the work order has `c2` and `c3`: assert BUILD is dispatched once, `.pipeline/HALT` is absent when it is dispatched, and the latest build-outcome record's `deliveredCaseIds` equal `['c2','c3']` after it settles. (b) The prior record was delivered `c1` and `c2` and the work order has `c1` and `c2`: assert BUILD is never dispatched, `.pipeline/HALT.class` is `needs-human`, and `.pipeline/HALT` contains `build_review kickback-to-build refused`. (c) A BUILD that fails every attempt with work order `c2`: assert the latest record has `terminalOutcome: 'failed'` and `deliveredCaseIds` equal `['c2']`.
2. Verify (a) and (c) fail (RED).
3. Implement in `src/conductor/src/engine/conductor.ts`: add `caseIds` (sorted) to `durableBuildReviewRetryContext`'s `ready` result; keep a step-local `deliveredBuildReviewCaseIds`, `[]` unless that result was `ready`; pass it as `deliveredCaseIds` to the BUILD-entry `sameNoOpCycle` input; make `deliveredCaseIds` a required `recordBuildOutcome` input written onto the record, and pass it at all four call sites (routed-prerequisite failed, authFailure no-verdict, post-loop failed, done).
4. Verify GREEN, and that the existing `conductor-kickback-transition.test.ts` refusal tests still pass unchanged.
5. Commit: "feat(conductor): record delivered review cases and compare them before BUILD".

**Done when:**
- [test] Through `Conductor.run()` with a pending `build_review` kickback, a same-cycle prior `no-movement` record delivered `c1`, and a work order of `c2` and `c3`, BUILD is dispatched exactly once and `.pipeline/HALT` does not exist at that dispatch.
- [test] After that BUILD settles, `recordBuildOutcome` has written a latest `.pipeline/build-outcome.json` record whose `deliveredCaseIds` equal exactly `['c2','c3']`.
- [test] Through `Conductor.run()` with a same-cycle prior `no-movement` record delivered `c1` and `c2` and a work order of `c1` and `c2`, BUILD is never dispatched, `.pipeline/HALT.class` is `needs-human`, and `.pipeline/HALT` contains `build_review kickback-to-build refused`.
- [test] Through `Conductor.run()` with work order `c2` and a BUILD that fails every attempt, the latest record has `terminalOutcome` `failed` and `deliveredCaseIds` equal to `['c2']`.

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — `durableBuildReviewRetryContext` result, step-local delivered ids, guard input, `recordBuildOutcome` input and its four call sites
- `src/conductor/test/engine/conductor-build-review-adjudication.test.ts` — delivered-case dispatch, refusal, and failed-stamp tests

**Dependencies:** Task 1

### Task 3: Subsets, legacy records, non-review gates, and clean reviews keep their outcome
**Story:** Story 1
**Type:** negative-path

**Steps:**
1. Write conductor tests. In `src/conductor/test/engine/conductor-build-review-adjudication.test.ts`, with the Task 2 seeding: (a) the prior record was delivered `c1` and `c2` and the work order has only `c1`: assert no BUILD dispatch and a `needs-human` `.pipeline/HALT.class`. (b) The prior same-cycle `no-movement` `build_review` record has no `deliveredCaseIds` field and the work order has `c1`: assert BUILD is dispatched once with no `.pipeline/HALT` at that dispatch. (c) A BUILD settles with no tree change under a pending `build_review` kickback, then `build_review` passes (`passAggregate`): assert the step after `build_review` is dispatched and no `.pipeline/HALT` file exists. In `src/conductor/test/engine/conductor-kickback-transition.test.ts`, using `runBuild`: (d) a pending `wiring_check` kickback, no work order, and a same-cycle prior `wiring_check` `no-movement` record without `deliveredCaseIds`: assert `build` is not called and `.pipeline/HALT.class` is `needs-human`.
2. Prove each can fail: temporarily make the subset check an equality check (a), treat an absent prior field as a non-match (d), or treat it as a match regardless of current cases (b); observe RED and restore. (c) pins the existing no-pending-kickback path.
3. Implement: no production change beyond Tasks 1 and 2 is expected; fix any defect these tests expose there.
4. Verify GREEN.
5. Commit: "test(conductor): pin subset, legacy, non-review, and clean-review no-op outcomes".

**Done when:**
- [test] Through `Conductor.run()` with a pending `build_review` kickback, a same-cycle prior `build_review` `no-movement` record delivered `c1` and `c2`, and a work order of only `c1`, BUILD is never dispatched and `.pipeline/HALT.class` is `needs-human`.
- [test] Through `Conductor.run()` with a same-cycle prior `build_review` `no-movement` record lacking `deliveredCaseIds` and a work order of `c1`, BUILD is dispatched exactly once and `.pipeline/HALT` does not exist at that dispatch.
- [test] Through `runBuild` with a pending `wiring_check` kickback, no work order, and a same-cycle prior `wiring_check` `no-movement` record lacking `deliveredCaseIds`, the `build` mock is never called and `.pipeline/HALT.class` is `needs-human`.
- [test] Through `Conductor.run()`, a BUILD settling as `no-movement` under a pending `build_review` kickback followed by a passing `build_review` dispatches the step after `build_review`, and no `.pipeline/HALT` file exists afterwards.

**Files likely touched:**
- `src/conductor/test/engine/conductor-build-review-adjudication.test.ts` — subset, legacy-record, and clean-review tests
- `src/conductor/test/engine/conductor-kickback-transition.test.ts` — wiring_check legacy-record refusal test

**Dependencies:** Task 2

### Task 4: A refusal is spent once so clearing its HALT retries BUILD
**Story:** Story 2
**Type:** happy-path

**Steps:**
1. Write failing conductor tests in `src/conductor/test/engine/conductor-build-review-adjudication.test.ts` with the Task 2 refusal seeding. (a) After the refusal, the latest `.pipeline/build-outcome.json` record has `refusalSpent: true` and `.pipeline/HALT` contains `Clearing this HALT retries BUILD once.` Delete `.pipeline/HALT` and `.pipeline/HALT.class`, run the conductor again on the same root in the same cycle with the same work order, and assert BUILD is dispatched exactly once with no `.pipeline/HALT` at that dispatch. (b) Continue from (a): the retried BUILD settles with no tree change, so its fresh record has no `refusalSpent`. Re-seed the pending `build_review` kickback and run again: assert BUILD is not dispatched and a new `needs-human` HALT is written. (c) With `node:fs/promises` `rename` mocked to reject only when its source path contains `.build-outcome.`, run the refusal: assert `.pipeline/HALT.class` is `needs-human` and BUILD is never dispatched.
2. Verify (a) fails (RED) — today the second run refuses again.
3. Implement in `src/conductor/src/engine/conductor.ts`, in the BUILD-entry guard branch: before `writeHaltMarker`, call `writeBuildOutcomeBestEffort` with the read store whose latest record is replaced by a copy carrying `refusalSpent: true`. Leave the HALT write, state persistence, PR surfacing, and `emitLoopHalt` sequence unchanged.
4. Verify GREEN.
5. Commit: "feat(conductor): spend a no-op refusal so an operator clear retries BUILD once".

**Done when:**
- [test] Through `Conductor.run()`, a refusal leaves the latest `.pipeline/build-outcome.json` record with `refusalSpent: true`; after both HALT files are deleted, the next same-cycle `Conductor.run()` with the same work order dispatches BUILD exactly once and `.pipeline/HALT` does not exist at that dispatch.
- [test] After that retried BUILD records a fresh `no-movement` record, a further same-cycle `Conductor.run()` with the same work order dispatches no BUILD and writes a new `.pipeline/HALT` whose `.pipeline/HALT.class` is `needs-human`.
- [test] With `rename` rejecting for `.build-outcome.` temp files, the guard's refusal still writes `.pipeline/HALT` with `.pipeline/HALT.class` `needs-human` and dispatches no BUILD.
- [test] The refusal's `.pipeline/HALT` written by the guard contains `Clearing this HALT retries BUILD once.`

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — mark the refused record spent before the HALT write
- `src/conductor/test/engine/conductor-build-review-adjudication.test.ts` — clear-and-retry, repeat refusal, and write-failure tests

**Dependencies:** Task 2

## Integration Points

- After Task 2: a seeded gem_miner-shaped cycle (no-op record, then new cases) dispatches BUILD through `Conductor.run()`.
- After Task 4: a refusal followed by an operator HALT clear retries BUILD once without editing `.pipeline/build-outcome.json`.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a prior `no-movement` record for gate `build_review` whose delivered cases are `c1`, when `build_review` kicks back to BUILD in the same cycle with a work order whose cases are `c2` and `c3`, then BUILD is dispatched once and no `.pipeline/HALT` is written before that dispatch. | 2 | "BUILD is dispatched exactly once and `.pipeline/HALT` does not exist at that dispatch" | diff-local |
| Story 1 happy: Given that dispatched BUILD settles, when `.pipeline/build-outcome.json` is read, then its latest record lists exactly `c2` and `c3` as its delivered cases. | 2 | "record whose `deliveredCaseIds` equal exactly `['c2','c3']`" | diff-local |
| Story 1 happy: Given a prior `no-movement` record for gate `build_review` whose delivered cases are `c1` and `c2`, when `build_review` kicks back in the same cycle with a work order whose cases are `c1` and `c2`, then no BUILD provider call is made and `.pipeline/HALT` is written with class `needs-human` and a reason containing `build_review kickback-to-build refused`. | 2 | "BUILD is never dispatched, `.pipeline/HALT.class` is `needs-human`, and `.pipeline/HALT` contains `build_review kickback-to-build refused`" | diff-local |
| Story 1 negative: Given a prior `no-movement` record for gate `build_review` whose delivered cases are `c1` and `c2`, when `build_review` kicks back in the same cycle with a work order whose only case is `c1`, then no BUILD provider call is made and the run halts `needs-human`. | 3 | "a work order of only `c1`, BUILD is never dispatched and `.pipeline/HALT.class` is `needs-human`" | diff-local |
| Story 1 negative: Given a prior `no-movement` record for gate `build_review` that carries no delivered-case field (written before this change), when `build_review` kicks back in the same cycle with a work order whose case is `c1`, then BUILD is dispatched once and no `.pipeline/HALT` is written before that dispatch. | 3 | "lacking `deliveredCaseIds` and a work order of `c1`, BUILD is dispatched exactly once and `.pipeline/HALT` does not exist at that dispatch" | diff-local |
| Story 1 negative: Given a prior `no-movement` record for gate `wiring_check` that carries no delivered-case field, when `wiring_check` kicks back in the same cycle and no build-review work order exists, then no BUILD provider call is made and the run halts `needs-human`. | 3 | "the `build` mock is never called and `.pipeline/HALT.class` is `needs-human`" | diff-local |
| Story 1 negative: Given a zero-work BUILD recorded as `no-movement` while a `build_review` kickback was pending, when the following `build_review` passes, then the run dispatches the step after `build_review` and writes no `.pipeline/HALT`. | 3 | "followed by a passing `build_review` dispatches the step after `build_review`, and no `.pipeline/HALT` file exists afterwards" | diff-local |
| Story 2 happy: Given the guard refused a BUILD and wrote a `needs-human` HALT, when the operator removes `.pipeline/HALT` and `.pipeline/HALT.class` and the conductor re-enters BUILD in the same cycle with the same work order, then BUILD is dispatched exactly once and no HALT is written before that dispatch. | 4 | "the next same-cycle `Conductor.run()` with the same work order dispatches BUILD exactly once and `.pipeline/HALT` does not exist at that dispatch" | diff-local |
| Story 2 happy: Given the guard refuses a BUILD, when the HALT reason is read, then it contains `Clearing this HALT retries BUILD once.` | 4 | "The refusal's `.pipeline/HALT` written by the guard contains `Clearing this HALT retries BUILD once.`" | diff-local |
| Story 2 negative: Given a cleared refusal whose retried BUILD again settles as `no-movement`, when `build_review` kicks back again in the same cycle with the same work order, then no BUILD provider call is made and a new `needs-human` HALT is written. | 4 | "dispatches no BUILD and writes a new `.pipeline/HALT` whose `.pipeline/HALT.class` is `needs-human`" | diff-local |
| Story 2 negative: Given `.pipeline/build-outcome.json` cannot be written when the guard refuses, when the refusal completes, then `.pipeline/HALT` is still written with class `needs-human` and no BUILD provider call is made. | 4 | "the guard's refusal still writes `.pipeline/HALT` with `.pipeline/HALT.class` `needs-human` and dispatches no BUILD" | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-08-05-build-settle-outcome-stamp#D1 | existing | none | `recordBuildOutcome` in `conductor.ts` already stamps tree and HEAD witnesses at every BUILD settle; this change adds fields to the same record. |
| adr-2026-08-05-build-settle-outcome-stamp#D2 | existing | none | `.pipeline/build-outcome.json` stays engine-authored; the delivered case ids come from the engine-read work order, not an agent artifact. |
| adr-2026-08-05-build-settle-outcome-stamp#D3 | task | task-1, task-2, task-4 | `sameNoOpCycle` returns `false` for an otherwise matching prior record carrying `refusalSpent: true` |
| adr-2026-08-05-build-settle-outcome-stamp#D4 | task | task-2 | the latest record has `terminalOutcome` `failed` and `deliveredCaseIds` equal to `['c2']` |
| adr-2026-08-05-build-settle-outcome-stamp#D5 | no-change | none | The 200-line note bound is untouched; the new fields are a bounded id list and a boolean. |
| adr-2026-08-05-build-settle-outcome-stamp#D6 | no-change | none | The refusal still writes the existing `needs-human` class; the `HaltClass` union is not extended. |
| adr-2026-08-05-build-settle-outcome-stamp#D7 | no-change | none | The fields live on `build-outcome.json`; `kickback-ledger.json` and its budgets are not changed. |
| adr-2026-08-05-build-settle-outcome-stamp#D8 | no-change | none | The guard compares adjudicated case ids and does not judge whether a dispute or finding is valid. |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic
- [ ] Tasks do not invalidate each other's fixtures or assertions
