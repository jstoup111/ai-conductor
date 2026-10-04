# Implementation Plan: coverage_binding refuses plans that contradict sealed criteria or approved ADR decisions (#2750)

**Date:** 2026-10-03
**Stories:** .docs/stories/plans-that-contradict-sealed-story-criteria-or-app.md
**Conflict check:** Clean as of 2026-10-03 (2 blocking resolved; report in `.docs/conflicts/plans-that-contradict-sealed-story-criteria-or-app.md`)

## Summary

13 tasks add conflict claims to `coverage_binding`. Every sealed story criterion and every approved ADR decision the plan is subject to is judged against the plan's full task table, on every tier, and a contradiction refuses `needs-human` before any build task, ahead of any D19 reopen.

> **Amended 2026-10-04 by #2750:** Operator-approved S2.12 recovery adds Task 14 to the
> original 13 tasks. ADR amendment inputs now include tier S; D17's structural tier-S skip
> remains. Task 14 owns the runner boundary proof missing from Task 4's helper-only exclusion.

## Technical Approach

- **Inputs (D21).** A new module `coverage-binding-conflict-inputs.ts` owns three pure functions. `buildConflictTaskTable` turns every plan task, remediation ids included, into id, title, and `Done when` checks, with no slice membership. `resolveConflictSubjectAdrs` returns DECIDE-set ADRs plus plan-cited ADRs. Citation reuses `citedDecisionStems` from `rebase.ts`, the same rule post-rebase invalidation uses, so a plan-cited ADR is already a rebase input (Task 13 verifies this rather than adding code). Approval is read through `adrApprovalStatus(...).found`, never its `.approved` flag alone. `assembleConflictClaims` uses `extractAuthoritativeStoryCriteria`, and `parseAdrDecisions` extended to return passages and section text (Task 1). It stays the only ADR decision parser.
- **Envelope and batches (D22).** A third entry kind, `conflict`, and a third batch partition, following the amendment-claim pattern already in `coverage-binding-envelope.ts` and `coverage-binding-batches.ts`. The digest binds claim text to a digest of the whole task table. Batches are bounded by `batch_size` and a fixed byte budget constant, with no new config key. The prompt carries the task table once. The payload is prompt-requested and strictly parsed, like amendment claims, and task ids are resolved by `resolveCitedPlanTaskIds`.
- **Runner (D22, D23).** `runCoverageBinding` assembles, dispatches, and checkpoints conflict claims after amendment claims, through `executeAuxiliaryProviderCandidates` with the existing `coverage-binding` skill invocation. Conflict verdicts are evaluated before the D19 reopen branch. Any `conflicts` verdict refuses through the existing D6 refusal path and skips reopen entirely. D19 keeps iterating criterion coverage claims only. Judge disabled: `unjudged`, no dispatch.
- **Event (D24).** `coverage_binding_conflict_judged` joins the union and the sink registry beside its siblings.
- **Judge policy.** `skills/coverage-binding/SKILL.md` gains the conflict policy: uncovered is `consistent`, and `conflicts` must name tasks and state the incompatibility.
- **Sequencing.** Pure inputs (1–4) and envelope (5) first; batches and parser (6–7); runner (8), refusal precedence (9), events (10); skill policy (11) in parallel; evidence replay (12) last; verify-only rebase and land (13) independent.

## Prerequisites

- Amended `adr-2026-08-31-coverage-binding-judge-step` (D21–D24) and `adr-2026-08-22-one-owner-per-review-question` (D1) are APPROVED in this spec.

## Tasks

### Task 1: Return each citable decision's passages from `parseAdrDecisions`
**Story:** 2
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/artifacts.test.ts`: an ADR with D-headings and numbered items returns `passages` keyed by id with each passage's text; an ADR whose id 4 labels two passages returns both under id 4 in source order; `section` holds the whole `## Decision` text; every existing `parseAdrDecisions` test keeps its `ids` set and its `missing-decision-heading` diagnostic.
2. Verify tests fail (RED).
3. Implement in `src/conductor/src/engine/artifacts.ts`: extend the `decisions` result of `parseAdrDecisions` with `passages: Map<string, string[]>` (a passage runs from its decision line to the next decision line or section end, blockquote markers stripped) and `section: string`. Keep it the only interpreter of a `## Decision` section (adr-2026-09-02-adr-decision-citability-contract item 1); do not add a second ADR parser. Existing callers read only `ids` and are unchanged.
4. Verify tests pass (GREEN).
5. Commit: "feat(artifacts): return ADR decision passages beside citable ids"

**Done when:**
- `parseAdrDecisions` in `src/conductor/src/engine/artifacts.ts` returns, beside its unchanged `ids` set, a `passages` map from each citable decision id to the text of every passage under that id and a `section` string holding the whole `## Decision` text, as asserted by the decision-passages test in `src/conductor/test/engine/artifacts.test.ts`
- for an ADR in which decision id 4 labels two separate passages, `parseAdrDecisions` returns one `passages` entry for id 4 carrying both passage texts in source order, as asserted by the duplicate-id passages test in `src/conductor/test/engine/artifacts.test.ts`
- every pre-existing `parseAdrDecisions` test in `src/conductor/test/engine/artifacts.test.ts` still observes the same `ids` set and the same `missing-decision-heading` diagnostic for an ADR with no `## Decision` heading

**Files:**
- `src/conductor/src/engine/artifacts.ts` — decision passages and section text
- `src/conductor/test/engine/artifacts.test.ts` — passage tests

**Dependencies:** none

### Task 2: Build the conflict task table from every plan task
**Story:** 1
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/coverage-binding-conflict-inputs.test.ts` for `buildConflictTaskTable`: a plan with tasks `1`, `2`, and remediation task `rem-build-review-2` yields three rows with id, heading title, and `Done when` checks; a task with no `Done when` block yields a row with its id and title and an empty checks list; a plan with a `## Slices` manifest yields rows with no slice field or slice text. Add a `parsePlanTaskTitles` test in `src/conductor/test/engine/plan-task-parse.test.ts`.
2. Verify tests fail (RED).
3. Implement `parsePlanTaskTitles` in `src/conductor/src/engine/plan-task-parse.ts` using the same task-heading grammar as `parsePlanTaskBodies` (ids `[A-Za-z0-9._-]`), and `buildConflictTaskTable(planText)` in the new `src/conductor/src/engine/coverage-binding-conflict-inputs.ts` joining titles with `parsePlanTaskDoneWhen`. Slice membership never enters the table (adr-2026-09-29-plan-slice-manifest D6).
4. Verify tests pass (GREEN).
5. Commit: "feat(coverage-binding): conflict task table over every plan task"

**Done when:**
- `buildConflictTaskTable` in `src/conductor/src/engine/coverage-binding-conflict-inputs.ts` returns one row per plan task heading, including the remediation id `rem-build-review-2`, each carrying the task id, its heading title from `parsePlanTaskTitles`, and its `Done when` checks from `parsePlanTaskDoneWhen`, as asserted by the task-table test in `src/conductor/test/engine/coverage-binding-conflict-inputs.test.ts`
- a plan task with no `Done when` block appears in the table returned by `buildConflictTaskTable` with its id and title and an empty checks list, as asserted by the no-done-when row test in `src/conductor/test/engine/coverage-binding-conflict-inputs.test.ts`
- a plan carrying a `## Slices` manifest yields task rows with no slice field and no slice text, as asserted by the slice-exclusion test in `src/conductor/test/engine/coverage-binding-conflict-inputs.test.ts`

**Files:**
- `src/conductor/src/engine/plan-task-parse.ts` — `parsePlanTaskTitles`
- `src/conductor/src/engine/coverage-binding-conflict-inputs.ts` — new module: `buildConflictTaskTable`
- `src/conductor/test/engine/plan-task-parse.test.ts` — title parse test
- `src/conductor/test/engine/coverage-binding-conflict-inputs.test.ts` — new task-table tests

**Dependencies:** none

### Task 3: Resolve the subject ADRs of a plan
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/coverage-binding-conflict-inputs.test.ts` for `resolveConflictSubjectAdrs`: the union of the DECIDE-set ADR paths and existing decision-record files for stems `citedDecisionStems` finds in the plan text; an ADR whose status is `Approved` in mixed case or `**Status:** APPROVED` is kept; `SUPERSEDED in part by <stem>` is kept; `DRAFT` and a full `SUPERSEDED by <stem>` are dropped; a cited stem with no file is dropped without error; an uncited, branch-unchanged approved ADR is absent.
2. Verify tests fail (RED).
3. Implement `resolveConflictSubjectAdrs({ projectRoot, planText, decideSetAdrPaths })` in `src/conductor/src/engine/coverage-binding-conflict-inputs.ts`. Reuse `citedDecisionStems` from `src/conductor/src/engine/rebase.ts` (the same citation rule post-rebase invalidation uses) and the DECIDE-set ADR paths from `resolveCoverageBindingDecideSet`. Read status through `adrApprovalStatus(...).found`; do not trust its `.approved` flag alone, because it is also true for SUPERSEDED. Keep a `found` value that begins `approved` (any case) or that is a supersession qualified `in part`; drop everything else.
4. Verify tests pass (GREEN).
5. Commit: "feat(coverage-binding): resolve subject ADRs for conflict claims"

**Done when:**
- `resolveConflictSubjectAdrs` in `src/conductor/src/engine/coverage-binding-conflict-inputs.ts` returns the union of the DECIDE-set ADR paths from `resolveCoverageBindingDecideSet` and every existing decision-record file for a stem `citedDecisionStems` finds in the plan text, so a branch-changed uncited ADR and a plan-cited unchanged ADR are both returned, as asserted by the subject-set test in `src/conductor/test/engine/coverage-binding-conflict-inputs.test.ts`
- `resolveConflictSubjectAdrs` keeps an ADR whose `adrApprovalStatus(...).found` is `Approved` in mixed case and an ADR whose status reads `SUPERSEDED in part by` another ADR, as asserted by the status-variant test in `src/conductor/test/engine/coverage-binding-conflict-inputs.test.ts`
- `resolveConflictSubjectAdrs` returns no path for a cited `DRAFT` ADR, a cited ADR fully superseded by another ADR, a cited stem with no decision-record file (without throwing), or an approved ADR the plan does not cite and the branch does not change, as asserted by the four exclusion tests in `src/conductor/test/engine/coverage-binding-conflict-inputs.test.ts`

**Files:**
- `src/conductor/src/engine/coverage-binding-conflict-inputs.ts` — `resolveConflictSubjectAdrs`
- `src/conductor/test/engine/coverage-binding-conflict-inputs.test.ts` — subject-set tests

**Dependencies:** none

### Task 4: Assemble criterion and ADR-decision conflict claims
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/coverage-binding-conflict-inputs.test.ts` for `assembleConflictClaims`: one `criterion` claim per `extractAuthoritativeStoryCriteria` string (including a criterion no coverage row cites), each carrying the full task table; one `adr-decision` claim per decision id of each subject ADR with every passage; one `<stem>#Decision` claim for a subject ADR with a `## Decision` section and no citable id; no claim for a decision whose passage lies inside an amendment block that `assembleAmendmentClaims` returns; DRAFT, fully superseded, missing, and uncited-unchanged ADRs yield no claim; applicability as listed in Done when.
2. Verify tests fail (RED).
3. Implement `assembleConflictClaims({ planText, storiesText, subjectAdrs, amendmentClaims })` in `src/conductor/src/engine/coverage-binding-conflict-inputs.ts`, using `extractAuthoritativeStoryCriteria` (the one readability owner, adr-2026-09-23-one-owner-for-accepted-story-readability), Task 1's `passages` and `section`, Task 2's table, and Task 3's subject set. A claim is `{ id, kind: "criterion" | "adr-decision", text, taskTable, applicability }`. Use these closed applicability rules: no task with a `Done when` block makes every claim `not-applicable`; an ADR returning the `missing-decision-heading` diagnostic yields one `not-applicable` claim `<stem>#Decision`; a stories file with no extractable criterion yields one `not-applicable` claim with id `stories#unparseable` and no criterion claims.
4. Verify tests pass (GREEN).
5. Commit: "feat(coverage-binding): assemble conflict claims over every task"

**Done when:**
- `assembleConflictClaims` in `src/conductor/src/engine/coverage-binding-conflict-inputs.ts` returns one `criterion` conflict claim per string `extractAuthoritativeStoryCriteria` returns for the stories file, including a criterion that no coverage row cites, and each claim carries the full table from `buildConflictTaskTable` so every plan task's `Done when` checks reach it, as asserted by the criterion-claims test in `src/conductor/test/engine/coverage-binding-conflict-inputs.test.ts`
- `assembleConflictClaims` returns one `adr-decision` claim identified `<stem>#D<n>` per `parseAdrDecisions` id of each subject ADR, carrying every passage under that id in one claim, and one claim identified `<stem>#Decision` carrying the whole `## Decision` text for a subject ADR whose section has no citable id, as asserted by the decision-claims test in `src/conductor/test/engine/coverage-binding-conflict-inputs.test.ts`
- `assembleConflictClaims` creates no conflict claim for a cited `DRAFT` ADR, a cited fully superseded ADR, a cited stem with no file, an uncited branch-unchanged approved ADR, or a decision whose passage lies inside an amendment block that `assembleAmendmentClaims` returns, which stays judged only as that amendment claim, as asserted by the exclusion tests in `src/conductor/test/engine/coverage-binding-conflict-inputs.test.ts`
- `assembleConflictClaims` marks claims `applicable` when at least one plan task has a `Done when` block, so a claim on a plan whose other tasks lack one is still judged, and marks every claim `not-applicable` when no task has one, as asserted by the applicability tests in `src/conductor/test/engine/coverage-binding-conflict-inputs.test.ts`

**Files:**
- `src/conductor/src/engine/coverage-binding-conflict-inputs.ts` — `assembleConflictClaims`
- `src/conductor/test/engine/coverage-binding-conflict-inputs.test.ts` — claim assembly tests

**Dependencies:** Tasks 1, 2, 3

### Task 5: Add conflict envelope entries and the task-table-bound digest
**Story:** 4
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/coverage-binding-envelope.test.ts`: an entry with `kind: "conflict"`, `claimKind`, claim id, and each verdict round-trips; a pre-change envelope with no conflict entries parses; `COVERAGE_BINDING_COMPLETION_STATUSES` still equals `['disabled', 'done']`; `conflictClaimDigest` changes when one task title or one `Done when` check changes and is stable otherwise.
2. Verify tests fail (RED).
3. Implement in `src/conductor/src/engine/coverage-binding-envelope.ts`: the `conflict` entry kind (fields `claimKind`, `claimId`, `verdict` in `consistent | conflicts | not-applicable | unjudged`, plus `taskIds` and `conflict` on `conflicts`), and `conflictClaimDigest(claim)` hashing the claim text with a digest of the canonical task table. Pattern: the `amendment` entry kind and `amendmentClaimDigest` in the same file; the entry parser keeps rejecting unknown keys.
4. Verify tests pass (GREEN).
5. Commit: "feat(coverage-binding): conflict envelope entries"

**Done when:**
- `parseCoverageBindingEnvelope` in `src/conductor/src/engine/coverage-binding-envelope.ts` round-trips an entry with `kind: "conflict"`, a `claimKind` of `criterion` or `adr-decision`, a claim id, and each verdict `consistent`, `conflicts` with `taskIds` and `conflict`, `not-applicable`, and `unjudged`, as asserted by the conflict-entry test in `src/conductor/test/engine/coverage-binding-envelope.test.ts`
- an envelope written before this change with no `conflict` entries parses without error and `COVERAGE_BINDING_COMPLETION_STATUSES` still equals `['disabled', 'done']`, as asserted by the legacy-envelope test in `src/conductor/test/engine/coverage-binding-envelope.test.ts`
- `conflictClaimDigest` in `src/conductor/src/engine/coverage-binding-envelope.ts` changes when one task title or one `Done when` check in the table changes and stays equal for an unchanged table and claim text, as asserted by the conflict-digest test in `src/conductor/test/engine/coverage-binding-envelope.test.ts`

**Files:**
- `src/conductor/src/engine/coverage-binding-envelope.ts` — conflict entry kind and digest
- `src/conductor/test/engine/coverage-binding-envelope.test.ts` — round-trip and digest tests

**Dependencies:** none

### Task 6: Partition, cache, and size conflict batches and render their prompt
**Story:** 4
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/coverage-binding-batches.test.ts`: conflict claims form their own pending list; a matching prior verdict other than `unjudged` is a cache hit; a changed task table makes every conflict claim pending; a pre-change envelope leaves all conflict claims pending; batches respect `batch_size` and `CONFLICT_BATCH_PROMPT_BYTE_BUDGET`; an oversize claim sits alone and untruncated; the rendered prompt carries the task table once, then per claim its issued id, kind, and text.
2. Verify tests fail (RED).
3. Implement in `src/conductor/src/engine/coverage-binding-batches.ts`: a third partition beside criterion and amendment claims in `planCoverageBindingBatches`, the exported constant `CONFLICT_BATCH_PROMPT_BYTE_BUDGET`, a greedy in-order chunker bounded by both limits, and `renderConflictBatchPrompt(batch, taskTable)`. Pattern: the amendment partition in the same function; allowed variation: the byte budget value. No config key is added (adr-2026-08-26-config-key-consumer-registry-and-dead-surface-removal).
4. Verify tests pass (GREEN).
5. Commit: "feat(coverage-binding): conflict batch planning and prompt"

**Done when:**
- `planCoverageBindingBatches` in `src/conductor/src/engine/coverage-binding-batches.ts` puts conflict claims in their own pending list, never mixed into criterion or amendment batches, and reuses a prior entry with a matching `conflictClaimDigest` and a verdict other than `unjudged` as a cache hit that is not re-dispatched, as asserted by the conflict-partition and conflict-cache tests in `src/conductor/test/engine/coverage-binding-batches.test.ts`
- when a prior `consistent` entry's task table changed, or the prior envelope has no conflict entries, that prior envelope is read by `readCoverageBindingEnvelope` without being rejected as malformed and `planCoverageBindingBatches` leaves every conflict claim pending so each is re-judged, as asserted by the re-judge tests in `src/conductor/test/engine/coverage-binding-batches.test.ts`
- conflict batches hold at most `batch_size` claims and at most `CONFLICT_BATCH_PROMPT_BYTE_BUDGET` bytes of claim text, and a claim whose text alone exceeds that budget is placed alone in its own batch with its full untruncated text, as asserted by the byte-budget test in `src/conductor/test/engine/coverage-binding-batches.test.ts`
- `renderConflictBatchPrompt` in `src/conductor/src/engine/coverage-binding-batches.ts` emits the plan task table exactly once, followed per claim by its issued id, its kind `criterion` or `adr-decision`, and its text, as asserted by the prompt-shape test in `src/conductor/test/engine/coverage-binding-batches.test.ts`

**Files:**
- `src/conductor/src/engine/coverage-binding-batches.ts` — conflict partition, byte budget, prompt
- `src/conductor/test/engine/coverage-binding-batches.test.ts` — batch tests

**Dependencies:** Tasks 4, 5

### Task 7: Parse conflict batch payloads under a closed vocabulary
**Story:** 4
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/coverage-binding-envelope.test.ts` for `parseConflictBatchPayload`: accept an exact issued-id set with `consistent` and `conflicts` verdicts; reject each of: unknown task id, empty `taskIds`, empty `conflict`, missing issued id, foreign id, duplicated id, and a verdict word other than `consistent` or `conflicts`.
2. Verify tests fail (RED).
3. Implement `parseConflictBatchPayload(payload, issuedIds, planText)` in `src/conductor/src/engine/coverage-binding-envelope.ts`, validating `taskIds` through `resolveCitedPlanTaskIds` (the shared plan task reference resolver, adr-2026-08-30-shared-plan-task-reference-resolver D1). Pattern: `parseAmendmentBatchPayload` in the same file; allowed variation: field names. The closed shape is requested in the prompt and parsed strictly; no `nativeSchema` option is added.
4. Verify tests pass (GREEN).
5. Commit: "feat(coverage-binding): strict conflict payload parser"

**Done when:**
- `parseConflictBatchPayload` in `src/conductor/src/engine/coverage-binding-envelope.ts` accepts `{ verdicts: [{ id, verdict }] }` only when the returned ids equal the issued id set exactly once each, every verdict is `consistent` or `conflicts`, and every `conflicts` verdict has non-empty `taskIds` that `resolveCitedPlanTaskIds` resolves against the plan and a non-empty `conflict`, as asserted by the conflict-payload accept test in `src/conductor/test/engine/coverage-binding-envelope.test.ts`
- `parseConflictBatchPayload` returns a whole-batch rejection carrying no verdict for each of a task id not in the plan, an empty `taskIds` list, an empty `conflict` statement, a missing issued id, a foreign id, a duplicated id, and a verdict word other than `consistent` or `conflicts`, as asserted by the seven conflict-payload rejection tests in `src/conductor/test/engine/coverage-binding-envelope.test.ts`

**Files:**
- `src/conductor/src/engine/coverage-binding-envelope.ts` — `parseConflictBatchPayload`
- `src/conductor/test/engine/coverage-binding-envelope.test.ts` — accept and reject tests

**Dependencies:** Task 5

### Task 8: Judge conflict claims in `runCoverageBinding`
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/coverage-binding-runner.test.ts` with a stubbed auxiliary provider: conflict batches are dispatched and one `conflict` entry per claim is recorded; with the judge disabled no conflict batch is dispatched, every entry is `unjudged`, and the step returns the status and output it returns without conflict claims; the three `not-applicable` inputs dispatch nothing and neither refuse nor fail; a rejected later batch raises `CoverageBindingPayloadError` and keeps the earlier batch in a `partial` envelope.
2. Verify tests fail (RED).
3. Implement in `src/conductor/src/engine/step-runners.ts` `runCoverageBinding`: after amendment claims, resolve subject ADRs (Task 3) and assemble conflict claims (Task 4), plan batches (Task 6), dispatch each batch as one fresh session through `executeAuxiliaryProviderCandidates` with `renderAuxiliarySkillInvocation('coverage-binding')` and `renderConflictBatchPrompt`, parse with `parseConflictBatchPayload` (raising `CoverageBindingPayloadError` on rejection, the existing typed infrastructure failure), and checkpoint `partial` after each accepted batch. Judge disabled: record `unjudged` entries and dispatch nothing. Pattern: the amendment-claim block in the same runner (search `parseAmendmentBatchPayload`); allowed variation: helper extraction.
4. Verify tests pass (GREEN).
5. Commit: "feat(coverage-binding): judge conflict claims before build"

**Done when:**
- `runCoverageBinding` in `src/conductor/src/engine/step-runners.ts`, with the judge enabled, dispatches each conflict batch as one fresh session through `executeAuxiliaryProviderCandidates` and records one `conflict` envelope entry per conflict claim in `.pipeline/coverage-binding.json`, as asserted by the conflict-dispatch test in `src/conductor/test/engine/coverage-binding-runner.test.ts`
- with `coverage_binding.judge.enabled` false on a plan holding a contradicting task, `runCoverageBinding` dispatches no conflict batch, records every conflict entry `unjudged`, and returns the same status and output it returns for that plan without conflict claims, as asserted by the judge-disabled conflict test in `src/conductor/test/engine/coverage-binding-runner.test.ts`
- with the judge enabled, a stories file with no extractable criterion, a plan with no `Done when` block in any task, and a cited ADR with no `## Decision` section each record their conflict entries `not-applicable`, dispatch no conflict batch for them, and leave the step neither refused nor failed, as asserted by the three not-applicable runner tests in `src/conductor/test/engine/coverage-binding-runner.test.ts`
- when a later conflict batch's payload is rejected, `runCoverageBinding` raises `CoverageBindingPayloadError`, records no verdict from that batch, and keeps the earlier accepted batch's verdicts in an envelope whose status is `partial`, not `done`, as asserted by the partial-checkpoint conflict test in `src/conductor/test/engine/coverage-binding-runner.test.ts`

**Files:**
- `src/conductor/src/engine/step-runners.ts` — conflict claims in `runCoverageBinding`
- `src/conductor/test/engine/coverage-binding-runner.test.ts` — runner tests

**Dependencies:** Tasks 3, 4, 6, 7

### Task 9: Refuse on conflict before any reopen, and pass consistent plans
**Story:** 1
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/coverage-binding-runner.test.ts`: a `conflicts` verdict refuses `needs-human` with the listed rendering; after an `invalidated` previous envelope, a conflict plus a changed coverage claim citing completed task 2 refuses with zero `admitAndRestageRepair` calls; a previous `invalidated` envelope without conflict entries and all-`consistent` verdicts reopens nothing because of conflict digests; consistent plans complete `done`; a `does-not-assert` coverage verdict with all conflicts `consistent` refuses naming only the coverage claim.
2. Verify tests fail (RED).
3. Implement in `src/conductor/src/engine/step-runners.ts`: evaluate conflict verdicts before any D19 reopen. Today the criterion digest-absent reopen runs before dispatch and the amendment `contradictsCompleted` reopen runs inside the amendment batch loop; collect both reopen candidates instead of applying them, judge conflict claims, and apply the collected reopens only when no conflict entry is `conflicts`; when any is `conflicts`, refuse through the existing D6 refusal path (`refused`, kind `needs-human`, `writeHaltMarker` class `needs-human`; no new halt class) and skip reopen, append, and routing entirely. Render, per conflicting claim, the criterion text or `<stem>#D<n>` / `<stem>#Decision`, each conflicting task id with its `Done when` checks, and the judge's `conflict`. Keep the D19 digest-absent check iterating criterion coverage claims only, so conflict digests never feed it.
4. Verify tests pass (GREEN).
5. Commit: "feat(coverage-binding): refuse contradictory plans before reopen"

**Done when:**
- when any conflict entry is `conflicts`, `runCoverageBinding` in `src/conductor/src/engine/step-runners.ts` returns a refusal of kind `needs-human` through the existing refusal path that calls `writeHaltMarker` with class `needs-human` before any build task is dispatched, and its refusal text names, per conflicting claim, the criterion text or `<stem>#D<n>` or `<stem>#Decision`, each conflicting task id, that task's `Done when` checks, and the judge's `conflict` statement, as asserted by the conflict-refusal test in `src/conductor/test/engine/coverage-binding-runner.test.ts`
- on a run whose previous envelope is `invalidated`, with a changed criterion coverage claim citing completed task 2, an amendment claim whose verdict lists completed task 3 in `contradictsCompleted`, and one conflict entry `conflicts`, `runCoverageBinding` refuses `needs-human`, calls `admitAndRestageRepair` zero times, leaves tasks 2 and 3 and every other completed task with persisted status `completed` so no completed task is reopened, appends no plan task, and routes no step to `plan`, while the same run with every conflict entry `consistent` still reopens tasks 2 and 3, as asserted by the conflict-precedence tests in `src/conductor/test/engine/coverage-binding-runner.test.ts`
- on a run whose previous `invalidated` envelope has no conflict entries and every conflict claim returns `consistent`, `runCoverageBinding` reopens no completed task because of a conflict entry's digest, since only criterion coverage claim digests feed the reopen check, as asserted by the conflict-digest-no-reopen test in `src/conductor/test/engine/coverage-binding-runner.test.ts`
- with stubbed `consistent` verdicts for every conflict claim, `runCoverageBinding` completes `done` with no halt on a plan whose tasks each cover a different criterion, on a spec with zero criterion coverage claims on any carrier, and on a plan leaving one criterion uncovered by any task, as asserted by the consistent-plan tests in `src/conductor/test/engine/coverage-binding-runner.test.ts`
- with every conflict claim `consistent` and one criterion coverage claim `does-not-assert`, `runCoverageBinding` refuses through the coverage refusal naming only that coverage claim, so the conflict layer adds no refusal and the coverage claims alone decide, as asserted by the coverage-alone-decides test in `src/conductor/test/engine/coverage-binding-runner.test.ts`

**Files:**
- `src/conductor/src/engine/step-runners.ts` — conflict refusal and D19 precedence
- `src/conductor/test/engine/coverage-binding-runner.test.ts` — refusal and precedence tests

**Dependencies:** Task 8

### Task 10: Emit `coverage_binding_conflict_judged` on the event spine
**Story:** 5
**Type:** happy-path

**Steps:**
1. Write failing tests: `src/conductor/test/engine/event-sinks.test.ts` exhaustiveness covers `coverage_binding_conflict_judged` with persist on, audit off, otel off; `src/conductor/test/engine/coverage-binding-runner.test.ts` asserts one event per conflict claim (verdict `unjudged` when disabled), refusal recorded only by `step_refused` and `loop_halt`, and the existing coverage and amendment event vocabularies unchanged.
2. Verify tests fail (RED).
3. Implement: add `coverage_binding_conflict_judged` (claim kind, claim id, verdict, task ids) to the `ConductorEvent` union in `src/conductor/src/types/events.ts`, its row in `src/conductor/src/engine/event-sinks.ts` matching its `coverage_binding_*` siblings, and its emission in `runCoverageBinding` through the existing emitter. Pattern: `coverage_binding_amendment_judged` in all three files.
4. Verify tests pass (GREEN).
5. Commit: "feat(coverage-binding): conflict judgement event"

**Done when:**
- `coverage_binding_conflict_judged` is a member of the `ConductorEvent` union in `src/conductor/src/types/events.ts` carrying the claim kind, the verdict (`consistent`, `conflicts`, `not-applicable`, or `unjudged`), and the conflicting task ids, and is declared in `src/conductor/src/engine/event-sinks.ts` with persist on, audit off, and otel off, as asserted by the sink-registry exhaustiveness test in `src/conductor/test/engine/event-sinks.test.ts`
- `runCoverageBinding` emits one `coverage_binding_conflict_judged` event per conflict claim, persisted to `.pipeline/events.jsonl` with its claim kind, verdict, and conflicting task ids, and with verdict `unjudged` for each claim when the judge is disabled, as asserted by the conflict-event tests in `src/conductor/test/engine/coverage-binding-runner.test.ts`
- a conflict refusal is recorded by the existing `step_refused` and `loop_halt` events and no conflict-specific halt event is emitted, as asserted by the refusal-events test in `src/conductor/test/engine/coverage-binding-runner.test.ts`
- in a run judging criterion, amendment, and conflict claims, `coverage_binding_judged` events carry only `asserts`, `does-not-assert`, or `not-applicable` and `coverage_binding_amendment_judged` events carry only their existing verdict values, as asserted by the vocabulary-unchanged test in `src/conductor/test/engine/coverage-binding-runner.test.ts`

**Files:**
- `src/conductor/src/types/events.ts` — event union member
- `src/conductor/src/engine/event-sinks.ts` — sink row
- `src/conductor/src/engine/step-runners.ts` — event emission
- `src/conductor/test/engine/event-sinks.test.ts` — exhaustiveness
- `src/conductor/test/engine/coverage-binding-runner.test.ts` — event tests

**Dependencies:** Tasks 8, 9

### Task 11: Teach the coverage-binding judge the conflict policy
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write a failing test in `src/conductor/test/engine/coverage-binding-skill-contract.test.ts` that `skills/coverage-binding/SKILL.md` carries a conflict-claims section with the policy and result contract below.
2. Verify test fails (RED).
3. Implement in `skills/coverage-binding/SKILL.md`: a conflict-claims section stating that a claim is `conflicts` only when satisfying a named task's `Done when` checks would necessarily violate the claim; that an uncovered or differently covered criterion is `consistent`; that `conflicts` must list the conflicting task ids and state the incompatible requirement; and the result contract `{ verdicts: [{ id, verdict, taskIds?, conflict? }] }`.
4. Verify test passes (GREEN).
5. Commit: "feat(skills): coverage-binding conflict judgement policy"

**Done when:**
- `skills/coverage-binding/SKILL.md` carries a conflict-claims section stating that a claim is `conflicts` only when satisfying a named task's `Done when` checks would necessarily violate it, and that a criterion merely uncovered or covered by a different task is `consistent`, as asserted by the conflict-policy test in `src/conductor/test/engine/coverage-binding-skill-contract.test.ts`
- the same section requires `conflicts` to list the conflicting task ids and state the incompatible requirement, and gives the result contract `{ verdicts: [{ id, verdict, taskIds?, conflict? }] }`, as asserted by the conflict-contract test in `src/conductor/test/engine/coverage-binding-skill-contract.test.ts`

**Files:**
- `skills/coverage-binding/SKILL.md` — conflict judgement policy
- `src/conductor/test/engine/coverage-binding-skill-contract.test.ts` — skill contract tests

**Dependencies:** none

### Task 12: Replay the six evidence cases through `runCoverageBinding`
**Story:** 2
**Type:** happy-path

**Steps:**
1. Author fixtures under `src/conductor/test/fixtures/coverage-binding-conflicts/` reproducing, verbatim from #2750 and its 2026-10-02 comment, the two sides of each conflict: case 1 (Tasks 3 and 20 vs Task 8 `provider_attempt`), case 2 (invalidation model vs judge-disabled no-reopen), case 3 (Task 8 `endpoint` assertions vs credential-only diff), tier S decision 4 (Tasks 7 to 10), and tier S Task 6 vs the enum-pin and roster ADRs. Write failing tests in `src/conductor/test/engine/coverage-binding-conflict-replay.test.ts` that run `runCoverageBinding` with a stub judge capturing prompts.
2. Verify tests fail (RED).
3. Implement nothing new in production code unless a replay exposes a defect in Tasks 1 to 10; fix such a defect in the owning module.
4. Verify tests pass (GREEN).
5. Commit: "test(coverage-binding): replay #2750 evidence conflicts"

**Done when:**
- for the case-1 fixture, the conflict prompt captured from `runCoverageBinding` carries the sealed criterion's claim with the `Done when` checks of Task 3, Task 8, and Task 20, and a stubbed `conflicts` verdict naming Task 8 refuses `needs-human` before any build task naming the criterion text, Task 8, Task 8's `Done when` checks, and the conflict statement, as asserted by the case-1 replay test in `src/conductor/test/engine/coverage-binding-conflict-replay.test.ts`
- for the case-2 fixture (invalidation-model task vs the judge-disabled no-reopen negative criterion) and the case-3 fixture (Task 8 `endpoint` assertions vs the credential-only assertion-diff criterion), a stubbed `conflicts` verdict naming the task refuses `needs-human` naming that sealed criterion and that task, as asserted by the case-2 and case-3 replay tests in `src/conductor/test/engine/coverage-binding-conflict-replay.test.ts`
- for the tier S fixture whose plan cites an approved ADR whose decision 4 forbids endpoint assertions of generated values, the captured prompt carries a `<stem>#D4` claim judged against every plan task, and a stubbed `conflicts` verdict naming Tasks 7 to 10 refuses `needs-human` naming `<stem>#D4` and Tasks 7, 8, 9, and 10, as asserted by the tier-S decision replay test in `src/conductor/test/engine/coverage-binding-conflict-replay.test.ts`
- for the tier S fixture whose Task 6 requires a YAML enum pin and registry tuples and whose plan cites two approved ADRs forbidding the enum pin and roster transcription, stubbed `conflicts` verdicts naming Task 6 for each decision refuse `needs-human` naming both decisions and Task 6, as asserted by the two-ADR replay test in `src/conductor/test/engine/coverage-binding-conflict-replay.test.ts`
- after a fixture whose conflict claims are all stubbed `consistent` completes `coverage_binding` `done`, one conductor loop run dispatches the first build task, as asserted by the consistent-plan loop test in `src/conductor/test/engine/coverage-binding-conflict-replay.test.ts`

**Files:**
- `src/conductor/test/fixtures/coverage-binding-conflicts/` — six evidence fixtures
- `src/conductor/test/engine/coverage-binding-conflict-replay.test.ts` — replay tests

**Dependencies:** Tasks 9, 10

### Task 13: Confirm rebase inputs and land are unchanged for subject ADRs
**Story:** 3
**Type:** verification

**Steps:**
1. Add a test in `src/conductor/test/engine/rebase.test.ts`: `resolveReviewInputs` includes the decision-record path of an ADR the plan cites by stem, so a base delta touching only that ADR invalidates `coverage_binding`. Add a test in `src/conductor/test/engine/engineer/land-spec.test.ts` that an existing passing land fixture still lands with no new rejection identifier.
2. Run both tests; they are expected to pass on the current code (plan-cited ADRs are already rebase inputs through `citedDecisionStems`, and land is untouched by this plan).
3. If either fails, stop and report the failing test to the operator; do not change production code in this task.
4. Commit the tests with an `Evidence: skipped existing-behavior` trailer if no production change was needed.

**Done when:**
- `resolveReviewInputs` in `src/conductor/src/engine/rebase.ts`, through `citedDecisionStems`, includes a plan-cited ADR's path, so a rebase whose new base changes only that ADR invalidates `coverage_binding` and it is re-run before the next build task, as asserted by the cited-ADR rebase test in `src/conductor/test/engine/rebase.test.ts`
- `landSpec` accepts an existing passing land fixture spec unchanged, with no new rejection identifier and no new required plan or coherence section, as asserted by the unchanged-land test in `src/conductor/test/engine/engineer/land-spec.test.ts`

**Files:**
- `src/conductor/test/engine/rebase.test.ts` — cited-ADR rebase input test
- `src/conductor/test/engine/engineer/land-spec.test.ts` — unchanged-land test

**Verify-only:** yes

**Dependencies:** none

### Task 14: Judge branch-added ADR amendments only as amendments at tier S
**Story:** 2
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/coverage-binding-runner.test.ts` through `runCoverageBinding`, using the real amendment/conflict assembly and an injected fake provider. Supply a tier-S plan and a DECIDE-set ADR whose branch-added amendment introduces a new citable decision; supply controlled merge-base and base ADR content through the Git seam. Capture amendment and conflict prompts and the persisted envelope. Do not call a real provider or run the full conductor lifecycle.
2. Establish RED through `ai-conductor scoped-run coverage-binding-runner.test.ts`: the new decision must reach amendment judgement and must never appear as a conflict claim. Include an enabled-judge `not-carried` verdict proving the amendment refuses `needs-human`, an inherited amendment exclusion case, and a judge-disabled case proving no provider dispatch or refusal. Assert D17 remains `not-applicable` at S independently of the amendment verdict.
3. In `src/conductor/src/engine/step-runners.ts`, remove the complexity-tier exclusion for ADR files from the DECIDE amendment input filter. Preserve merge-base filtering, the existing amendment parser, claim schema, and judge-disabled path. Keep D17's structural ADR-obligation tier gate intact. Feed the assembled amendment claims into the existing conflict exclusion; do not introduce another ADR parser.
4. Verify GREEN with the scoped runner tests and the affected conflict-input tests through `ai-conductor scoped-run coverage-binding-runner.test.ts coverage-binding-conflict-inputs.test.ts`. Run the configured typecheck covering tests. Aggregate evidence remains owned by `test_suite`.
5. Commit: "fix(coverage-binding): judge ADR amendments at tier S"

**Done when:**
- With the judge enabled and a tier-S plan, `runCoverageBinding` sends a branch-added ADR amendment introducing a new decision to the amendment judge, persists its amendment verdict, and creates no conflict claim for that new decision, as asserted through captured prompts and the envelope in `src/conductor/test/engine/coverage-binding-runner.test.ts`.
- A tier-S amendment verdict of `not-carried` refuses `needs-human` naming the amendment and missing obligation, while D17's structural ADR-obligation layer remains `not-applicable`, as asserted by the runner test in `src/conductor/test/engine/coverage-binding-runner.test.ts`.
- An ADR amendment block already present in merge-base content produces no amendment claim on this branch, as asserted by the inherited-amendment runner test in `src/conductor/test/engine/coverage-binding-runner.test.ts`.
- With the judge disabled, a tier-S branch-added ADR amendment is recorded `unjudged`, produces no conflict claim for its new decision, dispatches no provider, and causes no refusal, as asserted by the disabled-judge runner test in `src/conductor/test/engine/coverage-binding-runner.test.ts`.

**Files:**
- `src/conductor/src/engine/step-runners.ts` — ADR amendment inputs at tier S
- `src/conductor/test/engine/coverage-binding-runner.test.ts` — production runner boundary proof

**Dependencies:** Tasks 4, 8

## Task Dependency Graph

```text
1 ─┐
2 ─┼─▶ 4 ─┐
3 ─┘      ├─▶ 6 ─┐
5 ────────┤      ├─▶ 8 ─▶ 9 ─▶ 10 ─▶ 12
5 ─▶ 7 ──────────┘
3 ───────────────────▶ 8
11 (independent)   13 (independent, verify-only)
```

## Integration Points

- After Task 8: `runCoverageBinding` judges conflict claims end to end with a stubbed provider.
- After Task 9: a contradictory plan refuses `needs-human` before any build task; a consistent plan completes `done`.
- After Task 12: the six #2750 evidence conflicts refuse when replayed.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given the coverage_binding judge is enabled and a plan whose Task 3 and Task 20 assert a policy-forbidden provider candidate is absent from the candidate list and from attempt records while uncited Task 8 requires a `provider_attempt` record for that forbidden candidate, and a sealed criterion requires the forbidden candidate to be absent from the records, when `coverage_binding` runs, then the conflict claim sent to the judge for that criterion carries the `Done when` checks of Task 3, Task 8, and Task 20 | 12 | "for the case-1 fixture, the conflict prompt captured from `runCoverageBinding` carries the sealed criterion's claim with the `Done when` checks of Task 3, Task 8, and Task 20, and a stubbed `conflicts` verdict naming Task 8 refuses `needs-human` before any build task naming the criterion text, Task 8, Task 8's `Done when` checks, and the conflict statement, as asserted by the case-1 replay test in `src/conductor/test/engine/coverage-binding-conflict-replay.test.ts`" | diff-local |
| Story 1 happy: Given the judge returns `conflicts` naming Task 8 for that criterion, when the step completes, then it is refused with kind `needs-human` before any build task is dispatched, and the refusal names the criterion text, Task 8, Task 8's `Done when` checks, and the judge's conflict statement | 12 | "for the case-1 fixture, the conflict prompt captured from `runCoverageBinding` carries the sealed criterion's claim with the `Done when` checks of Task 3, Task 8, and Task 20, and a stubbed `conflicts` verdict naming Task 8 refuses `needs-human` before any build task naming the criterion text, Task 8, Task 8's `Done when` checks, and the conflict statement, as asserted by the case-1 replay test in `src/conductor/test/engine/coverage-binding-conflict-replay.test.ts`" | diff-local |
| Story 1 happy: Given a plan whose invalidation-model task erases judge-disabled provenance and a sealed negative criterion requiring that a judge-disabled claim is never reopened, when the judge returns `conflicts` naming that task, then the step refuses `needs-human` naming that criterion and that task | 12 | "for the case-2 fixture (invalidation-model task vs the judge-disabled no-reopen negative criterion) and the case-3 fixture (Task 8 `endpoint` assertions vs the credential-only assertion-diff criterion), a stubbed `conflicts` verdict naming the task refuses `needs-human` naming that sealed criterion and that task, as asserted by the case-2 and case-3 replay tests in `src/conductor/test/engine/coverage-binding-conflict-replay.test.ts`" | diff-local |
| Story 1 happy: Given a plan whose Task 8 requires `endpoint` assertions and a sealed criterion requiring a credential-only assertion diff, when the judge returns `conflicts` naming Task 8, then the step refuses `needs-human` naming that criterion and Task 8 | 12 | "for the case-2 fixture (invalidation-model task vs the judge-disabled no-reopen negative criterion) and the case-3 fixture (Task 8 `endpoint` assertions vs the credential-only assertion-diff criterion), a stubbed `conflicts` verdict naming the task refuses `needs-human` naming that sealed criterion and that task, as asserted by the case-2 and case-3 replay tests in `src/conductor/test/engine/coverage-binding-conflict-replay.test.ts`" | diff-local |
| Story 1 negative: Given a sealed criterion that no coverage row cites, when `coverage_binding` assembles conflict claims, then that criterion still receives a conflict claim judged against every plan task | 4 | "`assembleConflictClaims` in `src/conductor/src/engine/coverage-binding-conflict-inputs.ts` returns one `criterion` conflict claim per string `extractAuthoritativeStoryCriteria` returns for the stories file, including a criterion that no coverage row cites, and each claim carries the full table from `buildConflictTaskTable` so every plan task's `Done when` checks reach it, as asserted by the criterion-claims test in `src/conductor/test/engine/coverage-binding-conflict-inputs.test.ts`" | diff-local |
| Story 1 negative: Given a plan task with no `Done when` block, when conflict claims are assembled, then that task appears in the task table with its id and title and no checks, and the claim is still judged | 2, 4 | "a plan task with no `Done when` block appears in the table returned by `buildConflictTaskTable` with its id and title and an empty checks list, as asserted by the no-done-when row test in `src/conductor/test/engine/coverage-binding-conflict-inputs.test.ts`" | diff-local |
| Story 1 negative: Given a stories file from which no criterion can be extracted, when `coverage_binding` runs with the judge enabled, then its criterion conflict claims are recorded `not-applicable` and the step neither refuses nor dispatches the judge for them | 8 | "with the judge enabled, a stories file with no extractable criterion, a plan with no `Done when` block in any task, and a cited ADR with no `## Decision` section each record their conflict entries `not-applicable`, dispatch no conflict batch for them, and leave the step neither refused nor failed, as asserted by the three not-applicable runner tests in `src/conductor/test/engine/coverage-binding-runner.test.ts`" | diff-local |
| Story 1 negative: Given a plan in which no task has a `Done when` block, when `coverage_binding` runs with the judge enabled, then every conflict claim is recorded `not-applicable` and the step does not refuse on them | 8 | "with the judge enabled, a stories file with no extractable criterion, a plan with no `Done when` block in any task, and a cited ADR with no `## Decision` section each record their conflict entries `not-applicable`, dispatch no conflict batch for them, and leave the step neither refused nor failed, as asserted by the three not-applicable runner tests in `src/conductor/test/engine/coverage-binding-runner.test.ts`" | diff-local |
| Story 1 negative: Given a reseal re-ran the step on a feature with completed tasks, a changed criterion coverage claim would otherwise reopen a completed task, and a conflict claim returns `conflicts`, when the step completes, then it refuses `needs-human`, no completed task is reopened, no plan task is appended, and no step is routed to `plan` | 9 | "on a run whose previous envelope is `invalidated`, with a changed criterion coverage claim citing completed task 2, an amendment claim whose verdict lists completed task 3 in `contradictsCompleted`, and one conflict entry `conflicts`, `runCoverageBinding` refuses `needs-human`, calls `admitAndRestageRepair` zero times, leaves tasks 2 and 3 and every other completed task with persisted status `completed` so no completed task is reopened, appends no plan task, and routes no step to `plan`, while the same run with every conflict entry `consistent` still reopens tasks 2 and 3, as asserted by the conflict-precedence tests in `src/conductor/test/engine/coverage-binding-runner.test.ts`" | diff-local |
| Story 1 negative: Given a reseal re-ran the step, the previous envelope has no conflict entries, and every conflict claim returns `consistent`, when the step completes, then no completed task is reopened because of a conflict entry's digest | 9 | "on a run whose previous `invalidated` envelope has no conflict entries and every conflict claim returns `consistent`, `runCoverageBinding` reopens no completed task because of a conflict entry's digest, since only criterion coverage claim digests feed the reopen check, as asserted by the conflict-digest-no-reopen test in `src/conductor/test/engine/coverage-binding-runner.test.ts`" | diff-local |
| Story 2 happy: Given a tier S plan whose text cites an approved ADR stem and whose Tasks 7 to 10 require assertions of generated values through the HTTP endpoint, and that ADR's decision 4 says generated-value properties are not asserted through the endpoint, when `coverage_binding` runs with the judge enabled, then a conflict claim for that ADR's decision 4 is judged against every plan task | 12 | "for the tier S fixture whose plan cites an approved ADR whose decision 4 forbids endpoint assertions of generated values, the captured prompt carries a `<stem>#D4` claim judged against every plan task, and a stubbed `conflicts` verdict naming Tasks 7 to 10 refuses `needs-human` naming `<stem>#D4` and Tasks 7, 8, 9, and 10, as asserted by the tier-S decision replay test in `src/conductor/test/engine/coverage-binding-conflict-replay.test.ts`" | diff-local |
| Story 2 happy: Given the judge returns `conflicts` naming Tasks 7 to 10 for that decision, when the step completes, then it refuses `needs-human` naming the decision as `<stem>#D4` and naming Tasks 7, 8, 9, and 10 | 12 | "for the tier S fixture whose plan cites an approved ADR whose decision 4 forbids endpoint assertions of generated values, the captured prompt carries a `<stem>#D4` claim judged against every plan task, and a stubbed `conflicts` verdict naming Tasks 7 to 10 refuses `needs-human` naming `<stem>#D4` and Tasks 7, 8, 9, and 10, as asserted by the tier-S decision replay test in `src/conductor/test/engine/coverage-binding-conflict-replay.test.ts`" | diff-local |
| Story 2 happy: Given a tier S plan whose Task 6 requires pinning a YAML enum list and transcribing registry tuples, and two cited approved ADRs whose decisions forbid the enum pin and forbid transcribing a roster, when the judge returns `conflicts` naming Task 6 for each decision, then the refusal names both decisions and Task 6 | 12 | "for the tier S fixture whose Task 6 requires a YAML enum pin and registry tuples and whose plan cites two approved ADRs forbidding the enum pin and roster transcription, stubbed `conflicts` verdicts naming Task 6 for each decision refuse `needs-human` naming both decisions and Task 6, as asserted by the two-ADR replay test in `src/conductor/test/engine/coverage-binding-conflict-replay.test.ts`" | diff-local |
| Story 2 happy: Given a plan-cited approved ADR whose `## Decision` section has no citable decision ids, when conflict claims are assembled, then exactly one claim carries that ADR's whole `## Decision` text and a conflict on it is named `<stem>#Decision` | 4 | "`assembleConflictClaims` returns one `adr-decision` claim identified `<stem>#D<n>` per `parseAdrDecisions` id of each subject ADR, carrying every passage under that id in one claim, and one claim identified `<stem>#Decision` carrying the whole `## Decision` text for a subject ADR whose section has no citable id, as asserted by the decision-claims test in `src/conductor/test/engine/coverage-binding-conflict-inputs.test.ts`" | diff-local |
| Story 2 happy: Given an ADR that the branch adds or modifies and the plan does not cite, when conflict claims are assembled, then that ADR's decisions are judged as subject decisions | 3, 4 | "`resolveConflictSubjectAdrs` in `src/conductor/src/engine/coverage-binding-conflict-inputs.ts` returns the union of the DECIDE-set ADR paths from `resolveCoverageBindingDecideSet` and every existing decision-record file for a stem `citedDecisionStems` finds in the plan text, so a branch-changed uncited ADR and a plan-cited unchanged ADR are both returned, as asserted by the subject-set test in `src/conductor/test/engine/coverage-binding-conflict-inputs.test.ts`" | diff-local |
| Story 2 happy: Given a plan-cited ADR whose status reads `SUPERSEDED in part by` another ADR, when conflict claims are assembled, then its remaining decisions receive conflict claims | 3, 4 | "`resolveConflictSubjectAdrs` keeps an ADR whose `adrApprovalStatus(...).found` is `Approved` in mixed case and an ADR whose status reads `SUPERSEDED in part by` another ADR, as asserted by the status-variant test in `src/conductor/test/engine/coverage-binding-conflict-inputs.test.ts`" | diff-local |
| Story 2 happy: Given a plan-cited ADR whose status line reads `**Status:** Approved` in mixed case, when conflict claims are assembled, then its decisions receive conflict claims | 3, 4 | "`resolveConflictSubjectAdrs` keeps an ADR whose `adrApprovalStatus(...).found` is `Approved` in mixed case and an ADR whose status reads `SUPERSEDED in part by` another ADR, as asserted by the status-variant test in `src/conductor/test/engine/coverage-binding-conflict-inputs.test.ts`" | diff-local |
| Story 2 happy: Given a subject ADR in which one decision id labels two passages, when conflict claims are assembled, then one claim carries both passages under that id | 4 | "`assembleConflictClaims` returns one `adr-decision` claim identified `<stem>#D<n>` per `parseAdrDecisions` id of each subject ADR, carrying every passage under that id in one claim, and one claim identified `<stem>#Decision` carrying the whole `## Decision` text for a subject ADR whose section has no citable id, as asserted by the decision-claims test in `src/conductor/test/engine/coverage-binding-conflict-inputs.test.ts`" | diff-local |
| Story 2 negative: Given the plan text cites an ADR stem whose status is DRAFT, when conflict claims are assembled, then no conflict claim is created for that ADR | 4, 3 | "`assembleConflictClaims` creates no conflict claim for a cited `DRAFT` ADR, a cited fully superseded ADR, a cited stem with no file, an uncited branch-unchanged approved ADR, or a decision whose passage lies inside an amendment block that `assembleAmendmentClaims` returns, which stays judged only as that amendment claim, as asserted by the exclusion tests in `src/conductor/test/engine/coverage-binding-conflict-inputs.test.ts`" | diff-local |
| Story 2 negative: Given the plan text cites an ADR stem whose status is a full supersession by another ADR, when conflict claims are assembled, then no conflict claim is created for that ADR | 4, 3 | "`assembleConflictClaims` creates no conflict claim for a cited `DRAFT` ADR, a cited fully superseded ADR, a cited stem with no file, an uncited branch-unchanged approved ADR, or a decision whose passage lies inside an amendment block that `assembleAmendmentClaims` returns, which stays judged only as that amendment claim, as asserted by the exclusion tests in `src/conductor/test/engine/coverage-binding-conflict-inputs.test.ts`" | diff-local |
| Story 2 negative: Given a plan-cited approved ADR with no `## Decision` section, when `coverage_binding` runs, then its conflict claims are recorded `not-applicable` and the step does not fail | 8 | "with the judge enabled, a stories file with no extractable criterion, a plan with no `Done when` block in any task, and a cited ADR with no `## Decision` section each record their conflict entries `not-applicable`, dispatch no conflict batch for them, and leave the step neither refused nor failed, as asserted by the three not-applicable runner tests in `src/conductor/test/engine/coverage-binding-runner.test.ts`" | diff-local |
| Story 2 negative: Given a subject ADR amended on this branch whose amendment block introduces a new decision, when conflict claims are assembled, then that new decision receives no conflict claim and is judged only as an amendment claim | 4, 14 | "With the judge enabled and a tier-S plan, `runCoverageBinding` sends a branch-added ADR amendment introducing a new decision to the amendment judge, persists its amendment verdict, and creates no conflict claim for that new decision, as asserted through captured prompts and the envelope in `src/conductor/test/engine/coverage-binding-runner.test.ts`." | diff-local |
| Story 2 negative: Given the plan text names an ADR stem that has no matching decision-record file, when conflict claims are assembled, then no claim is created for it and the step does not fail on the missing file | 4, 3 | "`assembleConflictClaims` creates no conflict claim for a cited `DRAFT` ADR, a cited fully superseded ADR, a cited stem with no file, an uncited branch-unchanged approved ADR, or a decision whose passage lies inside an amendment block that `assembleAmendmentClaims` returns, which stays judged only as that amendment claim, as asserted by the exclusion tests in `src/conductor/test/engine/coverage-binding-conflict-inputs.test.ts`" | diff-local |
| Story 2 negative: Given an approved ADR that the plan does not cite and the branch does not change, when conflict claims are assembled, then no conflict claim is created for its decisions | 4, 3 | "`assembleConflictClaims` creates no conflict claim for a cited `DRAFT` ADR, a cited fully superseded ADR, a cited stem with no file, an uncited branch-unchanged approved ADR, or a decision whose passage lies inside an amendment block that `assembleAmendmentClaims` returns, which stays judged only as that amendment claim, as asserted by the exclusion tests in `src/conductor/test/engine/coverage-binding-conflict-inputs.test.ts`" | diff-local |
| Story 3 happy: Given a plan whose tasks each cover a different sealed criterion and none requires an outcome another criterion or a subject ADR decision forbids, when the judge returns `consistent` for every conflict claim, then `coverage_binding` completes `done` and the first build task is dispatched | 12 | "after a fixture whose conflict claims are all stubbed `consistent` completes `coverage_binding` `done`, one conductor loop run dispatches the first build task, as asserted by the consistent-plan loop test in `src/conductor/test/engine/coverage-binding-conflict-replay.test.ts`" | diff-local |
| Story 3 happy: Given a sealed criterion that no task covers, when the judge returns `consistent` for its conflict claim, then the conflict layer adds no refusal, and the coverage claims alone decide whether the step refuses | 9 | "with every conflict claim `consistent` and one criterion coverage claim `does-not-assert`, `runCoverageBinding` refuses through the coverage refusal naming only that coverage claim, so the conflict layer adds no refusal and the coverage claims alone decide, as asserted by the coverage-alone-decides test in `src/conductor/test/engine/coverage-binding-runner.test.ts`" | diff-local |
| Story 3 happy: Given a spec with zero criterion coverage claims on any carrier and every conflict claim `consistent`, when the step runs, then it completes `done` with no halt | 9 | "with stubbed `consistent` verdicts for every conflict claim, `runCoverageBinding` completes `done` with no halt on a plan whose tasks each cover a different criterion, on a spec with zero criterion coverage claims on any carrier, and on a plan leaving one criterion uncovered by any task, as asserted by the consistent-plan tests in `src/conductor/test/engine/coverage-binding-runner.test.ts`" | diff-local |
| Story 3 happy: Given a rebase whose new base changes a plan-cited subject ADR and nothing else, when post-rebase invalidation is evaluated, then `coverage_binding` is re-run before the next build task | 13 | "`resolveReviewInputs` in `src/conductor/src/engine/rebase.ts`, through `citedDecisionStems`, includes a plan-cited ADR's path, so a rebase whose new base changes only that ADR invalidates `coverage_binding` and it is re-run before the next build task, as asserted by the cited-ADR rebase test in `src/conductor/test/engine/rebase.test.ts`" | diff-local |
| Story 3 happy: Given a spec that passed `engineer land` before this change, when it is landed again after this change, then land accepts it with no new rejection, and no new plan or coherence section is required | 13 | "`landSpec` accepts an existing passing land fixture spec unchanged, with no new rejection identifier and no new required plan or coherence section, as asserted by the unchanged-land test in `src/conductor/test/engine/engineer/land-spec.test.ts`" | diff-local |
| Story 3 negative: Given `coverage_binding.judge.enabled` is false, when `coverage_binding` runs on a plan with a contradicting task, then every conflict claim is recorded `unjudged`, no judge is dispatched for them, and the step completes with the same status it had before this change | 8 | "with `coverage_binding.judge.enabled` false on a plan holding a contradicting task, `runCoverageBinding` dispatches no conflict batch, records every conflict entry `unjudged`, and returns the same status and output it returns for that plan without conflict claims, as asserted by the judge-disabled conflict test in `src/conductor/test/engine/coverage-binding-runner.test.ts`" | diff-local |
| Story 3 negative: Given an envelope written before this change with no conflict entries, when `coverage_binding` runs, then the absent entries are treated as cache misses and judged, and the envelope is not rejected as malformed | 6 | "when a prior `consistent` entry's task table changed, or the prior envelope has no conflict entries, that prior envelope is read by `readCoverageBindingEnvelope` without being rejected as malformed and `planCoverageBindingBatches` leaves every conflict claim pending so each is re-judged, as asserted by the re-judge tests in `src/conductor/test/engine/coverage-binding-batches.test.ts`" | diff-local |
| Story 4 happy: Given a batch of conflict claims, when the judge prompt is built, then the plan's task table appears once in the prompt and each claim carries its issued id, its kind as `criterion` or `adr-decision`, and its text | 6 | "`renderConflictBatchPrompt` in `src/conductor/src/engine/coverage-binding-batches.ts` emits the plan task table exactly once, followed per claim by its issued id, its kind `criterion` or `adr-decision`, and its text, as asserted by the prompt-shape test in `src/conductor/test/engine/coverage-binding-batches.test.ts`" | diff-local |
| Story 4 happy: Given a prior envelope holding a conflict verdict and an unchanged plan task table and claim text, when `coverage_binding` re-runs, then that claim is a cache hit and is not re-dispatched | 6 | "`planCoverageBindingBatches` in `src/conductor/src/engine/coverage-binding-batches.ts` puts conflict claims in their own pending list, never mixed into criterion or amendment batches, and reuses a prior entry with a matching `conflictClaimDigest` and a verdict other than `unjudged` as a cache hit that is not re-dispatched, as asserted by the conflict-partition and conflict-cache tests in `src/conductor/test/engine/coverage-binding-batches.test.ts`" | diff-local |
| Story 4 happy: Given a prior envelope holding a `consistent` verdict, when any plan task's title or `Done when` checks change, then every conflict claim is re-judged | 6 | "when a prior `consistent` entry's task table changed, or the prior envelope has no conflict entries, that prior envelope is read by `readCoverageBindingEnvelope` without being rejected as malformed and `planCoverageBindingBatches` leaves every conflict claim pending so each is re-judged, as asserted by the re-judge tests in `src/conductor/test/engine/coverage-binding-batches.test.ts`" | diff-local |
| Story 4 happy: Given a conflict claim whose text alone exceeds the batch prompt byte budget, when batches are formed, then that claim is dispatched in a batch of its own with its full text | 6 | "conflict batches hold at most `batch_size` claims and at most `CONFLICT_BATCH_PROMPT_BYTE_BUDGET` bytes of claim text, and a claim whose text alone exceeds that budget is placed alone in its own batch with its full untruncated text, as asserted by the byte-budget test in `src/conductor/test/engine/coverage-binding-batches.test.ts`" | diff-local |
| Story 4 negative: Given the judge returns `conflicts` with a task id not in the plan, when the batch is parsed, then the whole batch is rejected as `CoverageBindingPayloadError` and no verdict from it is recorded | 7, 8 | "`parseConflictBatchPayload` returns a whole-batch rejection carrying no verdict for each of a task id not in the plan, an empty `taskIds` list, an empty `conflict` statement, a missing issued id, a foreign id, a duplicated id, and a verdict word other than `consistent` or `conflicts`, as asserted by the seven conflict-payload rejection tests in `src/conductor/test/engine/coverage-binding-envelope.test.ts`" | diff-local |
| Story 4 negative: Given the judge returns `conflicts` with an empty task id list or an empty conflict statement, when the batch is parsed, then the whole batch is rejected as `CoverageBindingPayloadError` | 7, 8 | "`parseConflictBatchPayload` returns a whole-batch rejection carrying no verdict for each of a task id not in the plan, an empty `taskIds` list, an empty `conflict` statement, a missing issued id, a foreign id, a duplicated id, and a verdict word other than `consistent` or `conflicts`, as asserted by the seven conflict-payload rejection tests in `src/conductor/test/engine/coverage-binding-envelope.test.ts`" | diff-local |
| Story 4 negative: Given the judge omits a claim id it was issued, or returns a claim id it was not issued, or returns one twice, when the batch is parsed, then the whole batch is rejected as `CoverageBindingPayloadError` | 7, 8 | "`parseConflictBatchPayload` returns a whole-batch rejection carrying no verdict for each of a task id not in the plan, an empty `taskIds` list, an empty `conflict` statement, a missing issued id, a foreign id, a duplicated id, and a verdict word other than `consistent` or `conflicts`, as asserted by the seven conflict-payload rejection tests in `src/conductor/test/engine/coverage-binding-envelope.test.ts`" | diff-local |
| Story 4 negative: Given the judge returns a verdict word other than `consistent` or `conflicts`, when the batch is parsed, then the whole batch is rejected as `CoverageBindingPayloadError` | 7, 8 | "`parseConflictBatchPayload` returns a whole-batch rejection carrying no verdict for each of a task id not in the plan, an empty `taskIds` list, an empty `conflict` statement, a missing issued id, a foreign id, a duplicated id, and a verdict word other than `consistent` or `conflicts`, as asserted by the seven conflict-payload rejection tests in `src/conductor/test/engine/coverage-binding-envelope.test.ts`" | diff-local |
| Story 4 negative: Given an earlier conflict batch in the same run was accepted and a later batch is rejected, when the envelope is checkpointed, then the earlier batch's verdicts remain recorded and the run's status is not `done` | 8 | "when a later conflict batch's payload is rejected, `runCoverageBinding` raises `CoverageBindingPayloadError`, records no verdict from that batch, and keeps the earlier accepted batch's verdicts in an envelope whose status is `partial`, not `done`, as asserted by the partial-checkpoint conflict test in `src/conductor/test/engine/coverage-binding-runner.test.ts`" | diff-local |
| Story 5 happy: Given `coverage_binding` judges conflict claims, when each claim's verdict is recorded, then one `coverage_binding_conflict_judged` event per claim is persisted to `.pipeline/events.jsonl` with the claim kind, the verdict, and the conflicting task ids | 10 | "`runCoverageBinding` emits one `coverage_binding_conflict_judged` event per conflict claim, persisted to `.pipeline/events.jsonl` with its claim kind, verdict, and conflicting task ids, and with verdict `unjudged` for each claim when the judge is disabled, as asserted by the conflict-event tests in `src/conductor/test/engine/coverage-binding-runner.test.ts`" | diff-local |
| Story 5 happy: Given a conflict refusal, when the step ends, then the existing `step_refused` and `loop_halt` events record it and no conflict-specific halt event is emitted | 10 | "a conflict refusal is recorded by the existing `step_refused` and `loop_halt` events and no conflict-specific halt event is emitted, as asserted by the refusal-events test in `src/conductor/test/engine/coverage-binding-runner.test.ts`" | diff-local |
| Story 5 negative: Given the judge is disabled, when conflict claims are recorded `unjudged`, then each still emits `coverage_binding_conflict_judged` with verdict `unjudged` | 10 | "`runCoverageBinding` emits one `coverage_binding_conflict_judged` event per conflict claim, persisted to `.pipeline/events.jsonl` with its claim kind, verdict, and conflicting task ids, and with verdict `unjudged` for each claim when the judge is disabled, as asserted by the conflict-event tests in `src/conductor/test/engine/coverage-binding-runner.test.ts`" | diff-local |
| Story 5 negative: Given conflict claims are judged, when criterion and amendment claims are also judged in the same run, then `coverage_binding_judged` and `coverage_binding_amendment_judged` events carry only their existing verdict values | 10 | "in a run judging criterion, amendment, and conflict claims, `coverage_binding_judged` events carry only `asserts`, `does-not-assert`, or `not-applicable` and `coverage_binding_amendment_judged` events carry only their existing verdict values, as asserted by the vocabulary-unchanged test in `src/conductor/test/engine/coverage-binding-runner.test.ts`" | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-08-31-coverage-binding-judge-step#D1 | existing | none | Criterion claims keep their two carriers; `assembleCoverageBindingClaims` in `coverage-binding-inputs.ts` is unchanged by this plan. |
| adr-2026-08-31-coverage-binding-judge-step#D2 | existing | none | The land-time `Done when` quote scoping in `checkCriterionCoverage` is untouched. |
| adr-2026-08-31-coverage-binding-judge-step#D3 | existing | none | The tier-S land criterion layer in `runCoherenceGate` is untouched. |
| adr-2026-08-31-coverage-binding-judge-step#D4 | existing | none | `coverage_binding` stays registered in `steps.ts` after `coherence_check` with `phase: 'BUILD'`; no placement change. |
| adr-2026-08-31-coverage-binding-judge-step#D5 | existing | none | The fresh one-shot criterion judge dispatch and its closed criterion verdict in `step-runners.ts` are unchanged for criterion claims. |
| adr-2026-08-31-coverage-binding-judge-step#D6 | existing | none | The `does-not-assert` refusal path (`refused`, `needs-human`, `writeHaltMarker`) is reused unchanged by the conflict refusal. |
| adr-2026-08-31-coverage-binding-judge-step#D7 | existing | none | `coverage_binding.judge.enabled` keeps its registration in `resolved-config.ts` and its default; it also gates conflict claims. |
| adr-2026-08-31-coverage-binding-judge-step#D8 | existing | none | Criterion claims with no `Done when` block stay `not-applicable` in `assembleCoverageBindingClaims`. |
| adr-2026-08-31-coverage-binding-judge-step#D9 | existing | none | `coverage_binding_judged` and `coverage_binding_disabled` remain declared in `event-sinks.ts` with their existing vocabulary. |
| adr-2026-08-31-coverage-binding-judge-step#D10 | existing | none | The optional seventh correction cell is parsed by the shared coherence parser; no BUILD consumer reads it. |
| adr-2026-08-31-coverage-binding-judge-step#D11 | existing | none | Land resolves `architecture:` correction references through `formatArchitectureDecisionId`; untouched. |
| adr-2026-08-31-coverage-binding-judge-step#D12 | existing | none | Criterion claims are dispatched per bounded batch by `planCoverageBindingBatches` in `coverage-binding-batches.ts`. |
| adr-2026-08-31-coverage-binding-judge-step#D13 | existing | none | `parseJudgeBatchPayload` enforces exact id-set equality for criterion batches; unchanged. |
| adr-2026-08-31-coverage-binding-judge-step#D14 | existing | none | The `partial` envelope checkpoint after every batch is written by `writeCoverageBindingEnvelope`; reused for conflict batches. |
| adr-2026-08-31-coverage-binding-judge-step#D15 | existing | none | `coverage_binding.judge.batch_size` is validated in `config.ts` and resolved in `resolved-config.ts`; unchanged. |
| adr-2026-08-31-coverage-binding-judge-step#D16 | existing | none | `voidCoverageBindingForDecideChange` in `coverage-binding-void.ts` voids the step on a changed DECIDE-set rebaseline; unchanged. |
| adr-2026-08-31-coverage-binding-judge-step#D17 | existing | none | `runCoverageBinding` runs `validateArchitectureObligationCoverage` before the judge-disabled return; unchanged. |
| adr-2026-08-31-coverage-binding-judge-step#D18 | task | task-14 | With the judge enabled and a tier-S plan, `runCoverageBinding` sends a branch-added ADR amendment introducing a new decision to the amendment judge, persists its amendment verdict, and creates no conflict claim for that new decision, as asserted through captured prompts and the envelope in `src/conductor/test/engine/coverage-binding-runner.test.ts`. |
| adr-2026-08-31-coverage-binding-judge-step#D19 | existing | none | The D19 reopen through `admitAndRestageRepair` after an `invalidated` envelope is unchanged for criterion coverage and amendment claims. |
| adr-2026-08-31-coverage-binding-judge-step#D20 | existing | none | `coverage_binding_invalidated`, `coverage_binding_amendment_judged`, and `coverage_binding_task_reopened` remain declared in `event-sinks.ts`. |
| adr-2026-08-31-coverage-binding-judge-step#D21 | task | task-4, task-3, task-13, task-14 | `assembleConflictClaims` returns one `adr-decision` claim identified `<stem>#D<n>` per `parseAdrDecisions` id of each subject ADR, carrying every passage under that id in one claim, and one claim identified `<stem>#Decision` carrying the whole `## Decision` text for a subject ADR whose section has no citable id, as asserted by the decision-claims test in `src/conductor/test/engine/coverage-binding-conflict-inputs.test.ts` |
| adr-2026-08-31-coverage-binding-judge-step#D22 | task | task-7, task-5, task-6 | `parseConflictBatchPayload` returns a whole-batch rejection carrying no verdict for each of a task id not in the plan, an empty `taskIds` list, an empty `conflict` statement, a missing issued id, a foreign id, a duplicated id, and a verdict word other than `consistent` or `conflicts`, as asserted by the seven conflict-payload rejection tests in `src/conductor/test/engine/coverage-binding-envelope.test.ts` |
| adr-2026-08-31-coverage-binding-judge-step#D23 | task | task-9 | on a run whose previous envelope is `invalidated`, with a changed criterion coverage claim citing completed task 2, an amendment claim whose verdict lists completed task 3 in `contradictsCompleted`, and one conflict entry `conflicts`, `runCoverageBinding` refuses `needs-human`, calls `admitAndRestageRepair` zero times, leaves tasks 2 and 3 and every other completed task with persisted status `completed` so no completed task is reopened, appends no plan task, and routes no step to `plan`, while the same run with every conflict entry `consistent` still reopens tasks 2 and 3, as asserted by the conflict-precedence tests in `src/conductor/test/engine/coverage-binding-runner.test.ts` |
| adr-2026-08-31-coverage-binding-judge-step#D24 | task | task-10 | `coverage_binding_conflict_judged` is a member of the `ConductorEvent` union in `src/conductor/src/types/events.ts` carrying the claim kind, the verdict (`consistent`, `conflicts`, `not-applicable`, or `unjudged`), and the conflicting task ids, and is declared in `src/conductor/src/engine/event-sinks.ts` with persist on, audit off, and otel off, as asserted by the sink-registry exhaustiveness test in `src/conductor/test/engine/event-sinks.test.ts` |
| adr-2026-08-22-one-owner-per-review-question#D1 | task | task-9 | when any conflict entry is `conflicts`, `runCoverageBinding` in `src/conductor/src/engine/step-runners.ts` returns a refusal of kind `needs-human` through the existing refusal path that calls `writeHaltMarker` with class `needs-human` before any build task is dispatched, and its refusal text names, per conflicting claim, the criterion text or `<stem>#D<n>` or `<stem>#Decision`, each conflicting task id, that task's `Done when` checks, and the judge's `conflict` statement, as asserted by the conflict-refusal test in `src/conductor/test/engine/coverage-binding-runner.test.ts` |

## Verification

- [x] All happy path criteria covered by at least one task
- [x] All negative path criteria covered by at least one task
- [x] No task exceeds 5 minutes of work
- [x] Every task has a `Done when:` block of falsifiable checks
- [x] Dependencies are explicit and acyclic

> **Amended 2026-10-04 by #2750:** The coverage rows above assign the S2.12 runner proof and D18 tier-S input correction to Task 14. The superseded rows are preserved below as the original assertions; they no longer describe complete coverage. Task dependency addition: Tasks 4 and 8 → Task 14.
>
> | Story 2 negative: Given a subject ADR amended on this branch whose amendment block introduces a new decision, when conflict claims are assembled, then that new decision receives no conflict claim and is judged only as an amendment claim | 4 | "`assembleConflictClaims` creates no conflict claim for a cited `DRAFT` ADR, a cited fully superseded ADR, a cited stem with no file, an uncited branch-unchanged approved ADR, or a decision whose passage lies inside an amendment block that `assembleAmendmentClaims` returns, which stays judged only as that amendment claim, as asserted by the exclusion tests in `src/conductor/test/engine/coverage-binding-conflict-inputs.test.ts`" | diff-local |
> | adr-2026-08-31-coverage-binding-judge-step#D18 | existing | none | `assembleAmendmentClaims` and `parseAmendmentBatchPayload` judge amendment claims; unchanged. |
> | adr-2026-08-31-coverage-binding-judge-step#D21 | task | task-4, task-3, task-13 | `assembleConflictClaims` returns one `adr-decision` claim identified `<stem>#D<n>` per `parseAdrDecisions` id of each subject ADR, carrying every passage under that id in one claim, and one claim identified `<stem>#Decision` carrying the whole `## Decision` text for a subject ADR whose section has no citable id, as asserted by the decision-claims test in `src/conductor/test/engine/coverage-binding-conflict-inputs.test.ts` |

> **Amended 2026-10-04 by #2750:** Operator recovery corrects the evidence wording to quote Task 14's first `Done when` check verbatim. The superseded evidence assertion was: `runCoverageBinding` sends a tier-S branch-added ADR amendment to the amendment judge and creates no conflict claim for its new decision, as asserted by the runner tests in `src/conductor/test/engine/coverage-binding-runner.test.ts`. The approved behavior and task scope are unchanged.
