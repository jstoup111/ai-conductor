# Implementation Plan: Remediation history handed off by file

**Date:** 2026-11-15
**Design:** `.docs/decisions/architecture-review-2026-11-15-prd-audit-halts-needs-human-when-as-built-case-his.md`
**Stories:** `.docs/stories/prd-audit-halts-needs-human-when-as-built-case-his.md`
**Conflict check:** Clean as of 2026-11-15

## Summary

Moves the four history dimensions of the remediation gap-plan projection out of the prompt and
into two engine-written files per remediation attempt, removes their byte limits, and stops a
size overflow from ever halting `needs-human`. 12 tasks, single PR.

## Technical Approach

- **One seam.** All engine work is in `src/conductor/src/engine/remediation-projection.ts` and
  its two consumers: the single `buildRemediationProjection` call in
  `src/conductor/src/engine/conductor.ts` and the `gap-plan` branch in
  `src/conductor/src/engine/step-runners.ts`. No new module.
- **The in-memory projection is unchanged.** `RemediationProjection` keeps
  `pendingAsBuiltFindings`, `priorAsBuiltCases`, `priorLaps`, and `refusals`.
  `validateRemediationPlan` keeps receiving it. Only what is written to disk and what is
  rendered into the prompt is new.
- **History files.** Inside `buildRemediationProjection`, after the projection is assembled, a
  history writer splits it and writes two JSON files with an atomic replace (write a temporary
  sibling, then rename), active file first, then resolved file:
  - `.pipeline/remediation-history/<attemptId>.active.json` holds `pendingAsBuiltFindings`,
    `priorLaps`, `refusals`, and `priorAsBuiltCases` limited to cases whose status is `open` or
    `needs-human`, plus any `resolved` case with a source whose `findingId` is a current
    pending finding id;
  - `.pipeline/remediation-history/<attemptId>.resolved.json` holds `priorAsBuiltCases` limited
    to the remaining `resolved` cases.
  `<attemptId>` is `request.attemptRunId`, falling back to the literal `unknown-attempt`, the
  fallback `conductor.ts` already uses for an absent run id. `priorAsBuiltCases` is present in
  each file only when the in-memory projection has it. The filesystem writer is injected
  through the existing `dependencies` parameter so tests can make it fail.
- **History index.** A successful result gains `history`: the two paths (worktree-relative),
  each file's SHA-256 digest, and per dimension the ids and count. Ids are the `finding` of a
  pending finding, the `gate` of a prior lap, the `decisionId` of a refusal, and the `id` of a
  prior case. Archived cases are listed as `{ id, sourceFindingIds }`.
- **Prompt rendering.** A new exported `renderRemediationPromptProjection(projection, history)`
  returns the projection without the four history collections and with `history` in their
  place. `REMEDIATION_PROJECTION_VERSION` becomes 3. The `gap-plan` `remediationRequest` gains
  `history`, and `step-runners.ts` serializes the rendered form instead of the projection.
- **Limits.** `pendingAsBuiltFindingsBytes`, `priorLapsBytes`, `priorAsBuiltCasesBytes`, and
  `refusalsBytes` are deleted from `REMEDIATION_PROJECTION_CORPUS_MAXIMA_BYTES`,
  `REMEDIATION_PROJECTION_COMPONENT_LIMITS`, and `RemediationProjectionLimits`, with
  `REMEDIATION_PROJECTION_OPTIONAL_CONTEXT_FLOOR_BYTES`. `projectionLimitFault` measures
  `required-references`, `tasks`, and `total`; `total` is the serialized rendered prompt
  projection without `evidence`, and its limit is recomputed from the two remaining component
  limits plus the envelope overhead.
- **Fault cause.** A preparation fault gains `cause`: `prior-repair-task-missing`,
  `case-store-unreadable`, `history-write-failed`, or `input`. The conductor classes the first
  two `needs-human` and everything else `mechanical`. This replaces the classing by dimension
  name and by source string.
- **Sequencing.** The files come first (Tasks 1-5) because the existing inline prompt keeps
  working while they are added. The prompt switches to the index in Tasks 6-7, the limits go
  in Task 8, and the halt class, the untouched modes, validation, and the skill follow.
- **Test pattern.** Projection tests in `src/conductor/test/engine/remediation-projection.test.ts`
  build a temporary worktree with a real case store, kickback ledger, and plan, then call
  `buildRemediationProjection`; follow that style and read the written files back from disk.
  Conductor tests in `src/conductor/test/engine/conductor-remediation-typed-plan.test.ts` drive
  the remediation route with a fake step runner; use them wherever a criterion says a dispatch
  runs or a halt is written. Follow `.agents/skills/write-tests/SKILL.md`.

## Prerequisites

- None. Hotfix #3678 is on main.

## Tasks

### Task 1: Write the remediation history files on every gap-plan projection
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing tests. In the conductor remediation test, seed a case store with 11 open prior as-built cases serializing over 8 KiB, run the as-built remediation route with a fake step runner, and assert the runner was invoked and the active file content. Add a second fixture with over 512 KiB of pending findings, prior laps, and refusals, and a third with no history at all.
2. Verify the tests fail (RED).
3. Implement the history writer in `buildRemediationProjection`: assemble the projection as today, write the active file then the resolved file under `.pipeline/remediation-history/` by temporary-sibling-then-rename, and return `history` with paths and SHA-256 digests on the ok result. In this task the active file may hold every prior case; Task 2 adds the split. Raise the four history limits out of the way only as far as the fixtures need; Task 8 deletes them.
4. Verify the tests pass (GREEN).
5. Commit with message: "feat(remediation): write per-attempt history files for gap planning"

**Done when:**
- [test] A conductor remediation test over 11 open prior as-built cases larger than 8 KiB asserts the remediate step runner is invoked and that `<attemptId>.active.json` written by `buildRemediationProjection` contains all 11 cases, each with every source and every repair task of the stored case.
- [test] A conductor remediation test over more than 512 KiB of pending findings, prior laps, and refusals asserts the remediate step runner is invoked and that the history files written by `buildRemediationProjection` hold every pending finding, prior lap, and refusal deep-equal to the in-memory projection entries, with no entry shortened or omitted.
- [test] A conductor remediation test with no pending findings, prior laps, refusals, or prior cases asserts both history files are written by `buildRemediationProjection` with empty collections and the remediate step runner is invoked.

**Files likely touched:**
- `src/conductor/src/engine/remediation-projection.ts` — history writer, `history` on the ok result
- `src/conductor/test/engine/conductor-remediation-typed-plan.test.ts` — dispatch-level history tests
- `src/conductor/test/engine/remediation-projection.test.ts` — fixtures shared with later tasks

**Dependencies:** none

### Task 2: Split prior as-built cases between the active and resolved files
**Story:** Story 2
**Type:** happy-path

**Steps:**
1. Write failing projection tests over a case store with `open`, `needs-human`, and `resolved` cases, reading both files back.
2. Verify the tests fail (RED).
3. Implement the split in the history writer: a case goes to the active file when its status is `open` or `needs-human`, or when it is `resolved` and one of its sources has a `findingId` in the current pending finding ids; every other case goes to the resolved file. Each case is written exactly as the in-memory projection holds it. Omit the `priorAsBuiltCases` key from both files when the projection has none.
4. Verify the tests pass (GREEN).
5. Commit with message: "feat(remediation): separate resolved as-built cases into a history archive"

**Done when:**
- [test] A projection test over one `open`, one `needs-human`, and two `resolved` cases with no pending source asserts the history writer puts the `open` and `needs-human` cases in the active file and the two `resolved` cases in the resolved file, each in full: its id, status, recurrence count, every source, and every repair task of the stored case record are present.
- [test] A projection test asserts the history writer puts a `resolved` case with a source whose `findingId` is a current pending finding in the active file and not in the resolved file.
- [test] A projection test over a mixed case set asserts every stored case appears in exactly one file, the union of both files equals the stored case set, and all pending findings, prior laps, and refusals are in the active file and none is in the resolved file.
- [test] A conductor remediation test over a PRD-audit-only round asserts neither history file has a `priorAsBuiltCases` key and the remediate step runner is invoked.
- [test] A projection test asserts a `resolved` case whose sources name only non-pending findings is written by the history writer to the resolved file only, with its source summaries present and no field summarized, truncated, or dropped relative to the case store record.

**Files likely touched:**
- `src/conductor/src/engine/remediation-projection.ts` — active/resolved split
- `src/conductor/test/engine/remediation-projection.test.ts` — split tests
- `src/conductor/test/engine/conductor-remediation-typed-plan.test.ts` — PRD-audit-only round

**Dependencies:** Task 1

### Task 3: Keep history files stable across a retry and across attempts
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing conductor tests: one where the fake step runner's first plan is rejected and the retry is accepted, capturing the bytes of both history files at each dispatch; one that runs two remediation attempts with different run ids.
2. Verify the tests fail (RED) if the retry rewrites or the second attempt replaces the first attempt's files.
3. Implement: key the files by attempt id so a later attempt writes new files and leaves earlier ones; ensure the bounded remediate retry reuses the projection result and does not rebuild it.
4. Verify the tests pass (GREEN).
5. Commit with message: "test(remediation): history files are frozen per attempt"

**Done when:**
- [test] A conductor remediation test whose first returned plan is rejected asserts the retry dispatch for the same attempt observes the same two history file paths with byte-identical content to the first dispatch.
- [test] A conductor remediation test running a second remediation attempt with a new run id asserts the first attempt's two history files still exist with byte-identical content after the second attempt's files are written by `buildRemediationProjection`.

**Files likely touched:**
- `src/conductor/src/engine/remediation-projection.ts` — attempt-keyed file names
- `src/conductor/test/engine/conductor-remediation-typed-plan.test.ts` — retry and second-attempt tests

**Dependencies:** Task 1

### Task 4: Fault mechanically when the history files cannot be written
**Story:** Story 1
**Type:** negative-path

**Steps:**
1. Write failing tests with an injected filesystem writer: one that fails every write, one that succeeds for the active file and fails for the resolved file, and one fixture with a corrupt kickback ledger.
2. Verify the tests fail (RED).
3. Implement: add `cause` to the preparation fault (`prior-repair-task-missing`, `case-store-unreadable`, `history-write-failed`, `input`). Set `prior-repair-task-missing` and `case-store-unreadable` at their existing fault sites and `input` at every other existing site. A write error returns a fault with source `history snapshot`, cause `history-write-failed`, and a detail naming the failing file path and the error. Run the history writer only after the ledger, pending findings, tasks, and evidence have been read successfully, so a ledger fault returns before any file is written. In `conductor.ts`, class `history-write-failed` as `mechanical`.
4. Verify the tests pass (GREEN).
5. Commit with message: "feat(remediation): name history write failures as mechanical preparation faults"

**Done when:**
- [test] A conductor remediation test with a history writer that fails every write asserts the remediate step runner is never invoked and the HALT is class `mechanical` with a detail naming `history snapshot` and the write error text.
- [test] A projection test with a history writer that succeeds for the active file and then fails for the resolved file asserts `buildRemediationProjection` returns a `history-write-failed` fault whose detail names the path of the file that failed, and a conductor test over the same fixture asserts the remediate step runner is never invoked.
- [test] A conductor remediation test with a corrupt kickback ledger asserts the remediate step runner is never invoked, the HALT detail names the kickback ledger, and no file exists under `.pipeline/remediation-history/`.

**Files likely touched:**
- `src/conductor/src/engine/remediation-projection.ts` — fault `cause`, write-failure fault, writer ordering
- `src/conductor/src/engine/conductor.ts` — `history-write-failed` classed `mechanical`
- `src/conductor/test/engine/remediation-projection.test.ts` — partial-write fault
- `src/conductor/test/engine/conductor-remediation-typed-plan.test.ts` — halt class and no-dispatch assertions

**Dependencies:** Task 1

### Task 5: Write no history when the case store is unreadable
**Story:** Story 2
**Type:** negative-path

**Steps:**
1. Write a failing conductor test over a malformed `.pipeline/remediation-cases.json` in an as-built round.
2. Verify the test fails (RED) on the no-history-file assertion or the fault cause.
3. Implement: return the existing unreadable-store fault, now with cause `case-store-unreadable`, before the history writer runs.
4. Verify the test passes (GREEN).
5. Commit with message: "test(remediation): unreadable case store writes no history and halts needs-human"

**Done when:**
- [test] A conductor remediation test over a present but malformed remediation case store in an as-built round asserts the remediate step runner is never invoked, the HALT is class `needs-human`, and its detail names the remediation case store as unreadable.
- [test] The same test asserts no file exists under `.pipeline/remediation-history/` after the fault, so the history writer never wrote an empty history.

**Files likely touched:**
- `src/conductor/src/engine/remediation-projection.ts` — fault ordering before the writer
- `src/conductor/test/engine/conductor-remediation-typed-plan.test.ts` — unreadable-store test

**Dependencies:** Task 2, Task 4

### Task 6: Render the gap-plan prompt with a history index
**Story:** Story 3
**Type:** happy-path

**Steps:**
1. Write failing tests in the gap-plan step-runner test that capture the prompt passed to the provider and parse the JSON after the `REMEDIATION GAP-PLAN INPUT (engine-owned):` line.
2. Verify the tests fail (RED).
3. Implement: build the per-dimension index (ids and count; archived cases as `{ id, sourceFindingIds }`) in the history writer and return it in `history`. Add exported `renderRemediationPromptProjection(projection, history)`, which returns the projection without `pendingAsBuiltFindings`, `priorAsBuiltCases`, `priorLaps`, and `refusals` and with `history`. Set `REMEDIATION_PROJECTION_VERSION` to 3. Add `history` to the `gap-plan` member of `remediationRequest` in `step-runner-types.ts`, pass it from the `buildRemediationProjection` call site in `conductor.ts`, and serialize the rendered form in the `gap-plan` branch of `step-runners.ts`. Keep passing the full projection to `validateRemediationPlan` and `persistRemediationPlan`.
4. Verify the tests pass (GREEN).
5. Commit with message: "feat(remediation): gap-plan prompt carries a history index instead of the history"

**Done when:**
- [test] A gap-plan step-runner test asserts the prompt input rendered by `renderRemediationPromptProjection` contains, for pending findings, prior laps, refusals, and prior cases, every entry id and the entry count, and contains the path and a SHA-256 digest of the active file and of the resolved file equal to the digests of the files on disk.
- [test] A gap-plan step-runner test asserts each prior case held in the resolved file is listed in the rendered prompt input by an object with exactly the keys `id` and `sourceFindingIds`.
- [test] A gap-plan step-runner test asserts the rendered prompt input states projection version 3, which is higher than the previous version 2.
- [test] A gap-plan step-runner test over a projection with no entries in a history dimension asserts the rendered index states a count of 0 and an empty id list for that dimension, and the dimension key is present.

**Files likely touched:**
- `src/conductor/src/engine/remediation-projection.ts` — index, `renderRemediationPromptProjection`, version 3
- `src/conductor/src/engine/step-runner-types.ts` — `history` on the `gap-plan` request
- `src/conductor/src/engine/step-runners.ts` — serialize the rendered prompt projection
- `src/conductor/src/engine/conductor.ts` — pass `history` in the `gap-plan` request
- `src/conductor/test/engine/step-runners-remediate-gap-plan.test.ts` — prompt rendering tests
- `src/conductor/test/engine/remediation-plan-fixtures.ts` — fixtures gain `history`

**Dependencies:** Task 2

### Task 7: Keep history content out of the prompt
**Story:** Story 3
**Type:** negative-path

**Steps:**
1. Write failing tests in the gap-plan step-runner test over a projection with pending findings, open prior cases, prior laps, and refusals, and over two projections whose histories differ in size by a factor of 100.
2. Verify the tests fail (RED) against any rendering that leaves a history collection inline.
3. Implement any gap the tests expose in `renderRemediationPromptProjection`; no new behavior beyond Task 6 is expected.
4. Verify the tests pass (GREEN).
5. Commit with message: "test(remediation): prompt size does not grow with history content"

**Done when:**
- [test] A gap-plan step-runner test asserts the rendered prompt input has no `pendingAsBuiltFindings`, `priorAsBuiltCases`, `priorLaps`, or `refusals` key and that each of those dimensions appears only as ids and a count under `history`.
- [test] A gap-plan step-runner test over two projections with identical required references and tasks and histories differing in size by a factor of 100 asserts the two rendered prompt inputs are equal after removing the `history` index entries, paths, and digests.
- [test] A projection test rewrites the active history file after `buildRemediationProjection` returns and asserts the SHA-256 of the file on disk no longer equals the digest stated in the prompt index rendered by `renderRemediationPromptProjection`, so the change is detectable from the index.

**Files likely touched:**
- `src/conductor/src/engine/remediation-projection.ts` — rendering gaps, if any
- `src/conductor/test/engine/step-runners-remediate-gap-plan.test.ts` — no-history-inline tests
- `src/conductor/test/engine/remediation-projection.test.ts` — digest mismatch test

**Dependencies:** Task 6

### Task 8: Delete the history byte limits and measure only the inlined payload
**Story:** Story 3
**Story:** Story 1
**Story:** Story 4
**Type:** refactor

**Steps:**
1. Follow `/code-removal`. What dies: the `pendingAsBuiltFindingsBytes`, `priorLapsBytes`, `priorAsBuiltCasesBytes`, and `refusalsBytes` entries in `REMEDIATION_PROJECTION_CORPUS_MAXIMA_BYTES`, `REMEDIATION_PROJECTION_COMPONENT_LIMITS`, and `RemediationProjectionLimits`; `REMEDIATION_PROJECTION_OPTIONAL_CONTEXT_FLOOR_BYTES`; the four history rows in `projectionLimitFault`; and the existing tests whose subject is a history-dimension overflow. What survives: the `required-references`, `tasks`, and `total` faults.
2. Write failing tests for the surviving behavior: an oversize `tasks` set and an oversize `required-references` set still fault; a total-limit fault is computed from the rendered prompt projection; a history far larger than the total limit produces no fault.
3. Verify the tests fail (RED).
4. Implement the deletion. Recompute the total limit as the rounded-up sum of the two remaining component limits and `REMEDIATION_PROJECTION_ENVELOPE_OVERHEAD_BYTES`, and measure `total` as the serialized `renderRemediationPromptProjection` output without `evidence`. Update the corpus limits test and the two overrides in `conductor-groups-and-signals.test.ts` that name deleted limits.
5. Verify the tests pass (GREEN).
6. Commit with message: "refactor(remediation): remove history byte limits from the gap-plan projection"

**Done when:**
- [test] A projection test with required references over `requiredReferencesBytes` and a second with tasks over `tasksBytes` each assert `buildRemediationProjection` returns a preparation fault before invocation naming that dimension, its actual size, and its limit.
- [test] A conductor remediation test with a `totalBytes` override below the rendered prompt size asserts preparation stops before invocation, with the remediate step runner never invoked, and the HALT detail from `projectionLimitFault` names dimension `total`, its actual size, and its limit, where the actual size equals the serialized rendered prompt projection and does not count the history file sizes.
- [test] A projection test with prior as-built cases, pending findings, prior laps, and refusals each larger than the total limit asserts `buildRemediationProjection` returns ok and no fault names `prior-as-built-cases`, `pending-as-built-findings`, `prior-laps`, or `refusals`.
- `RemediationProjectionLimits` in `src/conductor/src/engine/remediation-projection.ts` declares no `pendingAsBuiltFindingsBytes`, `priorLapsBytes`, `priorAsBuiltCasesBytes`, or `refusalsBytes` member, and `npx tsc --noEmit` in `src/conductor` exits 0.

**Files likely touched:**
- `src/conductor/src/engine/remediation-projection.ts` — delete history limits, recompute and re-measure `total`
- `src/conductor/test/corpus/remediation-projection-limits.test.ts` — drop history-limit cases, add surviving-limit cases
- `src/conductor/test/engine/remediation-projection.test.ts` — no-size-fault test
- `src/conductor/test/engine/conductor-remediation-typed-plan.test.ts` — total-limit halt before dispatch
- `src/conductor/test/engine/conductor-groups-and-signals.test.ts` — overrides that named deleted limits

**Dependencies:** Task 7

### Task 9: Decide the halt class of a projection fault from its cause
**Story:** Story 4
**Type:** negative-path

**Steps:**
1. Write failing conductor tests, one per fault: a prior repair task missing from the plan, an unreadable case store, an oversize `tasks` dimension, an unreadable kickback ledger, a missing typed verdict, a history write failure in an as-built round, and an owner task missing from the plan that no prior case names.
2. Verify the tests fail (RED) where classing still depends on the dimension name or source string.
3. Implement in `conductor.ts`: `needs-human` when the fault cause is `prior-repair-task-missing` or `case-store-unreadable`, otherwise `mechanical`. Remove the comparison against the `prior-as-built-cases` dimension and the `remediation case store` source. Stop setting `dimension` on the missing-repair-task fault; its detail still names the task id.
4. Verify the tests pass (GREEN).
5. Commit with message: "fix(remediation): class projection faults by cause so a size overflow is never needs-human"

**Done when:**
- [test] A conductor remediation test over a prior as-built case naming a repair task the active plan no longer declares asserts the remediate step runner is never invoked and the HALT is class `needs-human` with a detail naming that task id.
- [test] A conductor remediation test over an unreadable remediation case store in an as-built round asserts the HALT is class `needs-human` with a detail naming the store.
- [test] A conductor remediation test over an oversize `tasks` dimension asserts the HALT detail carries an actual size and a limit and its class is `mechanical`, and a table test over every fault the projection can return with both `actual` and `limit` asserts each is classed `mechanical`.
- [test] Conductor remediation tests over an unreadable kickback ledger, a missing typed verdict, and a history write failure during an as-built round each assert the HALT class is `mechanical` and not `needs-human`.
- [test] A conductor remediation test over an owner task missing from the active plan that no prior as-built case names as a repair task asserts the HALT class is `mechanical`.

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — halt class from fault cause
- `src/conductor/src/engine/remediation-projection.ts` — drop `dimension` from the missing-repair-task fault
- `src/conductor/test/engine/conductor-remediation-typed-plan.test.ts` — one test per fault cause

**Dependencies:** Task 4, Task 8

### Task 10: Leave the other remediate dispatch modes without history files
**Story:** Story 1
**Type:** negative-path

**Steps:**
1. Write tests that run a PRD-widening reconciliation dispatch and a `build_review` case-context dispatch in a temporary worktree and capture their prompts.
2. Verify the tests fail (RED) if either path reaches the history writer; otherwise they pass on first run and pin the boundary.
3. Implement nothing unless a test fails; the history writer is reachable only from `buildRemediationProjection`.
4. Verify the tests pass (GREEN).
5. Commit with message: "test(remediation): reconciliation and case-context dispatches write no history files"

**Done when:**
- [test] A step-runner test dispatching `remediationRequest` mode `prd-widening-reconciliation` asserts no file exists under `.pipeline/remediation-history/` afterward and the prompt equals `PRD WIDENING RECONCILIATION INPUT (engine-owned):` followed by the supplied projection string unchanged.
- [test] A `build_review` adjudication context test asserts a case-context dispatch writes no file under `.pipeline/remediation-history/` and its rendered context is deep-equal to the existing expected case-context fixture, unchanged, with no `history` key.

**Files likely touched:**
- `src/conductor/test/engine/step-runners-remediate-gap-plan.test.ts` — reconciliation-mode test
- `src/conductor/test/engine/build-review-adjudication-context.test.ts` — case-context test

**Dependencies:** Task 6

### Task 11: Validate the returned plan against the in-memory projection only
**Story:** Story 6
**Type:** negative-path

**Steps:**
1. Write tests in the plan-contract test for a `recurrence` bound to a case that the history writer placed in the resolved file, an unaccounted pending finding, and a prior case id present in neither file. Write a gap-plan step-runner test that alters and then deletes the history files between dispatch and validation.
2. Verify the tests fail (RED) if validation reads a history file or rejects an archived case; otherwise they pin current behavior.
3. Implement nothing in `remediation-plan-contract.ts` unless a test fails. `step-runners.ts` must pass `gapPlan.projection`, not the rendered prompt projection, to `validateRemediationPlan`.
4. Verify the tests pass (GREEN).
5. Commit with message: "test(remediation): plan validation is independent of the history files"

**Done when:**
- [test] A plan-contract test asserts `validateRemediationPlan` accepts a `recurrence` whose `priorCaseId` names a `resolved` case held only in the resolved history file and still applies its existing repair-task binding check to that case.
- [test] A plan-contract test asserts `validateRemediationPlan` accepts a plan accounting for every pending as-built finding and rejects a plan leaving one without a disposition with a diagnostic naming that finding, and a gap-plan step-runner test asserts that rejection is returned as `structured-result-rejected` so the existing bounded remediate retry applies.
- [test] A plan-contract test asserts `validateRemediationPlan` rejects a `priorCaseId` that is in neither history file with a diagnostic naming that case id.
- [test] A gap-plan step-runner test asserts the validation result for the same returned plan is identical with the history files intact, altered on disk, and deleted.

**Files likely touched:**
- `src/conductor/test/engine/remediation-plan-contract.test.ts` — archived-case, unaccounted-finding, unknown-case tests
- `src/conductor/test/engine/step-runners-remediate-gap-plan.test.ts` — altered-file validation test
- `src/conductor/src/engine/step-runners.ts` — validation input stays the in-memory projection

**Dependencies:** Task 6

### Task 12: Direct the remediate skill to read the history files
**Story:** Story 5
**Type:** happy-path

**Steps:**
1. Write failing assertions in the remediate skill-contract test against the `As-built gap-plan reconciliation` section and a new `Remediation history files` section of `skills/remediate/SKILL.md`.
2. Verify the tests fail (RED).
3. Implement the skill text. In gap-plan mode the skill directs the agent to: read the active history file named by `history.active.path` in full before judging any finding; read the resolved history file named by `history.resolved.path` only when a current finding may be a recurrence of a resolved case listed in the index, before choosing that finding's reconciliation relation, and otherwise not read it; read the text of a prior-case source that has no `summary` from the pending finding with the same `findingId` in the active history file; and return a `halt` disposition naming the file when a history file named in the index is missing or unreadable, never judging from the index alone. State that `build_review` case contexts and PRD-widening reconciliation use their existing inputs and no remediation history file. Keep the existing rule that gap planning reads no verdict file and writes no file. Where the refusal-rework section keys on supplied `refusals`, point it at the `refusals` index and the active history file.
4. Verify the tests pass (GREEN).
5. Commit with message: "feat(remediate): direct gap planning to the engine-written history files"

**Done when:**
- [test] The remediate skill-contract test asserts the gap-plan guidance in `skills/remediate/SKILL.md` directs reading the active history file named in the index in full before judging any finding, and directs reading a summary-less prior-case source's text from the pending finding with the same finding id in the active history file.
- [test] The remediate skill-contract test asserts the guidance directs reading the resolved history file before choosing a reconciliation relation when a current finding may be a recurrence of a resolved case, and directs not reading it when no current finding may be such a recurrence.
- [test] The remediate skill-contract test asserts the guidance directs returning a `halt` disposition naming the file when a history file named in the index is missing or unreadable, instead of judging from the index alone.
- [test] The remediate skill-contract test asserts the `build_review` case-mode and PRD-widening reconciliation sections direct the agent to those modes' existing inputs and name no remediation history file, and the existing assertion that gap-planning guidance names no verdict file as an input and no file as a write still passes.

**Files likely touched:**
- `skills/remediate/SKILL.md` — history-file reading directions
- `src/conductor/test/engine/remediate-skill-contract.test.ts` — skill-contract assertions

**Dependencies:** Task 6

## Optional Task Dependency Graph

```
1 ─┬─ 2 ─┬─ 6 ─┬─ 7 ── 8 ─┐
   │     │     ├─ 10      ├─ 9
   │     │     ├─ 11      │
   │     │     └─ 12      │
   ├─ 3  └─ 5 ◄─ 4        │
   └─ 4 ──────────────────┘
```

## Integration Points

- After Task 1: an as-built remediation round writes both history files while the prompt is still inline.
- After Task 6: the remediate dispatch receives the index-only prompt through the real `gap-plan` branch.
- After Task 9: a remediation round with any history size reaches its dispatch, and only the two operator-owned faults halt `needs-human`.

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D1 | no-change | none | D1 separates decision authority from the current report; this feature reads and writes neither record |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D2 | no-change | none | D2 governs the widening storage envelope; the history files are a separate transient input and no store format changes |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D3 | no-change | none | D3 governs capture of original widening decisions before reconciliation; gap-plan history delivery does not touch that capture |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D4 | no-change | none | D4 governs legacy widening authority; no legacy record is read or rewritten here |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D5 | task | task-10 | no file exists under `.pipeline/remediation-history/` afterward and the prompt equals `PRD WIDENING RECONCILIATION INPUT (engine-owned):` followed by the supplied projection string unchanged |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D6 | no-change | none | D6 governs the engine-owned native output schema; the gap-plan output schema `REMEDIATION_PLAN_SCHEMA` and its consumers are unchanged, and only the prompt input changes |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D7 | task | task-8 | asserts `buildRemediationProjection` returns ok and no fault names `prior-as-built-cases`, `pending-as-built-findings`, `prior-laps`, or `refusals` |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D8 | no-change | none | D8 governs committing widening relationships with optimistic freshness; no relationship commit path changes |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D9 | no-change | none | D9 assigns recovery and observability to existing owners; history-write failure uses the existing remediation validator halt and adds no event or recovery path |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D10 | no-change | none | D10 records that ADR's own amendments and delivery boundary; it imposes no implementation work on this feature |
| adr-2026-10-28-as-built-finding-reconciliation#D1 | no-change | none | The `as_built` case domain and its store are read through the existing reader and are not changed |
| adr-2026-10-28-as-built-finding-reconciliation#D2 | task | task-2 | asserts every stored case appears in exactly one file, the union of both files equals the stored case set |
| adr-2026-10-28-as-built-finding-reconciliation#D3 | task | task-11 | asserts `validateRemediationPlan` accepts a `recurrence` whose `priorCaseId` names a `resolved` case held only in the resolved history file |
| adr-2026-10-28-as-built-finding-reconciliation#D4 | existing | none | `validateRemediationPlan` in `src/conductor/src/engine/remediation-plan-contract.ts` already enforces the admissible effect per relation against the in-memory projection, which this feature leaves unchanged |
| adr-2026-10-28-as-built-finding-reconciliation#D5 | no-change | none | Reconciliation still never changes as-built authority; the fresh as-built verdict remains the completion authority and no authority record is written |
| adr-2026-10-28-as-built-finding-reconciliation#D6 | no-change | none | Recording each source finding with its result happens after validation in the existing case reconciler, which is untouched |
| adr-2026-10-28-as-built-finding-reconciliation#D7 | no-change | none | The per-source spine event is emitted by the existing recording path; the history files are durable input state and add no event |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic
- [ ] Tasks do not invalidate each other's fixtures or assertions
