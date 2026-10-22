# Implementation Plan: Done-when `[test]` citations are proven by provenance or judgement

**Date:** 2026-10-21
**Stories:** .docs/stories/done-when-closes-as-verified-citing-tests-that-don.md
**Conflict check:** Clean as of 2026-10-21 (.docs/conflicts/2026-10-21-done-when-closes-as-verified-citing-tests-that-don.md)

## Summary

Close the #3200 gap. A `[test]` Done-when check now closes `verified` only when the cited test's title
sits on a line the task itself added. Every other citation is held for one bounded, schema-constrained
judgement when the BUILD session ends:
- A refusal reopens the task through the existing repair-obligation path, at most once per pass.
- It demotes to `unverified` after two refusals, or when the judge cannot run.
- The operator can overturn it with `ai-conductor done-when accept`.

18 tasks. Source: jstoup111/ai-conductor#3200.

## Technical Approach

**Start commit (D10).**
- `runTaskStart` (`task-cli.ts`) writes `startHead` from `git rev-parse HEAD`. So does the Claude Code
  session hook's inline `node -e` stamping script (`session-hook-assets.ts`), which uses
  `execFileSync('git', ['rev-parse','HEAD'])` and fails open.
- Neither path overwrites an existing value.
- Seeding (`task-seed.ts`) and repair restaging (`repair-restage.ts`) keep the field.
- `rebase-translate.ts` maps it alongside the row's `commit` SHA.

**Provenance (D11/D12).**
- A pure function in `done-when-test-reference.ts` takes the cited path, title and the raw
  `git diff <startHead> HEAD -- <path>` text. It answers `task-added` or `not-task-added` from the
  whitespace-normalized concatenation of `+` lines.
- `completeTaskDoneWhen` (`task-progress.ts`) supplies the diff, after the ancestry check
  `git merge-base --is-ancestor`, and stamps `verified` or `pending-judgement`.
- D6's existing text checks run first, unchanged. No `Task:` trailer is read.

**Closed source set (D17).**
- `DoneWhenEvidenceRecord.source` becomes the seven-value union.
- One exported parser, `parseDoneWhenCloseSource`, rejects unknown values by name. Every close-record
  reader goes through it.

**Judgement (D13).**
- A new pure module, `src/conductor/src/engine/done-when-citation-judgement.ts`, owns:
  - collecting pending citations;
  - the bounded input (cited file content capped to a fixed window around the title);
  - the native output schema, which is an array of `{ taskId, check, verdict: asserts or does-not-assert, reason }`;
  - output validation, which fails the whole dispatch when a verdict is missing or unknown;
  - verdict application to task-status.
- A new `DefaultStepRunner.dispatchDoneWhenCitationJudgement` (declared in `step-runner-types.ts`)
  dispatches it through the existing free-form provider one-shot under the `build` step with
  `nativeSchema`. It mirrors the `prd_audit` native-schema dispatch:
  - first, the up-front capability check that some configured provider declares
    `nativeSchemaCapability.nativeOutputSchema`;
  - then one dispatch, plus one retry on failure.

**Placement.**
- The conductor's BUILD post-session path runs the judgement before `checkStepCompletion` for `build`,
  in the same place the D8 nudge is decided.
- A refusal admits one `done-when-citation` repair obligation per task through
  `createRepairObligationStore(...).admit`, restages the task through `repair-restage.ts`, and withholds
  completion.
- The withholding reason starts with the fixed prefix `Done-when citation refused:`. The retry hint
  names the task, check, citation and reason, and never names an operator-only command.
- The existing breaker exemption for the D8 nudge (the `unverified Done-when checks require one BUILD
  review pass:` prefix) is widened to this prefix (D14), so the refused attempt is not
  `no_task_progress`.

**Settlement (D14 and 09-06 decision 13).**
- The judgement module persists per-check refusal counts in the engine-state repair section, through
  the existing serialized update seam. Each count is keyed by task id, check index and a digest of the
  check text.
- At each BUILD session end, before judging, it settles every listed check:
  - a check whose text left the plan is dropped;
  - a check not re-closed is demoted to `unverified`;
  - a re-closed check is judged again or verified.
- A second refusal, or a refusal on the final attempt, demotes.
- `completeTaskDoneWhen` settles a listed check only when its new record is `verified`.

**Operator lever (D16).**
- A new `src/conductor/src/engine/done-when-accept-cli.ts` implements the fully bound grammar
  `done-when accept --feature <slug> --task <id> --check <n> --reason <text>`. It is detected in
  `cli.ts`, mirroring `detectBuildReviewAcceptCommand`, and dispatched in `index.ts`.
- `done-when` is added only to `KNOWN_BLOCKED_SUBCOMMANDS` in `execution/daemon-session.ts`, never to
  the sanctioned list.

**Events (D18).**
- Two new `ConductorEvent` members with `EVENT_SINKS` rows:
  - `done_when_citation_judged`, emitted by the conductor;
  - `done_when_citation_accepted`, emitted by the accept CLI through `startOperatorEventSpine`, as the
    plan-gap HALT does.

**Release gate.**
- `classifyBreakingSurfaces` flags only `bin/conduct`, `bin/install`, `hooks/`, settings files and skill
  deletions or renames.
- This plan touches none of them. The session hook asset is a TypeScript file under `src/`, and
  `skills/pipeline/SKILL.md` is modified, not removed.
- So no waiver and no migration block is needed. That settles architecture-review condition 2.

**Local patterns.**
- **Operator command:** `detectBuildReviewAcceptCommand` (`cli.ts`).
  - Preserve: exact-grammar detection that returns null on any extra or missing flag, and slug validation.
- **Native-schema judgement:** the `prd_audit` dispatch in `step-runners.ts`.
  - Preserve: the capability refusal before dispatch, and engine-side validation.
- **Pure judge module:** `rebase-regrade-judgement.ts`.
  - Preserve: an injected judge function, with verdict application testable without a provider.
- **Reopen:** existing-task obligation admission and `restageExistingRemediationTaskStatuses`.
  - Preserve: idempotent admission keyed by finding id.

Search hints: `admit(`, `restageExistingRemediationTaskStatuses`, `unverifiedDoneWhenNudgeCompletion`,
`PRD_AUDIT_JUDGMENT_SCHEMA`, `executeProviderAwareFreeFormOneShot`.

## Prerequisites

- None. All changes are inside `src/conductor/` and `skills/pipeline/SKILL.md`.

## Tasks

### Task 1: `conduct task start` records the task's start commit
**Story:** Story 1
**Type:** infrastructure
**Dependencies:** none

**Steps:**
1. Write failing tests in `task-cli.test.ts`:
   - starting a pending task at HEAD A writes `in_progress` and `startHead: A`;
   - re-starting after HEAD moved to B keeps A;
   - starting with a failing `git rev-parse` (test-injected git runner) writes `in_progress` with no
     `startHead` and exits 0;
   - closing a legacy row without the field reads as no start commit.
2. Verify RED.
3. Implement in `runTaskStart`. Read HEAD through the existing git helper and set `startHead` only when
   absent. Leave every other row field untouched.
4. Verify GREEN and commit: "feat(task-cli): record the task start commit".

**Done when:**
- [test] `runTaskStart` on a pending row at HEAD A writes status `in_progress` and `startHead` A, and every other field of the row is unchanged from before the start.
- [test] A second `runTaskStart` after HEAD moved to B leaves `startHead` A, and a start whose `git rev-parse HEAD` fails writes `in_progress` with no `startHead` and returns exit code 0.
- [test] `completeTaskDoneWhen` on a row with no `startHead` field closes without throwing and treats it as having no start commit.

**Files:** src/conductor/src/engine/task-cli.ts; src/conductor/src/engine/task-progress.ts; src/conductor/test/engine/task-cli.test.ts

### Task 2: The Claude Code session hook records the start commit
**Story:** Story 1
**Type:** infrastructure
**Dependencies:** none

**Steps:**
1. Write failing tests in `session-hook-behavior.test.ts`. Execute the emitted pre-dispatch script
   against a temp git repo:
   - `Task: 4` as the prompt's first line at HEAD A sets `in_progress` and `startHead` A;
   - an existing `startHead` is kept;
   - with git unavailable on `PATH`, the row is `in_progress` with no `startHead` and the hook exits 0.
2. Verify RED.
3. Implement in the inline `node -e` script in `session-hook-assets.ts`: `execFileSync('git',
   ['rev-parse','HEAD'])` inside try/catch, set only when absent. Keep the script free of `dist/`,
   `conduct-ts` and `require('./`.
4. Verify GREEN and commit: "feat(session-hooks): stamp the task start commit".

**Done when:**
- [test] Running the emitted pre-dispatch hook for a prompt whose first line is `Task: 4` in a repo at HEAD A sets task 4's row to `in_progress` with `startHead` A, and a re-run after HEAD moves keeps A.
- [test] Running the hook where `git rev-parse HEAD` fails leaves task 4 `in_progress` with no `startHead` and the hook exits 0 without blocking the dispatch.
- [test] The existing static hook-content test still finds no `dist/`, `conduct-ts`, or `require('./` in the emitted scripts.

**Files:** src/conductor/src/engine/session-hook-assets.ts; src/conductor/test/engine/session-hook-behavior.test.ts; src/conductor/test/engine/session-hook-assets.test.ts

### Task 3: The start commit survives seeding, restaging and rebase translation
**Story:** Story 1
**Type:** infrastructure
**Dependencies:** Task 1

**Steps:**
1. Write failing tests:
   - in `task-seed.test.ts`, a reseed keeps a row's `startHead`;
   - in `repair-restage.test.ts`, `restageExistingRemediationTaskStatuses` keeps it;
   - in `rebase-translate.test.ts`, a map entry A→A' rewrites `startHead` to A' at its original length,
     and an unmapped A is unchanged with no residue entry.
2. Verify RED.
3. Implement: carry the field through seed and restage row rewrites. In `rebase-translate.ts`, map
   `task.startHead` with `resolveThroughMap` beside `task.commit`.
4. Verify GREEN and commit: "fix(task-status): preserve and translate the start commit".

**Done when:**
- [test] After a task-status reseed and after `restageExistingRemediationTaskStatuses` reopens task 4, task 4's row still has `startHead` A.
- [test] `translateAfterRebase` with map entry A to A' rewrites task 4's `startHead` to A', and with no entry for A leaves `startHead` A and writes no rebase-residue entry for it.

**Files:** src/conductor/src/engine/task-seed.ts; src/conductor/src/engine/repair-restage.ts; src/conductor/src/engine/rebase-translate.ts; src/conductor/test/engine/task-seed.test.ts; src/conductor/test/engine/repair-restage.test.ts; src/conductor/test/engine/rebase-translate.test.ts

### Task 4: The close-record source set is closed at seven values
**Story:** Story 3
**Type:** infrastructure
**Dependencies:** none

**Steps:**
1. Write failing tests in `done-when-test-reference.test.ts`:
   - `parseDoneWhenCloseSource` accepts each of the seven values and returns an error naming an
     unknown value;
   - `collectUnverifiedDoneWhenChecks` reports a malformed-source diagnostic naming the value rather
     than skipping or misclassifying it.
2. Verify RED.
3. Implement:
   - widen `DoneWhenEvidenceRecord.source` in `task-progress.ts` to `verified | reported | verify-only
     | unverified | pending-judgement | judged | operator-accepted`;
   - add the exported parser in `done-when-test-reference.ts` with an exhaustive `switch` and no
     default branch;
   - route the existing reader through it.
4. Verify GREEN and commit: "feat(done-when): close the seven-value close-record source set".

**Done when:**
- [test] `parseDoneWhenCloseSource` returns each of `verified`, `reported`, `verify-only`, `unverified`, `pending-judgement`, `judged`, and `operator-accepted` unchanged and returns an error naming the value for any other string.
- [test] `collectUnverifiedDoneWhenChecks` over a status file holding a record with source `bogus` reports that record by its source name and does not count it as unverified or as any known source, and `completeTaskDoneWhen` re-closing a task whose prior record has source `bogus` refuses naming `bogus`.
- `DoneWhenEvidenceRecord.source` is the seven-member union and the parser's `switch` has no default branch.

**Files:** src/conductor/src/engine/done-when-test-reference.ts; src/conductor/src/engine/task-progress.ts; src/conductor/test/engine/done-when-test-reference.test.ts

### Task 5: Start-window provenance decides whether the task wrote the cited test
**Story:** Story 2
**Type:** happy-path
**Dependencies:** none

**Steps:**
1. Write failing unit tests for a pure `classifyCitationProvenance({ path, title, diffText })` in
   `done-when-test-reference.test.ts`. Cover:
   - title on a `+` line gives `task-added`;
   - title split across two `+` lines with different whitespace gives `task-added`;
   - title only on context lines gives `not-task-added`;
   - a body-only `+` hunk with the title on a context line gives `not-task-added`;
   - a diff for a different file gives `not-task-added`.
2. Verify RED.
3. Implement it on text only: parse `diff --git` file headers, keep the hunks for `path`, join their
   `+` lines (excluding `+++`) whitespace-normalized, and test the substring. No AST, no trailer.
4. Verify GREEN and commit: "feat(done-when): classify citation provenance from the start-window diff".

**Done when:**
- [test] `classifyCitationProvenance` returns `task-added` when the normalized title appears in the cited file's added lines, including a title split across two added lines with different whitespace.
- [test] `classifyCitationProvenance` returns `not-task-added` when the title appears only on context lines, when only body lines of an existing test were added, and when the title is added only in a different file than the cited path.
- The module imports no language parser and reads no `Task:` trailer.

**Files:** src/conductor/src/engine/done-when-test-reference.ts; src/conductor/test/engine/done-when-test-reference.test.ts

### Task 6: Task close stamps `verified` or `pending-judgement`
**Story:** Story 3
**Type:** happy-path
**Dependencies:** Tasks 1, 4, 5

**Steps:**
1. Write failing tests in `task-cli.test.ts` using a real temp git repo through `conduct task done`. Cover:
   - task started at A, test added after A, gives `verified` with no judgement requested;
   - a different task's test added after A gives `verified`;
   - a pre-existing test gives task `completed` and the check `pending-judgement`;
   - a never-started task gives `pending-judgement`;
   - a rebased-away `startHead` with a test added after it gives `pending-judgement`;
   - a mixed untagged and tagged task gives `reported` plus `pending-judgement`;
   - a missing title is still refused with no record written;
   - no event file is written and no provider is invoked.
2. Verify RED.
3. Implement in `completeTaskDoneWhen`: after `verifyDoneWhenTestReference` passes, check that
   `startHead` is an ancestor of HEAD (`git merge-base --is-ancestor`), read `git diff <startHead> HEAD
   -- <path>`, and stamp from `classifyCitationProvenance`. Any git failure gives `pending-judgement`.
4. Verify GREEN and commit: "feat(task-progress): hold untouched-test citations for judgement".

**Done when:**
- [test] `conduct task done 4` citing a test whose title was added after task 4's `startHead` records source `verified`, including when another task added it, and the run invokes no provider.
- [test] `conduct task done 24` citing a test whose title predates `startHead`, or for a task with no `startHead`, or whose `startHead` is not an ancestor of HEAD, records task 24 `completed` and the check `pending-judgement`.
- [test] A task with one untagged and one `[test]` check citing a pre-existing test records `reported` and `pending-judgement` respectively, and a reference with a missing title is refused with no close record written.
- [test] A pending close writes no line to `.pipeline/events.jsonl` and invokes no provider.

**Files:** src/conductor/src/engine/task-progress.ts; src/conductor/test/engine/task-cli.test.ts

### Task 7: The citation judgement contract: input, schema and output validation
**Story:** Story 4
**Type:** infrastructure
**Dependencies:** Task 4

**Steps:**
1. Write failing tests in a new `done-when-citation-judgement.test.ts`. Cover:
   - `collectPendingCitations` returns every `pending-judgement` record with its task id and check index;
   - `buildCitationJudgementInput` carries the check text, the task text, the path, the title, and the
     cited file content capped to a fixed line window centred on the title;
   - `validateCitationJudgementOutput` accepts a verdict per pending citation;
   - a missing verdict for any pending citation fails the whole output;
   - a verdict for an unknown task or check is ignored.
2. Verify RED.
3. Implement the new pure module. Export `DONE_WHEN_CITATION_JUDGEMENT_SCHEMA` (a JSON schema with
   verdict enum `asserts` and `does-not-assert` and a required non-empty `reason`) and the window-size
   constant.
4. Verify GREEN and commit: "feat(done-when): add the citation judgement contract".

**Done when:**
- [test] `buildCitationJudgementInput` for a pending citation contains its check text, task text, cited path and title, and the cited file's HEAD content limited to the fixed window around the title.
- [test] `validateCitationJudgementOutput` returns a failed-dispatch result and applies no verdict when any pending citation lacks a verdict, and ignores a verdict naming a task and check not in the pending set.
- [test] `collectPendingCitations` over a status file holding a record with source `bogus` reports that record by its source name and does not return it as pending.
- `DONE_WHEN_CITATION_JUDGEMENT_SCHEMA` restricts `verdict` to `asserts` and `does-not-assert` and requires a non-empty `reason`.

**Files:** src/conductor/src/engine/done-when-citation-judgement.ts; src/conductor/test/engine/done-when-citation-judgement.test.ts

### Task 8: The step runner dispatches the judgement with the native output schema
**Story:** Story 4
**Type:** infrastructure
**Dependencies:** Task 7

**Steps:**
1. Write failing tests in `step-runners` tests with mocked provider runtimes. Cover:
   - a schema-capable candidate is dispatched once, non-interactive and read-only, with `nativeSchema`
     set to the judgement schema;
   - a schema-invalid first result is retried exactly once;
   - with no schema-capable candidate, the method returns `{ kind: 'unavailable', cause }` without
     dispatching;
   - two failures return `{ kind: 'unavailable', cause }`.
2. Verify RED.
3. Implement `dispatchDoneWhenCitationJudgement(input)` on `DefaultStepRunner`, declared in
   `step-runner-types.ts`. Follow the `prd_audit` pattern: run the capability check against
   `configuredProviders` first, then dispatch through `executeProviderAwareFreeFormOneShot('build',
   ...)` with `nativeSchema`. Validate with `validateCitationJudgementOutput`.
4. Verify GREEN and commit: "feat(step-runners): dispatch the citation judgement".

**Done when:**
- [test] With a schema-capable provider, `dispatchDoneWhenCitationJudgement` makes one provider call with `nativeSchema` equal to `DONE_WHEN_CITATION_JUDGEMENT_SCHEMA` and returns the validated verdicts.
- [test] A schema-invalid first result is retried exactly once and a valid retry's verdicts are returned with no refusal recorded for the failed attempt.
- [test] With no provider declaring `nativeSchemaCapability.nativeOutputSchema` the method returns `unavailable` without any provider call, and after two failed calls it returns `unavailable` naming the failure.

**Files:** src/conductor/src/engine/step-runners.ts; src/conductor/src/engine/step-runner-types.ts; src/conductor/test/engine/step-runners-done-when-citation.test.ts

### Task 9: The conductor judges pending citations when the BUILD session ends
**Story:** Story 4
**Type:** happy-path
**Dependencies:** Tasks 6, 8

**Steps:**
1. Write failing conductor tests with a stub step runner and a real `.pipeline/task-status.json`. Cover:
   - two pending citations on tasks 7 and 9 produce exactly one judgement call, made before the BUILD
     completion predicate is evaluated;
   - an `asserts` verdict stamps `judged` with its reason;
   - a session end with no pending citations makes no call.
2. Verify RED.
3. Implement in the conductor's BUILD post-session path, before `checkStepCompletion(..., 'build', ...)`:
   collect the pending citations, dispatch once, and apply verdicts through
   `applyCitationVerdicts` in the judgement module, which owns the task-status write.
4. Verify GREEN and commit: "feat(conductor): judge pending Done-when citations at the BUILD boundary".

**Done when:**
- [test] A BUILD session ending with pending citations on tasks 7 and 9 makes exactly one `dispatchDoneWhenCitationJudgement` call covering both, and the call happens before the BUILD completion predicate runs.
- [test] An `asserts` verdict for task 7's check rewrites its close record to source `judged` carrying the verdict's reason, and BUILD then completes when nothing else is outstanding.
- [test] A BUILD session ending with no pending citation makes no `dispatchDoneWhenCitationJudgement` call.
- [test] When the judgement output also carries a verdict for a task and check outside the pending set, `applyCitationVerdicts` leaves that task's close records byte-identical.

**Files:** src/conductor/src/engine/conductor.ts; src/conductor/src/engine/done-when-citation-judgement.ts; src/conductor/test/engine/conductor-done-when-citation.test.ts

### Task 10: A refusal reopens its task through one citation obligation
**Story:** Story 5
**Type:** happy-path
**Dependencies:** Task 9

**Steps:**
1. Write failing tests in `conductor-done-when-citation.test.ts` and `repair-obligations.test.ts`. Cover:
   - a `does-not-assert` verdict with attempts left admits one `done-when-citation` obligation for task
     24 and restages it to pending;
   - BUILD completion is withheld with reason prefix `Done-when citation refused:`;
   - the retry hint names task 24, the check, the cited reference and the reason, and no operator-only
     command;
   - checks 2 and 3 refused in one pass give one live obligation listing both;
   - pre-reopen `Task: 24` commits do not resolve task 24;
   - re-running the admission after a simulated restart admits nothing new and keeps the refusal count.
2. Verify RED.
3. Implement in the judgement module and conductor:
   - finding id = digest of the task id plus the sorted open refused checks (index, text digest,
     reference), with authority `done-when-citation`;
   - admit through `createRepairObligationStore(...).admit` with that admission key, then restage
     through `restageExistingRemediationTaskStatuses`;
   - persist refusal counts in the engine-state repair section through the serialized update seam;
   - add the completion reason in the BUILD predicate path.
4. Verify GREEN and commit: "feat(done-when): reopen tasks on refused citations".

**Done when:**
- [test] A `does-not-assert` verdict for task 24 with a BUILD attempt left admits one obligation with authority `done-when-citation`, restages task 24 to pending, and withholds BUILD completion with a reason starting `Done-when citation refused:`.
- [test] The BUILD retry hint after that refusal names task 24, the refused check, the cited reference, and the judge's reason, and contains no `done-when accept` text.
- [test] Two refused checks of task 24 in one pass produce exactly one live `done-when-citation` obligation listing both, and `resolveTaskIdsWithDiagnostics` does not count task 24 resolved from `Task: 24` commits made before the reopen.
- [test] Replaying the refusal application after a simulated engine restart admits no second obligation, leaves task 24 reopened, and leaves each check's refusal count unchanged.

**Files:** src/conductor/src/engine/done-when-citation-judgement.ts; src/conductor/src/engine/conductor.ts; src/conductor/src/engine/artifacts.ts; src/conductor/test/engine/conductor-done-when-citation.test.ts; src/conductor/test/engine/repair-obligations.test.ts

### Task 11: Refused checks are settled at the next session end, and demoted at the bound
**Story:** Story 5
**Type:** negative-path
**Dependencies:** Task 10

**Steps:**
1. Write failing tests in `done-when-citation-judgement.test.ts` and `conductor-done-when-citation.test.ts`. Cover:
   - a second refusal of the same check records `unverified` with the judge's reason and no new reopen;
   - a refusal on the final BUILD attempt records `unverified` instead of reopening, and the BUILD step
     does not fail;
   - a reopened check not re-closed by the next session end, with or without a new `Task: 24` commit,
     is demoted and its obligation resolved;
   - a changed check text counts as a first refusal;
   - a listed check whose text left the plan task is dropped, and the obligation resolves once no
     listed check is open;
   - demoted checks appear in `collectUnverifiedDoneWhenChecks` with the judge's reason.
2. Verify RED.
3. Implement `settleCitationRefusals` in the judgement module and call it from the conductor at each
   BUILD session end, before judging. Close the obligation through the store's `close` once no listed
   check stays open.
4. Verify GREEN and commit: "feat(done-when): settle and demote refused citations".

**Done when:**
- [test] A second `does-not-assert` for the same task, check index, and check-text digest records that check `unverified` with the judge's reason, admits no further obligation, and does not withhold BUILD completion for that check, and a changed check text is counted as a first refusal.
- [test] A refusal arriving when the BUILD attempt is the last allowed records the check `unverified` with the judge's reason instead of reopening, and the BUILD step result is not a failure caused by the refusal.
- [test] A reopened check not re-closed when the next BUILD session ends is recorded `unverified` with the judge's reason whether or not a new `Task: 24` commit exists, and task 24's citation obligation is closed so task 24 is not reopened for it again.
- [test] `settleCitationRefusals` given a listed check whose close record has source `bogus` reports that record by its source name and neither demotes nor settles it.
- [test] A listed check whose text no longer appears in the current plan task is dropped and the obligation closes once no listed check is open, and every demoted check appears in `collectUnverifiedDoneWhenChecks` output carrying the judge's reason.

**Files:** src/conductor/src/engine/done-when-citation-judgement.ts; src/conductor/src/engine/conductor.ts; src/conductor/test/engine/done-when-citation-judgement.test.ts; src/conductor/test/engine/conductor-done-when-citation.test.ts

### Task 12: A re-close settles a refused check only when it is verified
**Story:** Story 5
**Type:** happy-path
**Dependencies:** Task 10

**Steps:**
1. Write failing tests in `task-cli.test.ts`. Cover:
   - re-closing a refused check citing a test added after the reopen records `verified` and settles that
     check in the citation obligation, so task 24 resolves;
   - re-closing citing another pre-existing test records `pending-judgement`, leaves the obligation
     open, and the next BUILD-boundary pass judges the new citation.
2. Verify RED.
3. Implement in `completeTaskDoneWhen`'s repair-close branch. For a live `done-when-citation`
   obligation, close it only for checks whose new record is `verified`. Other obligation sources keep
   closing exactly as today.
4. Verify GREEN and commit: "fix(task-progress): settle citation obligations on verified re-close".

**Done when:**
- [test] Re-closing task 24's refused check with a test added after the reopen records `verified`, settles that check in the live `done-when-citation` obligation, and `resolveTaskIdsWithDiagnostics` then counts task 24 resolved.
- [test] Re-closing it with another pre-existing test records `pending-judgement`, leaves the obligation open, and the next BUILD-boundary pass includes the new citation in its judgement call.
- [test] A live obligation of any other source is still closed by `completeTaskDoneWhen` with `current-done-when` evidence exactly as before.

**Files:** src/conductor/src/engine/task-progress.ts; src/conductor/test/engine/task-cli.test.ts

### Task 13: A refusal retry is never a no-progress stall
**Story:** Story 5
**Type:** negative-path
**Dependencies:** Task 10

**Steps:**
1. Write a failing conductor test: at attempt one and at attempt two or later, an attempt whose completion is withheld with
   the `Done-when citation refused:` prefix, and the attempt after it, are not classified
   `no_task_progress`, do not increment `noEvidenceAttempts`, and write no HALT.
2. Verify RED.
3. Implement by extending the existing nudge exemption predicate in the conductor's breaker to the new
   reason prefix. Keep every other miss counted.
4. Verify GREEN and commit: "fix(conductor): exempt citation-refusal retries from the stall breaker".

**Done when:**
- [test] For a withhold at any BUILD attempt, including attempt one followed by attempt two, the attempt withheld with a reason starting `Done-when citation refused:` and its following attempt are not classified `no_task_progress` or `active_stall`, emit no `build_stall` event, do not increment `noEvidenceAttempts`, and write no HALT marker.
- [test] An ordinary attempt with no resolved-count movement and no HEAD movement at attempt two or later is still classified `no_task_progress`.

**Files:** src/conductor/src/engine/conductor.ts; src/conductor/test/engine/conductor-done-when-citation.test.ts

### Task 14: An unavailable judgement demotes pending citations and never blocks
**Story:** Story 6
**Type:** negative-path
**Dependencies:** Task 9

**Steps:**
1. Write failing conductor tests. Cover:
   - `unavailable` from the dispatcher (no schema-capable provider, or two failures) records every
     pending check `unverified` with a reason starting `citation judgement unavailable:` naming the
     cause, reopens no task, and BUILD proceeds;
   - the existing one-nudge unverified handling then applies to those checks;
   - a first failure followed by a successful retry demotes nothing.
2. Verify RED.
3. Implement `demoteUnavailableCitations` in the judgement module and call it from the conductor on
   `unavailable`.
4. Verify GREEN and commit: "feat(done-when): demote citations when the judgement is unavailable".

**Done when:**
- [test] When `dispatchDoneWhenCitationJudgement` returns `unavailable`, every pending check is recorded `unverified` with a reason starting `citation judgement unavailable:` naming the cause, no obligation is admitted, and no HALT marker is written.
- [test] Those demoted checks then receive the existing one BUILD nudge and the `build_done_when_unverified` event exactly as other unverified checks do, and the BUILD step completes.
- [test] A dispatch whose first attempt fails and whose retry succeeds demotes no check.

**Files:** src/conductor/src/engine/done-when-citation-judgement.ts; src/conductor/src/engine/conductor.ts; src/conductor/test/engine/conductor-done-when-citation.test.ts

### Task 15: `ai-conductor done-when accept` grammar and refusals
**Story:** Story 7
**Type:** negative-path
**Dependencies:** none

**Steps:**
1. Write failing tests. Cover:
   - `detectDoneWhenAcceptCommand` returns null for any extra, missing or reordered flag, and for an
     invalid slug;
   - the handler exits 1 naming the missing reason for an empty or whitespace reason;
   - the handler exits 1 naming the unknown value for an unknown feature, task or check;
   - the handler exits 1 naming that the check has no refused citation;
   - each refusal leaves task-status and engine-state byte-identical;
   - under `AI_CONDUCTOR_DAEMON_SESSION=1`, `dispatchCliEntry` refuses `done-when` with bounded
     subcommand `done-when` and exit 1.
2. Verify RED.
3. Implement `done-when-accept-cli.ts` (detector plus handler), the `cli.ts` detection, the `index.ts`
   dispatch, and the `KNOWN_BLOCKED_SUBCOMMANDS` entry. Do not add it to
   `SESSION_SANCTIONED_SUBCOMMANDS`. Mark operator-facing text with the operator-only session-command
   context.
4. Verify GREEN and commit: "feat(cli): add the done-when accept operator command".

**Done when:**
- [test] `detectDoneWhenAcceptCommand` recognizes only `done-when accept --feature <slug> --task <id> --check <n> --reason <text>` and returns null for an extra flag, a missing flag, or an invalid slug, so no handler runs and task-status and engine-state stay byte-identical.
- [test] The handler exits 1 naming the missing reason for an empty or whitespace reason, naming the unknown value for an unknown feature, task id, or check number, and naming that the check has no refused citation, and in each case task-status and engine-state stay byte-identical.
- [test] Inside a daemon-managed session `dispatchCliEntry` refuses `ai-conductor done-when accept ...` with exit code 1 and bounded subcommand `done-when`, task-status and engine-state stay byte-identical, and `SESSION_SANCTIONED_SUBCOMMANDS` does not contain `done-when`.

**Files:** src/conductor/src/engine/done-when-accept-cli.ts; src/conductor/src/cli.ts; src/conductor/src/index.ts; src/conductor/src/execution/daemon-session.ts; src/conductor/test/engine/done-when-accept-cli.test.ts; src/conductor/test/execution/daemon-session-enforcement.test.ts

### Task 16: `done-when accept` records the override and settles the check
**Story:** Story 7
**Type:** happy-path
**Dependencies:** Tasks 11, 15

**Steps:**
1. Write failing tests through the CLI entry point. Cover:
   - accepting task 24's only refused check while it is reopened records `operator-accepted` with the
     reason, closes the citation obligation, and exits 0;
   - accepting a check demoted after two refusals records `operator-accepted` and removes it from
     `collectUnverifiedDoneWhenChecks`;
   - with checks 2 and 3 listed, accepting 3 keeps task 24 reopened for 2, and the obligation resolves
     only once 2 settles.
2. Verify RED.
3. Implement the handler's write through the judgement module's settlement function, so it shares
   `settleCitationRefusals` bookkeeping.
4. Verify GREEN and commit: "feat(done-when): record operator citation acceptance".

**Done when:**
- [test] Running `ai-conductor done-when accept --feature <slug> --task 24 --check 3 --reason <text>` on task 24's only refused, reopened check records source `operator-accepted` with that reason, closes task 24's `done-when-citation` obligation, and exits 0.
- [test] Accepting a check demoted to `unverified` after two refusals records `operator-accepted`, and the check no longer appears in `collectUnverifiedDoneWhenChecks` output.
- [test] With checks 2 and 3 listed in task 24's obligation, accepting check 3 records check 3 `operator-accepted` with the reason, leaves task 24 reopened for check 2, and the obligation closes only after check 2 is settled.

**Files:** src/conductor/src/engine/done-when-accept-cli.ts; src/conductor/src/engine/done-when-citation-judgement.ts; src/conductor/test/engine/done-when-accept-cli.test.ts

### Task 17: Citation judgement and acceptance events on the spine
**Story:** Story 8
**Type:** infrastructure
**Dependencies:** Tasks 14, 16

**Steps:**
1. Write failing tests. Cover:
   - a pass with one `asserts` and one refusal persists one `done_when_citation_judged` event listing
     each citation's task, check and verdict;
   - an all-unavailable pass persists one event listing each demoted check with the cause;
   - no pending citations emits no such event;
   - an accept persists one `done_when_citation_accepted` event naming the task, check and reason;
   - `EVENT_SINKS` has rows for both types.
2. Verify RED.
3. Implement:
   - add both members to the `ConductorEvent` union in `types/events.ts` and rows in
     `event-sinks.ts`, persisting with an audit sink;
   - emit from the conductor pass;
   - emit from the accept handler through `startOperatorEventSpine`.
4. Verify GREEN and commit: "feat(events): record Done-when citation judgements and acceptances".

**Done when:**
- [test] A judgement pass that judges task 7's check `asserts` and refuses task 24's check persists exactly one `done_when_citation_judged` line to `events.jsonl` listing each citation's task, check, and verdict.
- [test] A pass that demoted every pending check for unavailability persists one `done_when_citation_judged` event listing each demoted check with the unavailability cause in place of a verdict, and a BUILD session end with no pending citation emits none.
- [test] `ai-conductor done-when accept` on task 24 check 3 persists one `done_when_citation_accepted` event naming task 24, check 3, and the reason, and `EVENT_SINKS` has a row for both event types.

**Files:** src/conductor/src/types/events.ts; src/conductor/src/engine/event-sinks.ts; src/conductor/src/engine/conductor.ts; src/conductor/src/engine/done-when-accept-cli.ts; src/conductor/test/engine/event-sinks.test.ts; src/conductor/test/engine/conductor-done-when-citation.test.ts; src/conductor/test/engine/done-when-accept-cli.test.ts

### Task 18: The BUILD pipeline skill explains pending and refused citations
**Story:** Story 3
**Type:** infrastructure
**Dependencies:** Task 6

**Steps:**
1. Edit `skills/pipeline/SKILL.md` step 6 (DONE) and the remediation paragraph. State that:
   - a `[test]` check citing a test the task did not add closes `pending-judgement` and is judged when
     the BUILD session ends;
   - a refused citation returns as a retry hint naming the check and reason;
   - the answer is to write or cite a test that asserts the check, or close the check `--unverified`
     with a reason.
   Name no operator-only command outside an operator-only session-command region.
2. Run `test/test_harness_integrity.sh`'s session-command context audit target and the skill-text tests
   that cover `skills/pipeline/SKILL.md`.
3. Commit: "docs(pipeline): explain pending and refused Done-when citations".

**Done when:**
- `skills/pipeline/SKILL.md` step 6 states that a citation of a test the task did not add closes `pending-judgement`, is judged when the BUILD session ends, and that a refused citation is answered by writing or citing an asserting test or closing the check `--unverified` with a reason.
- The session-command context audit over `skills/pipeline/SKILL.md` passes and the file names `done-when accept` nowhere outside an operator-only region.

**Files:** skills/pipeline/SKILL.md

## Task Dependency Graph

```
1 ──► 3
1, 4, 5 ──► 6 ──► 18
4 ──► 7 ──► 8
6, 8 ──► 9 ──► 10 ──► 11 ──► 16 ──► 17
                9 ──► 14 ─────────────► 17
               10 ──► 12
               10 ──► 13
15 ──► 16
2 (independent)
```

## Integration Points

- After Task 6, `conduct task done` produces `verified` and `pending-judgement` records end to end through the CLI.
- After Task 10, a BUILD session end judges and reopens through the real conductor path.
- After Task 16, the operator lever works end to end through the CLI entry point and the daemon-session guard.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given task 4 is pending and HEAD is commit A, when `conduct task start 4` runs, then task 4's task-status row is `in_progress` and records commit A as its start commit. | 1 | "`runTaskStart` on a pending row at HEAD A writes status `in_progress` and `startHead` A, and every other field of the row is unchanged from before the start." | diff-local |
| Story 1 happy: Given task 4 already recorded commit A as its start commit and HEAD has since moved to commit B, when `conduct task start 4` runs again, then the row still records commit A as its start commit. | 1 | "A second `runTaskStart` after HEAD moved to B leaves `startHead` A, and a start whose `git rev-parse HEAD` fails writes `in_progress` with no `startHead` and returns exit code 0." | diff-local |
| Story 1 happy: Given a Claude Code BUILD session dispatches a subagent whose prompt starts with `Task: 4` while HEAD is commit A, when the session hook marks task 4 `in_progress`, then task 4's row records commit A as its start commit. | 2 | "Running the emitted pre-dispatch hook for a prompt whose first line is `Task: 4` in a repo at HEAD A sets task 4's row to `in_progress` with `startHead` A, and a re-run after HEAD moves keeps A." | diff-local |
| Story 1 negative: Given `conduct task start 4` runs where `git rev-parse HEAD` fails, when the start completes, then the row is `in_progress` with no start commit recorded and the command still exits 0. | 1 | "A second `runTaskStart` after HEAD moved to B leaves `startHead` A, and a start whose `git rev-parse HEAD` fails writes `in_progress` with no `startHead` and returns exit code 0." | diff-local |
| Story 1 negative: Given a task-status row written before this change with no start commit field, when that task is closed, then the close reads the missing field as no start commit and does not fail on it. | 1 | "`completeTaskDoneWhen` on a row with no `startHead` field closes without throwing and treats it as having no start commit." | diff-local |
| Story 1 negative: Given the session hook cannot read HEAD when it marks task 4 `in_progress`, when the hook completes, then the row is `in_progress` with no start commit recorded and the subagent dispatch is not blocked. | 2 | "Running the hook where `git rev-parse HEAD` fails leaves task 4 `in_progress` with no `startHead` and the hook exits 0 without blocking the dispatch." | diff-local |
| Story 1 negative: Given task 4's row records start commit A, when the task-status file is reseeded or task 4 is restaged by a repair reopen, then the row still records commit A. | 3 | "After a task-status reseed and after `restageExistingRemediationTaskStatuses` reopens task 4, task 4's row still has `startHead` A." | diff-local |
| Story 1 negative: Given task 4's row records start commit A and a file-changing rebase maps A to A', when rebase translation rewrites task-status SHAs, then the row records A'; when the rebase map has no entry for A, the row keeps A unchanged. | 3 | "`translateAfterRebase` with map entry A to A' rewrites task 4's `startHead` to A', and with no entry for A leaves `startHead` A and writes no rebase-residue entry for it." | diff-local |
| Story 2 happy: Given task 4 started at commit A and a commit after A adds a test whose title line contains the cited title to a file carrying `Covers: task:4`, when `conduct task done 4` cites that file and title for its `[test]` check, then the check's close record has source `verified` and no judgement is requested. | 6 | "`conduct task done 4` citing a test whose title was added after task 4's `startHead` records source `verified`, including when another task added it, and the run invokes no provider." | diff-local |
| Story 2 happy: Given the cited title is split across two added lines with different whitespace, when the check is closed, then the whitespace-normalized added lines are matched and the check's close record has source `verified`. | 5, 6 | "`classifyCitationProvenance` returns `task-added` when the normalized title appears in the cited file's added lines, including a title split across two added lines with different whitespace." | diff-local |
| Story 2 happy: Given a different task added the cited test in a commit after task 4's start commit, when task 4 closes its check citing that test, then the check's close record has source `verified`. | 6 | "`conduct task done 4` citing a test whose title was added after task 4's `startHead` records source `verified`, including when another task added it, and the run invokes no provider." | diff-local |
| Story 2 negative: Given the cited test passes every existing text check but its title line was committed before task 4's start commit, when task 4 closes the check citing it, then the check is not recorded as `verified`. | 6 | "`conduct task done 24` citing a test whose title predates `startHead`, or for a task with no `startHead`, or whose `startHead` is not an ancestor of HEAD, records task 24 `completed` and the check `pending-judgement`." | diff-local |
| Story 2 negative: Given the cited test predates the start commit and a later commit only adds an assertion inside its body, leaving its title line unchanged, when the check is closed, then the check is not recorded as `verified`. | 5, 6 | "`classifyCitationProvenance` returns `not-task-added` when the title appears only on context lines, when only body lines of an existing test were added, and when the title is added only in a different file than the cited path." | diff-local |
| Story 2 negative: Given a cited title appears on an added line only in a different file than the cited path, when the check is closed, then the check is not recorded as `verified`. | 5, 6 | "`classifyCitationProvenance` returns `not-task-added` when the title appears only on context lines, when only body lines of an existing test were added, and when the title is added only in a different file than the cited path." | diff-local |
| Story 2 negative: Given the cited reference fails an existing text check such as a missing title, when the check is closed, then the close is refused exactly as before this change and no close record is written. | 6 | "A task with one untagged and one `[test]` check citing a pre-existing test records `reported` and `pending-judgement` respectively, and a reference with a missing title is refused with no close record written." | diff-local |
| Story 3 happy: Given task 24's `[test]` check cites a test whose title line predates task 24's start commit and passes every existing text check, when `conduct task done 24` runs, then task 24 is `completed` and that check's close record has source `pending-judgement`. | 6 | "`conduct task done 24` citing a test whose title predates `startHead`, or for a task with no `startHead`, or whose `startHead` is not an ancestor of HEAD, records task 24 `completed` and the check `pending-judgement`." | diff-local |
| Story 3 happy: Given task 24 was closed without ever being started, so it has no start commit, when its `[test]` check cites any existing test that passes the text checks, then the check's close record has source `pending-judgement`. | 6 | "`conduct task done 24` citing a test whose title predates `startHead`, or for a task with no `startHead`, or whose `startHead` is not an ancestor of HEAD, records task 24 `completed` and the check `pending-judgement`." | diff-local |
| Story 3 negative: Given task 24's start commit is no longer an ancestor of HEAD after a rebase, when its `[test]` check cites a test added after that start commit, then the check's close record has source `pending-judgement`, not `verified`. | 6 | "`conduct task done 24` citing a test whose title predates `startHead`, or for a task with no `startHead`, or whose `startHead` is not an ancestor of HEAD, records task 24 `completed` and the check `pending-judgement`." | diff-local |
| Story 3 negative: Given task 24 has one untagged check and one `[test]` check citing a pre-existing test, when the task closes, then the untagged check is recorded `reported` exactly as before and only the tagged check is `pending-judgement`. | 6 | "A task with one untagged and one `[test]` check citing a pre-existing test records `reported` and `pending-judgement` respectively, and a reference with a missing title is refused with no close record written." | diff-local |
| Story 3 negative: Given a close record whose source is none of `verified`, `reported`, `verify-only`, `unverified`, `pending-judgement`, `judged`, or `operator-accepted`, when any engine reader of close records reads it, then the reader rejects it by name instead of treating it as one of the known sources. | 4, 7, 11 | "`collectUnverifiedDoneWhenChecks` over a status file holding a record with source `bogus` reports that record by its source name and does not count it as unverified or as any known source, and `completeTaskDoneWhen` re-closing a task whose prior record has source `bogus` refuses naming `bogus`." | diff-local |
| Story 4 happy: Given a BUILD session ends with two pending citations on tasks 7 and 9, when the conductor evaluates BUILD completion, then exactly one judgement dispatch is made covering both citations before the completion predicate runs. | 9 | "A BUILD session ending with pending citations on tasks 7 and 9 makes exactly one `dispatchDoneWhenCitationJudgement` call covering both, and the call happens before the BUILD completion predicate runs." | diff-local |
| Story 4 happy: Given the judgement returns asserts with a reason for task 7's check, when the verdict is applied, then the check's close record has source `judged` and carries that reason. | 9 | "An `asserts` verdict for task 7's check rewrites its close record to source `judged` carrying the verdict's reason, and BUILD then completes when nothing else is outstanding." | diff-local |
| Story 4 happy: Given a BUILD session ends with no pending citations, when the conductor evaluates BUILD completion, then no judgement is dispatched. | 9 | "A BUILD session ending with no pending citation makes no `dispatchDoneWhenCitationJudgement` call." | diff-local |
| Story 4 happy: Given the judgement input for a citation, when it is built, then it contains the check text, the task text, the cited path and title, and the cited file's content at HEAD bounded to a fixed size around the title. | 7 | "`buildCitationJudgementInput` for a pending citation contains its check text, task text, cited path and title, and the cited file's HEAD content limited to the fixed window around the title." | diff-local |
| Story 4 negative: Given the first judgement dispatch returns output that does not match the schema, when the conductor handles it, then it retries the dispatch once and no citation is recorded as refused. | 8 | "A schema-invalid first result is retried exactly once and a valid retry's verdicts are returned with no refusal recorded for the failed attempt." | diff-local |
| Story 4 negative: Given the judgement output omits a verdict for one of the pending citations, when the output is validated, then the whole output is treated as a failed dispatch and no verdict from it is applied. | 7 | "`validateCitationJudgementOutput` returns a failed-dispatch result and applies no verdict when any pending citation lacks a verdict, and ignores a verdict naming a task and check not in the pending set." | diff-local |
| Story 4 negative: Given the judgement returns a verdict for a task and check that was not in the pending set, when the verdict is applied, then that verdict is ignored and no close record changes for it. | 7, 9 | "When the judgement output also carries a verdict for a task and check outside the pending set, `applyCitationVerdicts` leaves that task's close records byte-identical." | diff-local |
| Story 5 happy: Given the judgement returns does-not-assert with a reason for task 24's check and a BUILD attempt remains, when the verdict is applied, then task 24 is reopened, BUILD completion is withheld, and the BUILD retry hint names task 24, the check, the cited reference, and the reason. | 10 | "A `does-not-assert` verdict for task 24 with a BUILD attempt left admits one obligation with authority `done-when-citation`, restages task 24 to pending, and withholds BUILD completion with a reason starting `Done-when citation refused:`." | diff-local |
| Story 5 happy: Given task 24 was reopened by a refused citation and BUILD then re-closes the check citing a test it added after the reopen, when the next BUILD session ends, then the check's close record has source `verified` and task 24 counts as resolved. | 12 | "Re-closing task 24's refused check with a test added after the reopen records `verified`, settles that check in the live `done-when-citation` obligation, and `resolveTaskIdsWithDiagnostics` then counts task 24 resolved." | diff-local |
| Story 5 happy: Given task 24 was reopened by a refused citation and BUILD re-closes the check citing another pre-existing test, when the next BUILD session ends, then the new citation is judged again. | 12 | "Re-closing it with another pre-existing test records `pending-judgement`, leaves the obligation open, and the next BUILD-boundary pass includes the new citation in its judgement call." | diff-local |
| Story 5 happy: Given checks 2 and 3 of task 24 are both refused in the same judgement pass, when the refusals are applied, then exactly one citation reopen is live for task 24 and it lists both checks. | 10 | "Two refused checks of task 24 in one pass produce exactly one live `done-when-citation` obligation listing both, and `resolveTaskIdsWithDiagnostics` does not count task 24 resolved from `Task: 24` commits made before the reopen." | diff-local |
| Story 5 negative: Given task 24 was reopened by a refused citation and has `Task: 24` commits from before the reopen, when BUILD completion resolves tasks, then task 24 is not counted as resolved by those commits. | 10 | "Two refused checks of task 24 in one pass produce exactly one live `done-when-citation` obligation listing both, and `resolveTaskIdsWithDiagnostics` does not count task 24 resolved from `Task: 24` commits made before the reopen." | diff-local |
| Story 5 negative: Given the same check of task 24 is refused a second time, when the verdict is applied, then the check is recorded `unverified` with the judge's reason, task 24 is not reopened again, and BUILD continues. | 11 | "A second `does-not-assert` for the same task, check index, and check-text digest records that check `unverified` with the judge's reason, admits no further obligation, and does not withhold BUILD completion for that check, and a changed check text is counted as a first refusal." | diff-local |
| Story 5 negative: Given a refusal arrives when BUILD has no attempt left in its retry budget, when the verdict is applied, then the check is recorded `unverified` with the judge's reason instead of reopening the task, and the BUILD step does not fail because of the refusal. | 11 | "A refusal arriving when the BUILD attempt is the last allowed records the check `unverified` with the judge's reason instead of reopening, and the BUILD step result is not a failure caused by the refusal." | diff-local |
| Story 5 negative: Given task 24 was reopened by a refused citation and the next BUILD session ends without re-closing the refused check, with or without a new `Task: 24` commit, when that session end is evaluated, then the refused check is recorded `unverified` with the judge's reason, task 24's citation reopen is resolved, and task 24 is not reopened again for it. | 11 | "A reopened check not re-closed when the next BUILD session ends is recorded `unverified` with the judge's reason whether or not a new `Task: 24` commit exists, and task 24's citation obligation is closed so task 24 is not reopened for it again." | diff-local |
| Story 5 negative: Given a refused citation withheld BUILD completion, when the no-progress breaker and the daemon stall check evaluate that attempt and the next one, then the withheld attempt does not increment `noEvidenceAttempts` and neither check reports a stall or halts the feature because of the reopen. | 13 | "For a withhold at any BUILD attempt, including attempt one followed by attempt two, the attempt withheld with a reason starting `Done-when citation refused:` and its following attempt are not classified `no_task_progress` or `active_stall`, emit no `build_stall` event, do not increment `noEvidenceAttempts`, and write no HALT marker." | diff-local |
| Story 5 negative: Given the engine process restarts after a refusal reopened task 24 but before BUILD re-entered, when the run resumes, then task 24 is still reopened, the refusal count is unchanged, and the refusal is not admitted twice. | 10 | "Replaying the refusal application after a simulated engine restart admits no second obligation, leaves task 24 reopened, and leaves each check's refusal count unchanged." | diff-local |
| Story 5 negative: Given a refusal on task 24's check and the plan text of that check is later changed, when the changed check is refused, then it is counted as a first refusal of the new check text. | 11 | "A second `does-not-assert` for the same task, check index, and check-text digest records that check `unverified` with the judge's reason, admits no further obligation, and does not withhold BUILD completion for that check, and a changed check text is counted as a first refusal." | diff-local |
| Story 5 negative: Given task 24's citation reopen lists a check whose text no longer appears in the current plan task, when the engine next evaluates that reopen, then the stale check's refusal is dropped and the reopen resolves once no listed check is still open. | 11 | "A listed check whose text no longer appears in the current plan task is dropped and the obligation closes once no listed check is open, and every demoted check appears in `collectUnverifiedDoneWhenChecks` output carrying the judge's reason." | diff-local |
| Story 6 happy: Given pending citations exist and no candidate provider declares native output schema support, when BUILD completion is evaluated, then every pending check is recorded `unverified` with a reason beginning `citation judgement unavailable:` and BUILD proceeds. | 8, 14 | "When `dispatchDoneWhenCitationJudgement` returns `unavailable`, every pending check is recorded `unverified` with a reason starting `citation judgement unavailable:` naming the cause, no obligation is admitted, and no HALT marker is written." | diff-local |
| Story 6 negative: Given the judgement dispatch fails twice with a provider error, when BUILD completion is evaluated, then every pending check is recorded `unverified` with a reason beginning `citation judgement unavailable:` naming the failure, and no task is reopened. | 8, 14 | "When `dispatchDoneWhenCitationJudgement` returns `unavailable`, every pending check is recorded `unverified` with a reason starting `citation judgement unavailable:` naming the cause, no obligation is admitted, and no HALT marker is written." | diff-local |
| Story 6 negative: Given the first dispatch fails and the retry succeeds, when the verdicts are applied, then no check is demoted because of the first failure. | 14 | "A dispatch whose first attempt fails and whose retry succeeds demotes no check." | diff-local |
| Story 6 negative: Given every pending check was demoted because the judgement was unavailable, when BUILD completion runs, then the existing one-nudge unverified handling applies to those checks unchanged. | 14 | "Those demoted checks then receive the existing one BUILD nudge and the `build_done_when_unverified` event exactly as other unverified checks do, and the BUILD step completes." | diff-local |
| Story 7 happy: Given task 24's check 3 was refused by the judgement as task 24's only refused check and task 24 is reopened, when the operator runs `ai-conductor done-when accept --feature <slug> --task 24 --check 3 --reason "covers the moved-state crash path"`, then check 3's close record has source `operator-accepted` with that reason, task 24's citation reopen is resolved, and the command exits 0. | 16 | "Running `ai-conductor done-when accept --feature <slug> --task 24 --check 3 --reason <text>` on task 24's only refused, reopened check records source `operator-accepted` with that reason, closes task 24's `done-when-citation` obligation, and exits 0." | diff-local |
| Story 7 happy: Given task 24's check 3 was demoted to `unverified` after two refusals, when the operator accepts it with a reason, then check 3's close record has source `operator-accepted` and it no longer appears among unverified close records. | 16 | "Accepting a check demoted to `unverified` after two refusals records `operator-accepted`, and the check no longer appears in `collectUnverifiedDoneWhenChecks` output." | diff-local |
| Story 7 happy: Given task 24's citation reopen lists checks 2 and 3, when the operator accepts check 3 only, then check 3 is `operator-accepted`, task 24 stays reopened for check 2, and the reopen resolves only once check 2 is settled. | 16 | "With checks 2 and 3 listed in task 24's obligation, accepting check 3 records check 3 `operator-accepted` with the reason, leaves task 24 reopened for check 2, and the obligation closes only after check 2 is settled." | diff-local |
| Story 7 negative: Given the command runs inside a daemon-managed session, when `ai-conductor done-when accept` is invoked, then the daemon-session guard refuses it, exits 1, and no close record changes. | 15 | "Inside a daemon-managed session `dispatchCliEntry` refuses `ai-conductor done-when accept ...` with exit code 1 and bounded subcommand `done-when`, task-status and engine-state stay byte-identical, and `SESSION_SANCTIONED_SUBCOMMANDS` does not contain `done-when`." | diff-local |
| Story 7 negative: Given task 24's check 3 has no recorded refusal, when the operator runs the accept command for it, then the command exits 1 naming that the check has no refused citation and nothing changes. | 15 | "The handler exits 1 naming the missing reason for an empty or whitespace reason, naming the unknown value for an unknown feature, task id, or check number, and naming that the check has no refused citation, and in each case task-status and engine-state stay byte-identical." | diff-local |
| Story 7 negative: Given the reason is empty or whitespace, when the accept command runs, then it exits 1 naming the missing reason and nothing changes. | 15 | "The handler exits 1 naming the missing reason for an empty or whitespace reason, naming the unknown value for an unknown feature, task id, or check number, and naming that the check has no refused citation, and in each case task-status and engine-state stay byte-identical." | diff-local |
| Story 7 negative: Given an unknown feature slug, task id, or check number, when the accept command runs, then it exits 1 naming the unknown value and nothing changes. | 15 | "The handler exits 1 naming the missing reason for an empty or whitespace reason, naming the unknown value for an unknown feature, task id, or check number, and naming that the check has no refused citation, and in each case task-status and engine-state stay byte-identical." | diff-local |
| Story 7 negative: Given an extra or missing flag, when the accept command runs, then it is not recognized as an accept command and nothing changes. | 15 | "`detectDoneWhenAcceptCommand` recognizes only `done-when accept --feature <slug> --task <id> --check <n> --reason <text>` and returns null for an extra flag, a missing flag, or an invalid slug, so no handler runs and task-status and engine-state stay byte-identical." | diff-local |
| Story 8 happy: Given a judgement pass judged task 7's check as asserts and refused task 24's check, when the pass completes, then one event is persisted to `events.jsonl` listing each citation's task, check, and verdict. | 17 | "A judgement pass that judges task 7's check `asserts` and refuses task 24's check persists exactly one `done_when_citation_judged` line to `events.jsonl` listing each citation's task, check, and verdict." | diff-local |
| Story 8 happy: Given the operator accepts task 24's check 3, when the command completes, then one event is persisted naming the task, the check, and the reason. | 17 | "`ai-conductor done-when accept` on task 24 check 3 persists one `done_when_citation_accepted` event naming task 24, check 3, and the reason, and `EVENT_SINKS` has a row for both event types." | diff-local |
| Story 8 negative: Given a judgement pass demoted every pending check because the judgement was unavailable, when the pass completes, then the persisted event lists each demoted check with the unavailability cause instead of a verdict. | 17 | "A pass that demoted every pending check for unavailability persists one `done_when_citation_judged` event listing each demoted check with the unavailability cause in place of a verdict, and a BUILD session end with no pending citation emits none." | diff-local |
| Story 8 negative: Given no pending citations at the end of a BUILD session, when BUILD completion is evaluated, then no citation-judgement event is emitted. | 17 | "A pass that demoted every pending check for unavailability persists one `done_when_citation_judged` event listing each demoted check with the unavailability cause in place of a verdict, and a BUILD session end with no pending citation emits none." | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-08-22-done-when-evidence-at-task-close#D1 | existing | none | `completeTaskDoneWhen` (`task-progress.ts`) already writes one engine-owned close record per enumerated check before setting the row `completed`; this feature adds sources to that record, not a new writer. |
| adr-2026-08-22-done-when-evidence-at-task-close#D2 | existing | none | Tasks without a `Done when:` block return `{kind: legacy}` from `parsePlanTaskDoneWhen` and close on the prior rule; no task changes that branch. |
| adr-2026-08-22-done-when-evidence-at-task-close#D3 | existing | none | `conduct task done --plan-gap` writes the classified plan-gap HALT (`task-cli.ts`) and remains refused for `[test]` checks; unchanged here. |
| adr-2026-08-22-done-when-evidence-at-task-close#D4 | no-change | none | No task adds a blocking trailer floor; provenance uses the engine-recorded start commit and never a `Task:` trailer. |
| adr-2026-08-22-done-when-evidence-at-task-close#D5 | existing | none | The `[test]` tag is parsed by `parsePlanTaskDoneWhen` and validated at land by `plan-done-when`; this feature reads the tag only. |
| adr-2026-08-22-done-when-evidence-at-task-close#D6 | task | task-6 | "A task with one untagged and one `[test]` check citing a pre-existing test records `reported` and `pending-judgement` respectively, and a reference with a missing title is refused with no close record written." |
| adr-2026-08-22-done-when-evidence-at-task-close#D7 | existing | none | A refused tagged check still prints the `write or cite the test, or use --unverified` refusal and never routes to plan-gap (`task-progress.ts`, `task-cli.ts`); no task changes that path. |
| adr-2026-08-22-done-when-evidence-at-task-close#D8 | task | task-14 | "Those demoted checks then receive the existing one BUILD nudge and the `build_done_when_unverified` event exactly as other unverified checks do, and the BUILD step completes." |
| adr-2026-08-22-done-when-evidence-at-task-close#D9 | existing | none | `buildRemediationDoneWhenChecks` (`remediation-append.ts`) already tags criterion-bound `prd_audit` remediation checks `[test]`; unchanged. |
| adr-2026-08-22-done-when-evidence-at-task-close#D10 | task | task-1, task-2, task-3 | "`runTaskStart` on a pending row at HEAD A writes status `in_progress` and `startHead` A, and every other field of the row is unchanged from before the start." |
| adr-2026-08-22-done-when-evidence-at-task-close#D11 | task | task-5, task-6 | "`conduct task done 4` citing a test whose title was added after task 4's `startHead` records source `verified`, including when another task added it, and the run invokes no provider." |
| adr-2026-08-22-done-when-evidence-at-task-close#D12 | task | task-6 | "`conduct task done 24` citing a test whose title predates `startHead`, or for a task with no `startHead`, or whose `startHead` is not an ancestor of HEAD, records task 24 `completed` and the check `pending-judgement`." |
| adr-2026-08-22-done-when-evidence-at-task-close#D13 | task | task-7, task-8, task-9 | "A BUILD session ending with pending citations on tasks 7 and 9 makes exactly one `dispatchDoneWhenCitationJudgement` call covering both, and the call happens before the BUILD completion predicate runs." |
| adr-2026-08-22-done-when-evidence-at-task-close#D14 | task | task-10, task-11, task-12, task-13 | "A `does-not-assert` verdict for task 24 with a BUILD attempt left admits one obligation with authority `done-when-citation`, restages task 24 to pending, and withholds BUILD completion with a reason starting `Done-when citation refused:`." |
| adr-2026-08-22-done-when-evidence-at-task-close#D15 | task | task-14 | "When `dispatchDoneWhenCitationJudgement` returns `unavailable`, every pending check is recorded `unverified` with a reason starting `citation judgement unavailable:` naming the cause, no obligation is admitted, and no HALT marker is written." |
| adr-2026-08-22-done-when-evidence-at-task-close#D16 | task | task-15, task-16 | "Running `ai-conductor done-when accept --feature <slug> --task 24 --check 3 --reason <text>` on task 24's only refused, reopened check records source `operator-accepted` with that reason, closes task 24's `done-when-citation` obligation, and exits 0." |
| adr-2026-08-22-done-when-evidence-at-task-close#D17 | task | task-4 | "`parseDoneWhenCloseSource` returns each of `verified`, `reported`, `verify-only`, `unverified`, `pending-judgement`, `judged`, and `operator-accepted` unchanged and returns an error naming the value for any other string." |
| adr-2026-08-22-done-when-evidence-at-task-close#D18 | task | task-17 | "A judgement pass that judges task 7's check `asserts` and refuses task 24's check persists exactly one `done_when_citation_judged` line to `events.jsonl` listing each citation's task, check, and verdict." |
| adr-2026-09-06-reopened-task-resolution#D1 | existing | none | Repair obligations already live in the versioned repair section of `engine-state.json` (`repair-obligations.ts` `createRepairObligationStore`); the citation source reuses it. |
| adr-2026-09-06-reopened-task-resolution#D2 | existing | none | `admit` is already idempotent by admission key and replays without minting a second obligation (`repair-obligations.ts`); task 10 relies on it unchanged. |
| adr-2026-09-06-reopened-task-resolution#D3 | existing | none | All engine-state writers already go through the serialized `EngineStateStore.update` seam; refusal counts are written through it. |
| adr-2026-09-06-reopened-task-resolution#D4 | task | task-10 | "Two refused checks of task 24 in one pass produce exactly one live `done-when-citation` obligation listing both, and `resolveTaskIdsWithDiagnostics` does not count task 24 resolved from `Task: 24` commits made before the reopen." |
| adr-2026-09-06-reopened-task-resolution#D5 | existing | none | `listCommitsWithTrailersAfterRepairBoundary` already refuses to widen past an unavailable boundary; unchanged. |
| adr-2026-09-06-reopened-task-resolution#D6 | existing | none | The resolver, task seeding and task close already share the obligation reader (`taskObligationStanding`); unchanged. |
| adr-2026-09-06-reopened-task-resolution#D7 | no-change | none | Scope acceptance of OVER_SCOPE findings is untouched; a citation refusal is never an OVER_SCOPE finding. |
| adr-2026-09-06-reopened-task-resolution#D8 | existing | none | No-progress escalation and lap bounds for gate repairs are unchanged; the citation source defines its own governing review in decision 13. |
| adr-2026-09-06-reopened-task-resolution#D9 | no-change | none | Remediation eligibility, gate ownership, budgets and plan-growth accounting are untouched; a citation obligation charges no lap or allowance. |
| adr-2026-09-06-reopened-task-resolution#D10 | no-change | none | Retired by #3164; `coverage_binding` admits nothing and this feature does not revive it. |
| adr-2026-09-06-reopened-task-resolution#D11 | existing | none | Plan-text digests already admit `plan_amendment` obligations at seeding; task 11 drops a stale citation check instead of competing with it. |
| adr-2026-09-06-reopened-task-resolution#D12 | existing | none | Per-row trailer restore of rowless tasks is unchanged; a reopened task keeps its row, so it is never restored from a trailer. |
| adr-2026-09-06-reopened-task-resolution#D13 | task | task-10, task-11, task-12 | "Two refused checks of task 24 in one pass produce exactly one live `done-when-citation` obligation listing both, and `resolveTaskIdsWithDiagnostics` does not count task 24 resolved from `Task: 24` commits made before the reopen." |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic
- [ ] Tasks do not invalidate each other's fixtures or assertions

### Task rem-prd-audit-9: In conductor.ts session-end citation block, tolerate a missing .pipeline/task-status.json and an unresolved planPath (skip settlement/dispatch when no close records or no plan) as the final-attempt block does since 68f867293c; add tests in conductor-done-when-citation.test.ts that BUILD with no task-status file and with no resolved plan makes no dispatchDoneWhenCitationJudgement call and does not fail
**Gate:** prd-audit
**Rationale:** Implementation defect within approved Task 9: the session-end judgement block in conductor.ts reads .pipeline/task-status.json unguarded and calls settleCitationRefusals with planPath '' before the pending check, so a BUILD with no pending citation (missing task-status or unresolved plan) throws 'citation judgement unavailable' instead of skipping. Architecture is unambiguous (no pending citation => no dispatch, no failure); fix in code plus a regression test. Task 9's existing no-pending test and 68f867293c's empty-plan auto-park behavior must survive.
**Criterion:** S4.3
**Parent task:** 9
**Done when:**
- [test] S4.3 is satisfied by this task.
- The repair for task rem-prd-audit-9 is committed and its targeted tests pass.

### Task rem-prd-audit-14: Remove the immediate build_done_when_unverified emission from the unavailable-judgement branch in conductor.ts so demoted checks get the event only via the existing nudge-spent completion path; extend conductor-done-when-citation.test.ts with a multi-attempt run asserting exactly one event per demoted check and that the one BUILD nudge still occurs
**Gate:** prd-audit
**Rationale:** Task 14 requires demoted checks to receive the build_done_when_unverified event exactly as other unverified checks. The unavailable branch emits the event immediately and the existing nudge-spent completion path emits it again, double-emitting across attempts. Remove the early emission so demoted checks flow solely through the existing path; strengthen the test to multi-attempt (maxRetries>1) asserting exactly one event.
**Criterion:** S6.4
**Parent task:** 14
**Done when:**
- [test] S6.4 is satisfied by this task.
- The repair for task rem-prd-audit-14 is committed and its targeted tests pass.

### Task rem-as-built-15: In done-when-accept-cli.ts parse every close record's source against the closed seven-value set before acceptance; exit 1 naming the unknown source (for the target check and any other listed check of the obligation) with task-status and engine-state byte-identical; add tests in done-when-accept-cli.test.ts
**Gate:** as-built
**Rationale:** Conforming implementation drift against ADR done-when-evidence D17 (closed source set, unknown sources rejected by name). Admitted by Task 15 (handler refusals name the offending value, byte-identical state) and Task 16 (settlement through shared bookkeeping). No architectural decision needed.
**Governing clause:** adr-2026-08-22-done-when-evidence-at-task-close decision 17
**Done when:**
- adr-2026-08-22-done-when-evidence-at-task-close decision 17 is satisfied by this task.
- The repair for task rem-as-built-15 is committed and its targeted tests pass.

### Task rem-as-built-16: In done-when-accept-cli.ts treat listed checks with source pending-judgement as outstanding so accepting one refused check never closes the citation obligation while another listed check awaits judgement; add a done-when-accept-cli.test.ts case with check 2 pending-judgement and check 3 accepted asserting the obligation stays open
**Gate:** as-built
**Rationale:** Violates reopened-task-resolution D13: a listed check in pending-judgement is still open. Task 16 explicitly requires the obligation to close only after every other listed check settles. Code fix plus test within Task 16.
**Governing clause:** adr-2026-09-06-reopened-task-resolution decision 13
**Done when:**
- adr-2026-09-06-reopened-task-resolution decision 13 is satisfied by this task.
- The repair for task rem-as-built-16 is committed and its targeted tests pass.

### Task rem-as-built-10: Make refusal application in done-when-citation-judgement.ts and conductor.ts crash-recoverable: on session end also collect judged refusals whose admission/count/restage/supersession is unfinished (not only pending records), and replay each effect idempotently (admission keyed, count recorded once per refusal identity, restage and supersede re-applied safely); add tests simulating a crash after each write boundary asserting one live obligation, task reopened and unchanged counts
**Gate:** as-built
**Rationale:** Violates reopened-task-resolution D2 (recoverable, idempotent replay). Task 10 step 1/done-when already requires replay after simulated restart to admit nothing new, keep task reopened and keep counts; the as-built shows the crash windows between judged-record persistence, admission, counting, restaging and supersession are unrecovered. Approved architecture is authoritative; this is implementation work.
**Governing clause:** adr-2026-09-06-reopened-task-resolution decision 2
**Done when:**
- adr-2026-09-06-reopened-task-resolution decision 2 is satisfied by this task.
- The repair for task rem-as-built-10 is committed and its targeted tests pass.
