# Implementation Plan: Test-tagged Done-when checks are verified at task close

**Date:** 2026-10-02
**Stories:** .docs/stories/tasks-close-with-boilerplate-done-when-evidence-mi.md
**Conflict check:** Clean as of 2026-10-02

## Summary

Thirteen tasks make a `[test]`-tagged Done-when check close only on a verified test reference or an explicit unverified close, give unverified checks one BUILD nudge, record them on the event spine and in `prd_audit` input, and tag criterion-bound remediation tasks (#2758).

## Technical Approach

- Governing decision: `adr-2026-08-22-done-when-evidence-at-task-close` D5-D9 (approved amendment); review: `.docs/decisions/architecture-review-2026-10-02-tasks-close-with-boilerplate-done-when-evidence-mi.md`.
- The tag is the exact literal `[test]` at the start of a Done-when check and stays in the parsed check text, so coherence and architecture-obligation substring matching keep working. Land validates only its shape (`plan-done-when.ts`); nothing classifies untagged checks.
- Verification is text-only so every consumer project gets it: a new `done-when-test-reference.ts` parses `test:<path>::<title>`, reads the file at HEAD through the existing batched reader `readGitBlobs` (`git-blob-batch.ts`), compares whitespace-normalized text, and accepts `Covers:` tokens through the existing `parseCoversMarkers` grammar for `task:<id>` or a criterion of a story the task cites (`parsePlanTaskStoryIds` plus `extractStoryCriterionIds`). Do not reuse `build-review-test-bindings.ts`; it imports the TypeScript compiler.
- `completeTaskDoneWhen` (`task-progress.ts`) is the single close seam; the evidence value already passes the `--done-when <n>=<evidence>` grammar in `task-cli.ts`. `--reason` belongs to `--plan-gap`, so the unverified form is a separate `--unverified <n>=<reason>` flag. The close-record `source` becomes the closed set `verified`, `reported`, `verify-only`, `unverified`.
- Only explicit `unverified` close records count as unverified (`collectUnverifiedDoneWhenChecks`), so stamp-resolved and legacy tasks keep their existing paths.
- The BUILD nudge is a new outcome of `CUSTOM_COMPLETION_PREDICATES.build` (`artifacts.ts`) evaluated after the existing pending-task reason, carried by `buildRetryHint` (`conductor.ts`), persisted through `createEngineStateStore`, and excluded from the progress watcher no-evidence count. It draws on the ordinary per-step retry budget; no halt class is added.
- Event spine: the conductor emits one `build_done_when_unverified` `ConductorEvent` in-process at BUILD completion, with an `EVENT_SINKS` row; the `task done` CLI is a separate process and emits nothing.
- Sequencing: Tasks 1-7 are independent of in-flight work. Task 8-10 change the completion predicate also changed by `build-step-completes-with-every-plan-task-still-pe` (#2014); Task 11 extends `prd-audit-projection.ts` created by `prd-audit-receives-bounded-inputs-and-returns-vali` (#2521). Both must ship before this spec is merged.

## Prerequisites

- `build-step-completes-with-every-plan-task-still-pe` (#2014) and `prd-audit-receives-bounded-inputs-and-returns-vali` (#2521) have shipped to main before this spec is merged.

## Tasks

### Task 1: Parse and land-validate the `[test]` Done-when tag
**Story:** 1
**Type:** happy-path
**Dependencies:** none

**Steps:**
1. Write failing tests: a plan mixing a `[test]` check and an untagged check lands and the parsed check keeps `[test]` verbatim; `[tests]` and `[Test]` checks are refused naming task and check; a bare `[test]` check is a blank violation; a waiver file does not change the refusal; a coherence quote of an untagged fragment of a tagged check still matches.
2. Verify they fail (RED).
3. Implement: export the literal tag and an `isMalformedTestTag` predicate from `plan-task-parse.ts` (a leading bracketed token that case-insensitively starts with `test` but is not exactly `[test]`); extend `validatePlanDoneWhen` with a `malformed-test-tag` reason that carries the check text, and treat a check equal to `[test]` after trimming as `blank`; render the new reason in land-spec. Leave parsed check text unchanged.
4. Verify they pass (GREEN).
5. Commit: "feat(plan): validate the [test] Done-when tag at land"

**Done when:**
- `parsePlanTaskDoneWhen` returns a `[test]` check byte-for-byte as authored and `validatePlanDoneWhen` reports no violation for a plan mixing a `[test]` check and an untagged check, as asserted by the tagged-plan land test.
- `validatePlanDoneWhen` reports a `malformed-test-tag` violation naming the task id and the check text for `[tests]` and `[Test]` checks, and land refuses the spec printing both, as asserted by the malformed-tag land test.
- A check that is only `[test]` is reported as a `blank` violation naming the task id and land refuses it, as asserted by the empty-tagged-check test.
- Any waiver file present for the plan, coherence or release waiver alike, leaves the malformed-tag land refusal unchanged, as asserted by the no-waiver land test.
- The coherence validator finds a quote of an untagged fragment of a `[test]` check in the cited task Done-when checks, as asserted by the tagged-quote coherence test.

**Files:** `src/conductor/src/engine/plan-task-parse.ts`, `src/conductor/src/engine/plan-done-when.ts`, `src/conductor/src/engine/engineer/land-spec.ts`, `src/conductor/test/engine/plan-done-when.test.ts`, `src/conductor/test/engine/engineer/land-spec.test.ts`, `src/conductor/test/engine/engineer/coherence-validator.test.ts`

### Task 2: Verify a test reference by text against a HEAD blob
**Story:** 2
**Type:** happy-path
**Dependencies:** none

**Steps:**
1. Write failing tests for `verifyDoneWhenTestReference` over in-memory blob text: task marker, criterion marker resolved from the task `Story:` lines, each refusal part, and a Elixir `.exs` fixture beside a TypeScript fixture.
2. Verify they fail (RED).
3. Implement: parse `test:<path>::<title>`; normalize whitespace in title and blob; accept `Covers:` tokens via `parseCoversMarkers` that name `task:<id>` or a criterion id from `extractStoryCriterionIds` of a story cited by the task (`parsePlanTaskStoryIds`); return `verified` or a refusal with part `not-a-test-reference`, `missing-file`, `missing-title` or `missing-covers-marker`. Pure text: import nothing that parses source code.
4. Verify they pass (GREEN).
5. Commit: "feat(task-close): verify Done-when test references by text"

**Done when:**
- `verifyDoneWhenTestReference` returns `verified` for a `test:<path>::<title>` reference whose blob contains the whitespace-normalized title and a `Covers: task:<id>` marker for the closing task, as asserted by the task-marker test.
- `verifyDoneWhenTestReference` returns `verified` when the blob only marker is `Covers: S2.1` and the closing task cites Story 2, as asserted by the criterion-marker test.
- `verifyDoneWhenTestReference` returns refusal parts `not-a-test-reference`, `missing-file`, `missing-title` and `missing-covers-marker` for free text, an absent blob, a blob without the title, and a blob whose markers name neither the task nor its criteria, as asserted by the four refusal tests.
- An Elixir `.exs` test file, a language this repository does not use, and a TypeScript test file with the same title and marker both return `verified`, and `done-when-test-reference.ts` imports neither `typescript` nor `build-review-test-bindings`, as asserted by the language-agnostic test.

**Files:** `src/conductor/src/engine/done-when-test-reference.ts`, `src/conductor/test/engine/done-when-test-reference.test.ts`

### Task 3: Close tagged checks through verified references in `conduct task done`
**Story:** 2
**Type:** happy-path
**Dependencies:** Tasks 1, 2

**Steps:**
1. Write failing CLI-level tests against a temporary git repository: verified closes by task marker, by criterion marker, by a file committed before the branch, and from a subdirectory; refusals for free text, an absent path, a missing title, a missing marker, and an uncommitted file.
2. Verify they fail (RED).
3. Implement in `completeTaskDoneWhen`: for each `[test]` check, resolve the repository top level with `git rev-parse --show-toplevel`, read the cited path at HEAD with `readGitBlobs`, call `verifyDoneWhenTestReference`, and stamp the record `source: verified`; on refusal return a refused result naming the check number, check text and failed part with its path, title or marker. Widen `DoneWhenEvidenceRecord.source` to the closed set `verified | reported | verify-only | unverified`.
4. Verify they pass (GREEN).
5. Commit: "feat(task-close): require verified test references for tagged checks"

**Done when:**
- `conduct task done 3` citing a committed test that carries the title and `Covers: task:3` completes task 3 and writes the check close record with source `verified` to task-status.json, as asserted by the CLI verified-close test.
- `conduct task done` citing a `Covers: S2.1` test for a task whose Story line cites Story 2, or a test committed before the feature branch and absent from the feature diff, writes source `verified`, as asserted by the criterion-marker and pre-branch CLI tests.
- `conduct task done` run from a worktree subdirectory resolves a repository-root-relative test path through `git rev-parse --show-toplevel` and writes source `verified`, as asserted by the subdirectory CLI test.
- `conduct task done` with free-text evidence, or citing a path present only uncommitted in the working tree, exits non-zero naming the check number and check text, names that path as absent at HEAD in the uncommitted case, and leaves the task row not completed, as asserted by the free-text and uncommitted-file CLI tests.
- `conduct task done` refusals for an absent file, a missing title and a missing marker each print the check and name the missing path, the missing title, or the missing `Covers:` marker respectively, as asserted by the three CLI refusal-message tests.

**Files:** `src/conductor/src/engine/task-progress.ts`, `src/conductor/src/engine/task-cli.ts`, `src/conductor/test/engine/task-progress.test.ts`, `src/conductor/test/engine/task-cli.test.ts`

### Task 4: Keep untagged checks and tag-free plans closing as before
**Story:** 3
**Type:** negative-path
**Dependencies:** Task 3

**Steps:**
1. Write tests: an untagged check with free text closes as `reported`; a mixed task records `verified` and `reported`; a tag-free plan fixture closes every task with the free text accepted before this change.
2. Verify they fail where the source stamp is not yet asserted (RED), or pass immediately if Task 3 already holds them; adjust only `completeTaskDoneWhen` if a close is refused.
3. Verify they pass (GREEN).
4. Commit: "test(task-close): untagged checks keep reported evidence"

**Done when:**
- `conduct task done` closing an untagged check with free-text evidence completes the task and records source `reported`, as asserted by the untagged-close test.
- A task with one tagged and one untagged check closes with sources `verified` and `reported` respectively, as asserted by the mixed-task test.
- Closing every task of a tag-free plan fixture with the free-text evidence accepted before this change refuses no close, as asserted by the tag-free plan regression test.

**Files:** `src/conductor/test/engine/task-progress.test.ts`

### Task 5: Close a tagged check as unverified with a per-check reason
**Story:** 4
**Type:** happy-path
**Dependencies:** Task 3

**Steps:**
1. Write failing tests for `--unverified <n>=<reason>`: completes the task with source `unverified` and the reason; an empty reason is refused; refusal text never mentions `--plan-gap`; usage text lists the flag; no HALT file is written.
2. Verify they fail (RED).
3. Implement: parse `--unverified <n>=<reason>` beside `--done-when` in `task-cli.ts` (rejecting an empty reason and an index that is not a tagged check); record the check with `source: unverified` and `reason`; reword tagged-check refusals to say write or cite the test or use `--unverified`.
4. Verify they pass (GREEN).
5. Commit: "feat(task-close): unverified close for tagged checks"

**Done when:**
- `conduct task done 5 --unverified 2=<reason>` with evidence for the other checks completes task 5 and records check 2 with source `unverified` and that reason, as asserted by the unverified-close test.
- `conduct task done` with `--unverified 2=` and an empty reason exits non-zero naming check 2 and leaves the task not completed, as asserted by the empty-reason test.
- Every tagged-check refusal message tells the agent to write or cite the test or use `--unverified`, and contains no `--plan-gap` text, as asserted by the refusal-wording test.
- The `conduct task done` usage text lists `--unverified <n>=<reason>`, and no unverified-close test writes a `.pipeline/HALT` file, as asserted by the usage and no-halt tests.

**Files:** `src/conductor/src/engine/task-cli.ts`, `src/conductor/src/engine/task-progress.ts`, `src/conductor/test/engine/task-cli.test.ts`, `src/conductor/test/engine/task-progress.test.ts`

### Task 6: Apply tagged-check rules on verify-only tasks
**Story:** 4
**Type:** negative-path
**Dependencies:** Task 5

**Steps:**
1. Write failing tests on a `Verify-only: yes` task with one tagged and one untagged check: unverified close completes; no evidence for the tagged check is refused; a verified tagged check lets the untagged check close by the prove-closed path.
2. Verify they fail (RED).
3. Implement in `completeTaskDoneWhen`: under `verifyOnly`, still require a verified reference or an unverified close for `[test]` checks, and stamp untagged checks `verify-only` as today.
4. Verify they pass (GREEN).
5. Commit: "feat(task-close): tagged checks need evidence on verify-only tasks"

**Done when:**
- On a `Verify-only: yes` task, `conduct task done --unverified 1=<reason>` for its tagged check completes the task and records that check with source `unverified`, as asserted by the verify-only unverified test.
- On a `Verify-only: yes` task, `conduct task done` with no evidence for its tagged check exits non-zero naming the check and leaves the task not completed, as asserted by the verify-only refusal test.
- On a `Verify-only: yes` task whose tagged check is closed with a verified reference, its untagged check is recorded with source `verify-only` without supplied evidence, as asserted by the verify-only prove-closed test.

**Files:** `src/conductor/src/engine/task-progress.ts`, `src/conductor/test/engine/task-progress.test.ts`

### Task 7: Collect unverified checks from task status
**Story:** 3
**Story:** 5
**Type:** happy-path
**Dependencies:** Task 5

**Steps:**
1. Write failing tests for `collectUnverifiedDoneWhenChecks` over task-status fixtures: explicit unverified records, a stamp-resolved tagged task with no close record, and records written before this change.
2. Verify they fail (RED).
3. Implement: return `{taskId, check, reason}` for each close record with source `unverified` only; ignore rows without close records and records with any other or absent source; never throw on legacy rows.
4. Verify they pass (GREEN).
5. Commit: "feat(task-close): collect unverified Done-when checks"

**Done when:**
- `collectUnverifiedDoneWhenChecks` returns only close records with source `unverified`, each with task id, check text and reason, as asserted by the collector test.
- A completed task with a `[test]` check but no close record for it, as left by a no-diff skipped stamp or a verify-only stamp, contributes nothing, as asserted by the stamp-resolved test.
- Close records written before this change, with source `reported` or no source field, contribute nothing and raise no error, as asserted by the legacy-records test.

**Files:** `src/conductor/src/engine/done-when-test-reference.ts`, `src/conductor/test/engine/done-when-test-reference.test.ts`

### Task 8: Withhold BUILD completion once for unverified checks
**Story:** 5
**Story:** 3
**Type:** happy-path
**Dependencies:** Task 7

**Steps:**
1. Write failing predicate tests: resolved tasks plus unverified checks with no nudge recorded; the same state after the nudge is recorded; resolved tasks with no unverified record, including stamp-resolved and legacy fixtures; pending tasks plus unverified checks.
2. Verify they fail (RED).
3. Implement in `CUSTOM_COMPLETION_PREDICATES.build`: after the existing pending-task check passes, call `collectUnverifiedDoneWhenChecks`; when non-empty and no nudge is recorded for the lap, return not-done with a nudge reason naming each task id and check text; teach `buildRetryHint` to carry that reason. Pending tasks keep their existing reason first and record no nudge.
4. Verify they pass (GREEN).
5. Commit: "feat(build): one nudge for unverified Done-when checks"

**Done when:**
- `CUSTOM_COMPLETION_PREDICATES.build` returns not-done with a nudge reason naming each unverified check task id and check text when every task is resolved and no nudge is recorded for the lap, and `buildRetryHint` carries those names, as asserted by the nudge predicate test.
- With the lap nudge already recorded, the predicate returns done for the same resolved state, as asserted by the post-nudge predicate test.
- With every task resolved and no unverified record, including the stamp-resolved and legacy task-status fixtures, the predicate returns done with no nudge reason and records no nudge, as asserted by the no-unverified predicate test.
- With pending tasks and unverified checks both present, the predicate returns the existing pending-task reason listing every pending task, with no nudge text and no nudge recorded, as asserted by the pending-precedence test.

**Files:** `src/conductor/src/engine/artifacts.ts`, `src/conductor/src/engine/conductor.ts`, `src/conductor/test/engine/build-completion-unverified-nudge.test.ts`

### Task 9: Persist the nudge and keep stall accounting unchanged
**Story:** 5
**Story:** 4
**Type:** negative-path
**Dependencies:** Task 8

**Steps:**
1. Write failing tests: nudge flag survives a fresh process; the nudge attempt leaves `noEvidenceAttempts` unchanged and completed-with-unverified is not no task progress; an exhausted retry budget gives no nudge; an uncommitted test after the nudge hits the existing floor.
2. Verify they fail (RED).
3. Implement: record the nudge-spent flag keyed by lap through the `createEngineStateStore` serialized update; exclude the nudge attempt from the progress watcher no-evidence count; skip the nudge when the per-step retry budget is spent; leave the uncommitted-work floor ahead of the nudge.
4. Verify they pass (GREEN).
5. Commit: "feat(build): persist the unverified nudge outside stall accounting"

**Done when:**
- The nudge-spent flag is written through the `createEngineStateStore` serialized update keyed by lap, and a fresh engine process reading that state completes the resolved build with no second nudge, as asserted by the restart test.
- A nudge attempt with no new commit leaves `noEvidenceAttempts` unchanged, and a build whose tasks are all completed with unverified checks is not classified as no task progress, as asserted by the nudge-accounting test.
- With the per-step retry budget exhausted, no nudge is recorded and the step takes its existing exhaustion route, writing no halt class outside the existing set, as asserted by the budget-exhausted test.
- With an uncommitted test file left by the nudge turn, the uncommitted-work floor withholds completion with its existing reason, as asserted by the dirty-tree test.

**Files:** `src/conductor/src/engine/engine-state-store.ts`, `src/conductor/src/engine/build-progress-watcher.ts`, `src/conductor/src/engine/conductor.ts`, `src/conductor/test/engine/build-completion-unverified-nudge.test.ts`, `src/conductor/test/engine/engine-state-store.test.ts`

### Task 10: Record still-unverified checks on the event spine
**Story:** 5
**Type:** happy-path
**Dependencies:** Task 8

**Steps:**
1. Write failing tests: completion after the nudge emits one `build_done_when_unverified` event naming each check; completion with no unverified checks emits none; the sink registry covers the variant.
2. Verify they fail (RED).
3. Implement: add the `build_done_when_unverified` variant (task id and check text per entry) to the `ConductorEvent` union, an `EVENT_SINKS` row, and emit it in-process when BUILD completes with a non-empty collected set. The `task done` CLI emits nothing.
4. Verify they pass (GREEN).
5. Commit: "feat(events): record unverified Done-when checks at BUILD completion"

**Done when:**
- When BUILD completes after the nudge with one check still unverified, the conductor emits exactly one `build_done_when_unverified` event naming that check task id and check text, persisted to `.pipeline/events.jsonl`, as asserted by the completion-event test.
- A BUILD completing with every task resolved and no unverified check emits no `build_done_when_unverified` event and records no nudge, as asserted by the no-event test.
- `EVENT_SINKS` has a row for `build_done_when_unverified`, and a `conduct task done` unverified close appends no event, as asserted by the event-sink and CLI no-event tests.

**Files:** `src/conductor/src/types/events.ts`, `src/conductor/src/engine/event-sinks.ts`, `src/conductor/src/engine/conductor.ts`, `src/conductor/test/engine/event-sinks.test.ts`, `src/conductor/test/engine/build-completion-unverified-nudge.test.ts`

### Task 11: Supply unverified checks to the prd_audit input projection
**Story:** 6
**Story:** 3
**Type:** happy-path
**Dependencies:** Task 7

**Steps:**
1. Prerequisite: the `prd-audit-receives-bounded-inputs-and-returns-vali` feature has shipped, so `prd-audit-projection.ts` exists on main.
2. Write failing projection tests: an unverified check on task 4 appears with task id, check text and reason; no records and legacy records give an empty list; the field changes the projection input identity.
3. Verify they fail (RED).
4. Implement: add `unverifiedDoneWhen` from `collectUnverifiedDoneWhenChecks`, bump the projection version, and include the field in the projection identity.
5. Verify they pass (GREEN).
6. Commit: "feat(prd-audit): carry unverified Done-when checks in the audit input"

**Done when:**
- The `prd_audit` projection built by `prd-audit-projection.ts` carries an `unverifiedDoneWhen` list containing task 4, its check text and its reason for a task-status fixture with that unverified check, as asserted by the projection test.
- With no unverified records, and with a task-status fixture written before this change, the projection builds without error and `unverifiedDoneWhen` is present and empty, as asserted by the empty and legacy projection tests.
- The projection version is incremented and changing `unverifiedDoneWhen` changes the projection input identity, as asserted by the identity test.

**Files:** `src/conductor/src/engine/prd-audit-projection.ts`, `src/conductor/test/engine/prd-audit-projection.test.ts`

### Task 12: Tag criterion-bound remediation checks
**Story:** 7
**Type:** happy-path
**Dependencies:** Tasks 1, 5

**Steps:**
1. Write failing tests: a `prd_audit` FIXABLE criterion append starts its criterion check with `[test]`; an as-built REMEDIABLE append has no tag; the tagged block passes land shape; an unverified close of the appended tagged check completes without a HALT.
2. Verify they fail (RED).
3. Implement in `buildRemediationDoneWhenChecks`: prefix the criterion check with `[test]` when a criterion is present for a `prd_audit` source; leave every other source untagged.
4. Verify they pass (GREEN).
5. Commit: "feat(remediation): tag criterion-bound repair checks"

**Done when:**
- `buildRemediationDoneWhenChecks` called for a `prd_audit` FIXABLE finding with criterion S3.6 returns a criterion check beginning with `[test]`, and the appended plan block carries it, as asserted by the criterion-remediation test.
- The as-built REMEDIABLE append renders a block with no `[test]` check, as asserted by the as-built remediation test.
- An appended criterion-bound block passes `validatePlanDoneWhen` with two to five non-blank checks and its tagged check parses through `parsePlanTaskDoneWhen`, as asserted by the remediation land-shape test.
- `conduct task done` closing an appended criterion-bound task tagged check with `--unverified <n>=<reason>` completes the task and writes no `.pipeline/HALT` file, as asserted by the remediation unverified-close test.

**Files:** `src/conductor/src/engine/remediation-append.ts`, `src/conductor/test/engine/remediation-append-land-shape.test.ts`, `src/conductor/test/engine/remediation-append-plan-write.test.ts`, `src/conductor/test/engine/task-progress.test.ts`

### Task 13: Teach the plan and pipeline skills the tag and close forms
**Story:** 1
**Story:** 4
**Type:** infrastructure
**Dependencies:** Tasks 3, 5

**Steps:**
1. Write a failing skill-text test reading both skill files for the required statements.
2. Verify it fails (RED).
3. Implement: in plan §3c state that a check needing a test begins with the exact tag `[test]`; in the pipeline DONE step show `--done-when <n>=test:<path>::<title>` and `--unverified <n>=<reason>`, and state that a missing test for a tagged check is never `--plan-gap`.
4. Verify it passes (GREEN).
5. Commit: "docs(skills): plan tag and tagged-check close forms"

**Done when:**
- `skills/plan/SKILL.md` section 3c states that a check requiring a test begins with the exact tag `[test]`, as asserted by the skill-text test.
- `skills/pipeline/SKILL.md` DONE step shows `--done-when <n>=test:<path>::<title>` and `--unverified <n>=<reason>` and states a missing test for a tagged check is never `--plan-gap`, as asserted by the skill-text test.

**Files:** `skills/plan/SKILL.md`, `skills/pipeline/SKILL.md`, `src/conductor/test/engine/skill-done-when-test-tag.test.ts`

## Task Dependency Graph

```text
Task 1 <- none
Task 2 <- none
Task 3 <- Tasks 1, 2
Task 4 <- Task 3
Task 5 <- Task 3
Task 6 <- Task 5
Task 7 <- Task 5
Task 8 <- Task 7
Task 9 <- Task 8
Task 10 <- Task 8
Task 11 <- Task 7
Task 12 <- Tasks 1, 5
Task 13 <- Tasks 3, 5
```

## Integration Points

- After Task 3: `conduct task done` verifies tagged checks end to end through the CLI.
- After Task 8: BUILD withholds completion once for unverified checks through the real completion predicate and retry hint.
- After Task 11: `prd_audit` receives unverified checks in its engine-owned input.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a plan task whose Done-when block has a check beginning with the `[test]` tag and an untagged check, when the spec is landed, then land accepts the plan and the parsed check text still begins with `[test]` exactly as authored. | 1 | "returns a `[test]` check byte-for-byte as authored" | diff-local |
| Story 1 happy: Given a coherence row that quotes a fragment of a `[test]`-tagged check without the tag, when the coherence gate runs at land, then the quote is still found in the cited task's Done-when checks. | 1 | "finds a quote of an untagged fragment of a `[test]` check" | diff-local |
| Story 1 negative: Given a plan check that begins with a malformed tag such as `[tests]` or `[Test]`, when the spec is landed, then land refuses it naming the task id and the check, and no waiver file makes it pass. | 1 | "naming the task id and the check text for `[tests]` and `[Test]` checks" | diff-local |
| Story 1 negative: Given a plan check that consists of the `[test]` tag with no check text after it, when the spec is landed, then land refuses it naming the task id as a blank check. | 1 | "A check that is only `[test]` is reported as a `blank` violation" | diff-local |
| Story 2 happy: Given task 3 has a `[test]` check and HEAD has a test file containing the cited title and a `Covers: task:3` marker, when `conduct task done 3` cites that file and title for the check, then the task completes and the check's close record has source `verified`. | 3 | "writes the check close record with source `verified`" | diff-local |
| Story 2 happy: Given task 3's `Story:` line cites Story 2 and the cited test file carries `Covers: S2.1` instead of a task marker, when the check is closed with that reference, then the check's close record has source `verified`. | 3, 2 | "citing a `Covers: S2.1` test for a task whose Story line cites Story 2" | diff-local |
| Story 2 happy: Given the cited test file was committed before the feature branch and is unchanged in the feature diff, when the check is closed with a reference to it, then the check's close record has source `verified`. | 3 | "a test committed before the feature branch and absent from the feature diff" | diff-local |
| Story 2 happy: Given `conduct task done` is run from a subdirectory of the worktree, when a check cites a test path relative to the repository root, then the path resolves from the repository root and the check verifies. | 3 | "resolves a repository-root-relative test path" | diff-local |
| Story 2 negative: Given a tagged check, when it is closed with free-text evidence that names no test file and title, then the close is refused naming the check number and text, and the task stays not completed. | 3, 2 | "with free-text evidence, or citing a path present only uncommitted" | diff-local |
| Story 2 negative: Given a tagged check, when it is closed citing a test file that does not exist at HEAD, then the close is refused naming the check and the missing path. | 3, 2 | "name the missing path, the missing title, or the missing `Covers:` marker" | diff-local |
| Story 2 negative: Given a tagged check, when it is closed citing a file at HEAD whose content does not contain the cited title after whitespace normalization, then the close is refused naming the check and the missing title. | 3, 2 | "name the missing path, the missing title, or the missing `Covers:` marker" | diff-local |
| Story 2 negative: Given a tagged check, when it is closed citing a file at HEAD that contains the title but whose `Covers:` markers name neither the task nor any criterion of the stories the task cites, then the close is refused naming the check and the missing marker. | 3, 2 | "name the missing path, the missing title, or the missing `Covers:` marker" | diff-local |
| Story 2 negative: Given a test file that exists only in the working tree and is not committed, when a tagged check cites it, then the close is refused because the file is absent at HEAD. | 3 | "names that path as absent at HEAD in the uncommitted case" | diff-local |
| Story 2 negative: Given a test file in a language this repository does not use, when a tagged check cites it with a matching title and `Covers:` marker, then the check verifies exactly as a TypeScript test would. | 2 | "a language this repository does not use, and a TypeScript test file with the same title and marker both return `verified`" | diff-local |
| Story 3 happy: Given an untagged check such as a configuration assertion, when it is closed with free-text evidence, then the task completes and the check's close record has source `reported`. | 4 | "closing an untagged check with free-text evidence completes the task and records source `reported`" | diff-local |
| Story 3 happy: Given a task with one tagged and one untagged check, when the tagged check cites a verifiable test and the untagged check has free-text evidence, then the task completes with sources `verified` and `reported` respectively. | 4 | "closes with sources `verified` and `reported` respectively" | diff-local |
| Story 3 negative: Given a plan with no `[test]` tags, when every task is closed with the same free-text evidence accepted before this change, then no close is refused. | 4 | "refuses no close" | diff-local |
| Story 3 negative: Given a task-status file whose close records were written before this change and have no new source values, when BUILD and `prd_audit` read it, then both proceed without error and treat those records as `reported`. | 7, 8, 11 | "Close records written before this change, with source `reported` or no source field, contribute nothing and raise no error" | diff-local |
| Story 4 happy: Given a tagged check 2 on task 5, when `conduct task done 5` closes check 2 as unverified with a reason and the other checks with valid evidence, then task 5 completes and check 2's close record has source `unverified` and that reason. | 5 | "records check 2 with source `unverified` and that reason" | diff-local |
| Story 4 happy: Given a verify-only task with a tagged check, when the check is closed as unverified with a reason, then the task completes and the record has source `unverified`. | 6 | "for its tagged check completes the task and records that check with source `unverified`" | diff-local |
| Story 4 negative: Given a tagged check, when it is closed as unverified with an empty reason, then the close is refused naming the check. | 5 | "exits non-zero naming check 2" | diff-local |
| Story 4 negative: Given a tagged check whose test reference was refused, when the refusal is printed, then it directs the agent to write or cite the test or close the check as unverified and never directs it to `--plan-gap`. | 5 | "contains no `--plan-gap` text" | diff-local |
| Story 4 negative: Given a verify-only task with a tagged check, when `conduct task done` closes the task with no evidence for that check, then the close is refused naming the check, while its untagged checks still close by the prove-closed path. | 6 | "with no evidence for its tagged check exits non-zero naming the check" | diff-local |
| Story 4 negative: Given every task completed but some checks unverified, when BUILD evaluates task progress, then the run is not counted as making no task progress. | 9 | "is not classified as no task progress" | diff-local |
| Story 5 happy: Given every plan task is resolved and two checks are unverified, when the BUILD session ends and no nudge has been spent in this lap, then BUILD is not completed and the retry hint names both checks by task id and check text. | 8 | "returns not-done with a nudge reason naming each unverified check task id and check text" | diff-local |
| Story 5 happy: Given the nudge was spent in this lap and one check is still unverified, when the next BUILD session ends with every task resolved, then BUILD completes and one event is recorded naming the still-unverified check. | 10, 8 | "emits exactly one `build_done_when_unverified` event naming that check task id and check text" | diff-local |
| Story 5 happy: Given every plan task is resolved and no check is unverified, when the BUILD session ends, then BUILD completes with no nudge and no unverified-checks event. | 10, 8 | "emits no `build_done_when_unverified` event and records no nudge" | diff-local |
| Story 5 negative: Given the nudge turn produces no new commit, when the progress-aware halt accounting runs, then the no-evidence attempt count is unchanged by the nudge. | 9 | "leaves `noEvidenceAttempts` unchanged" | diff-local |
| Story 5 negative: Given the nudge was spent and the daemon process restarts before the next BUILD session, when BUILD resumes in the same lap, then no second nudge is given. | 9 | "completes the resolved build with no second nudge" | diff-local |
| Story 5 negative: Given the per-step retry budget is already exhausted when unverified checks remain, when the BUILD session ends, then no nudge is given and the step follows its existing exhaustion behavior with no new halt class. | 9 | "no nudge is recorded and the step takes its existing exhaustion route" | diff-local |
| Story 5 negative: Given the nudge turn writes a test but leaves it uncommitted, when the BUILD session ends, then the existing uncommitted-work floor withholds completion exactly as it does for any other turn. | 9 | "the uncommitted-work floor withholds completion with its existing reason" | diff-local |
| Story 5 negative: Given some plan tasks are still pending, when the BUILD session ends, then the pending tasks are reported as before and the nudge does not replace or hide that reason. | 8 | "returns the existing pending-task reason listing every pending task, with no nudge text" | diff-local |
| Story 5 negative: Given a task with a `[test]` check that was resolved by a no-diff skipped stamp or a verify-only stamp and so has no task-close record for that check, when the BUILD session ends with every task resolved, then that check is not counted as unverified and BUILD completes with no nudge. | 8, 7 | "including the stamp-resolved and legacy task-status fixtures, the predicate returns done with no nudge reason" | diff-local |
| Story 6 happy: Given BUILD completed with an unverified check on task 4, when `prd_audit` assembles its engine-owned input, then the input includes task 4, the check text, and the recorded reason. | 11 | "carries an `unverifiedDoneWhen` list containing task 4, its check text and its reason" | diff-local |
| Story 6 negative: Given no check was closed unverified, when `prd_audit` assembles its input, then the unverified-checks field is present and empty. | 11 | "`unverifiedDoneWhen` is present and empty" | diff-local |
| Story 6 negative: Given a task-status file written before this change, when `prd_audit` assembles its input, then assembly succeeds and the unverified-checks field is empty. | 11 | "with a task-status fixture written before this change, the projection builds without error" | diff-local |
| Story 7 happy: Given a `prd_audit` FIXABLE finding bound to criterion S3.6, when the remediation task is appended to the plan, then its criterion check begins with the `[test]` tag. | 12 | "returns a criterion check beginning with `[test]`" | diff-local |
| Story 7 negative: Given an as-built REMEDIABLE finding, when its remediation task is appended, then none of its checks carry the `[test]` tag. | 12 | "renders a block with no `[test]` check" | diff-local |
| Story 7 negative: Given an appended criterion-bound remediation task, when the amended plan is validated by the Done-when shape rule, then it has between two and five non-blank checks and passes. | 12 | "passes `validatePlanDoneWhen` with two to five non-blank checks" | diff-local |
| Story 7 negative: Given an appended criterion-bound remediation task whose test cannot be produced, when BUILD closes its tagged check as unverified with a reason, then the task completes without a halt. | 12 | "completes the task and writes no `.pipeline/HALT` file" | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-08-22-done-when-evidence-at-task-close#D1 | task | task-3 | writes the check close record with source `verified` to task-status.json |
| adr-2026-08-22-done-when-evidence-at-task-close#D2 | task | task-6 | its untagged check is recorded with source `verify-only` without supplied evidence |
| adr-2026-08-22-done-when-evidence-at-task-close#D3 | existing | none | `conduct task done <id> --plan-gap <n> --reason <text>` in `task-cli.ts` already writes the classified plan-gap HALT for a check that cannot be made true; this feature leaves that path unchanged for untagged checks and narrows it for tagged checks only under D7. |
| adr-2026-08-22-done-when-evidence-at-task-close#D4 | no-change | none | Decision 4 keeps the trailer floor rejected; this feature reads only plan checks and cited files, never `Task:` trailers, and adds no blocking per-task trailer rule. |
| adr-2026-08-22-done-when-evidence-at-task-close#D5 | task | task-1 | reports a `malformed-test-tag` violation naming the task id and the check text |
| adr-2026-08-22-done-when-evidence-at-task-close#D6 | task | task-3 | writes source `verified`, as asserted by the criterion-marker and pre-branch CLI tests |
| adr-2026-08-22-done-when-evidence-at-task-close#D7 | task | task-5 | records check 2 with source `unverified` and that reason |
| adr-2026-08-22-done-when-evidence-at-task-close#D8 | task | task-8, task-9, task-10, task-11 | returns not-done with a nudge reason naming each unverified check task id and check text |
| adr-2026-08-22-done-when-evidence-at-task-close#D9 | task | task-12 | returns a criterion check beginning with `[test]` |

## Verification

- [x] All happy path criteria covered by at least one task
- [x] All negative path criteria covered by at least one task
- [x] No task exceeds 5 minutes of work
- [x] Every task has a `Done when:` block of falsifiable checks
- [x] Dependencies are explicit and acyclic
