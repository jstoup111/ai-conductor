# Implementation Plan: Spec commit/PR bodies list tasks with their titles

**Date:** 2026-10-09
**Design:** none (technical track, Tier S — see `.docs/track/spec-commit-pr-bodies-list-tasks-by-bare-id-only-u.md`)
**Stories:** .docs/stories/spec-commit-pr-bodies-list-tasks-by-bare-id-only-u.md
**Conflict check:** Not required (Tier S)

## Summary

Make the spec land commit message, which the spec PR body is built from, list each plan task as `- Task <id>: <title>` instead of a bare `- Task <id>`. A heading with no title falls back to the bare id. Two tasks: render titles from the existing title parser and prove it through `landSpec`, then pin the untitled, fenced, and trailer-shaped edge cases.

## Technical Approach

- **Reuse the existing title parser; add no new one.** `composeSpecCommitMessage` in `src/conductor/src/engine/engineer/spec-commit-message.ts` builds its Tasks section from `[...parsePlanTaskBodies(planText).keys()]`, which carries ids only. `src/conductor/src/engine/plan-task-parse.ts` already exports `parsePlanTaskTitles(text): Map<string, string>`. It uses the same `TASK_HEADER_PATTERN`, `linesWithFenceState` fence exclusion, and `expandTaskIds` as `parsePlanTaskBodies`, so it yields the same ids in the same insertion order. It is already consumed by `coverage-binding-conflict-inputs.ts` and `remediation-projection.ts`, and its contract (`''` for an untitled heading, one entry per id of a multi-id heading) is pinned in `plan-task-parse.test.ts`. Switch the Tasks section to iterate `parsePlanTaskTitles(planText)` entries, and drop the now-unused `parsePlanTaskBodies` import. Do not change `parsePlanTaskBodies` or `parsePlanTaskTitles`.
- **Rendering rule.** Each entry renders as `- Task ${id}: ${title}` when `title` is non-empty, and `- Task ${id}` otherwise. `parsePlanTaskTitles` already trims, so `### Task 4` and `### Task 4:` both yield `''`. The `Tasks: <count>` header stays the number of ids, which is unchanged.
- **Trailer safety is structural.** Every Tasks line starts with `- `, so it can never match `TASK_TRAILER_LINE_PATTERN` (`^Task: (<id>)[ \t]*$`, `plan-task-parse.ts:45`). This holds even when a title is itself trailer-shaped. No new filter is needed; Task 2 pins it with a test.
- **PR body follows the commit.** `handoff` builds the PR body from the land commit (`buildSpecPrCreateArgs` reads `git show -s --format=%B <branch>`, `release-metadata-inject.ts:122`; the `--fill` fallback also uses the last commit message). The `landSpec` commit therefore carries the change to the PR with no handoff edit. The boundary proof is the existing `landSpec` commit-message test in `land-spec.test.ts` ("preserves the subject while committing the plan, track, tier, stories, and task list in the body"). It currently pins the bare form `Tasks: 3\n- Task 1\n- Task 2\n- Task 3`, so its expectation changes in the same task as the implementation.
- **Local test pattern.** `spec-commit-message.test.ts` calls `composeSpecCommitMessage(idea, track, tier, storiesText, planText)` with `[...].join('\n')` fixtures and asserts exact lines via `message.split('\n')` or whole-message `toBe`. Follow that shape. The existing `removes copied trailer-shaped lines from the composed body` case asserts the whole message ending `'Tasks: 1\n- Task 1'` for heading `### Task 1: Filter copied trailers`, so its expectation becomes `'Tasks: 1\n- Task 1: Filter copied trailers'`.

## Prerequisites

- None.

## Tasks

### Task 1: Render each task's heading title in the spec commit Tasks section
**Story:** Story 1 (happy paths 1–3)
**Type:** happy-path

**Steps:**
1. In `src/conductor/test/engine/engineer/spec-commit-message.test.ts`, extend `composes the current subject and an inert DECIDE-artifact summary`. Assert that the message's final `\n\n`-separated section is exactly the lines `Tasks: 3`, `- Task 1: Compose the body`, `- Task 2: Guard trailer-shaped prose`, `- Task 3: Commit the summary`. Add a case whose plan heading is `### Task task_3 — Dash-delimited title` and assert the message lines contain `- Task task_3: Dash-delimited title`. Update the `removes copied trailer-shaped lines …` whole-message expectation's last section to `'Tasks: 1\n- Task 1: Filter copied trailers'`.
2. In `src/conductor/test/engine/engineer/land-spec.test.ts`, change the `preserves the subject while committing the plan, track, tier, stories, and task list in the body` expectation to `expect(message).toContain('Tasks: 3\n- Task 1: Compose the summary\n- Task 2: Keep prose inert\n- Task 3: Commit the summary')`. The message is read via `git log -1 --format=%B` after `landSpec`.
3. Verify RED.
4. In `spec-commit-message.ts`, import `parsePlanTaskTitles` in place of `parsePlanTaskBodies`. Build the Tasks section from `[...parsePlanTaskTitles(planText)]` entries rendered `- Task ${id}: ${title}`, with the section header `Tasks: ${entries.length}`. Leave Summary, Track, Stories, and the subject untouched.
5. Verify GREEN; commit "feat(engineer): list task titles in spec land commit".

**Done when:**
- [test] `spec-commit-message.test.ts` asserts `composeSpecCommitMessage` emits a Tasks section that is exactly `Tasks: 3` followed by the lines `- Task 1: Compose the body`, `- Task 2: Guard trailer-shaped prose`, `- Task 3: Commit the summary`, in plan order, with no other line in that section.
- [test] `spec-commit-message.test.ts` asserts `composeSpecCommitMessage` emits `- Task task_3: Dash-delimited title` for the heading `### Task task_3 — Dash-delimited title`.
- [test] `land-spec.test.ts` asserts the `landSpec` commit message read back with `git log -1 --format=%B` contains `Tasks: 3\n- Task 1: Compose the summary\n- Task 2: Keep prose inert\n- Task 3: Commit the summary`, i.e. every task listed as `- Task <id>: <title>` in plan order.
- `spec-commit-message.ts` derives the Tasks section from `parsePlanTaskTitles` and no longer imports `parsePlanTaskBodies`; `plan-task-parse.ts` is unchanged.

**Files likely touched:**
- `src/conductor/src/engine/engineer/spec-commit-message.ts` — Tasks section from `parsePlanTaskTitles`
- `src/conductor/test/engine/engineer/spec-commit-message.test.ts` — titled-line and em-dash assertions; updated whole-message expectation
- `src/conductor/test/engine/engineer/land-spec.test.ts` — titled Tasks expectation on the land commit

**Dependencies:** none

### Task 2: Untitled, fenced, and trailer-shaped task headings render safely
**Story:** Story 1 (negative paths 1–3)
**Type:** negative-path

**Steps:**
1. In `spec-commit-message.test.ts`, add three cases:
   (a) A plan with `### Task 4` and another plan with `### Task 4:`. For each, `composeSpecCommitMessage` does not throw, the message lines contain exactly `- Task 4`, and no line starts with `- Task 4:`.
   (b) A plan with a real `### Task 1: Real task` heading plus a fenced block (```` ```markdown ```` … ```` ``` ````) containing `### Task 9: Example heading`. The message contains `Tasks: 1` and no line starting with `- Task 9`.
   (c) A plan with heading `### Task 1: Task: 71`. The message lines contain `- Task 1: Task: 71`, and no line, after trimming, matches `new RegExp(TASK_TRAILER_LINE_PATTERN)`.
2. Verify RED. Task 1's naive rendering yields `- Task 4: `, so (a) fails. (b) and (c) may already pass; keep them as pinned regressions.
3. In `spec-commit-message.ts`, render `- Task ${id}` when the title is empty, and `- Task ${id}: ${title}` otherwise.
4. Verify GREEN; commit "fix(engineer): fall back to bare task id for untitled plan headings".

**Done when:**
- [test] `spec-commit-message.test.ts` asserts that for both `### Task 4` and `### Task 4:`, `composeSpecCommitMessage` returns without throwing and emits exactly the line `- Task 4` with no trailing colon or whitespace.
- [test] `spec-commit-message.test.ts` asserts that a `### Task 9: Example heading` inside a fenced code block yields no `- Task 9` line and a `Tasks: 1` count from `composeSpecCommitMessage`.
- [test] `spec-commit-message.test.ts` asserts that heading `### Task 1: Task: 71` renders as the line `- Task 1: Task: 71`, and that no composed line matches `TASK_TRAILER_LINE_PATTERN`.

**Files likely touched:**
- `src/conductor/src/engine/engineer/spec-commit-message.ts` — empty-title fallback
- `src/conductor/test/engine/engineer/spec-commit-message.test.ts` — untitled, fenced, trailer-shaped cases

**Dependencies:** Task 1

## Task Dependency Graph

```
Task 1 ──▶ Task 2
```

## Integration Points

- After Task 1: `landSpec` commits a message whose Tasks section carries titles; `handoff` reuses that message as the spec PR body unchanged.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a plan whose task headings are `### Task 1: Compose the body`, `### Task 2: Guard trailer-shaped prose`, and `### Task 3: Commit the summary`, when the spec commit message is composed, then its Tasks section is exactly `Tasks: 3` followed by the lines `- Task 1: Compose the body`, `- Task 2: Guard trailer-shaped prose`, and `- Task 3: Commit the summary`, in plan order. | 1 | "`spec-commit-message.test.ts` asserts `composeSpecCommitMessage` emits a Tasks section that is exactly `Tasks: 3` followed by the lines `- Task 1: Compose the body`, `- Task 2: Guard trailer-shaped prose`, `- Task 3: Commit the summary`, in plan order, with no other line in that section." | diff-local |
| Story 1 happy: Given a plan task heading delimited by an em dash, `### Task task_3 — Dash-delimited title`, when the spec commit message is composed, then its Tasks section carries the line `- Task task_3: Dash-delimited title`. | 1 | "`spec-commit-message.test.ts` asserts `composeSpecCommitMessage` emits `- Task task_3: Dash-delimited title` for the heading `### Task task_3 — Dash-delimited title`." | diff-local |
| Story 1 happy: Given a valid spec with titled task headings landed through `landSpec`, when the resulting land commit's full message is read back with `git log -1 --format=%B`, then its Tasks section lists every task as `- Task <id>: <title>` in plan order. | 1 | "`land-spec.test.ts` asserts the `landSpec` commit message read back with `git log -1 --format=%B` contains `Tasks: 3\n- Task 1: Compose the summary\n- Task 2: Keep prose inert\n- Task 3: Commit the summary`, i.e. every task listed as `- Task <id>: <title>` in plan order." | diff-local |
| Story 1 negative: Given a plan task heading with no title text, either `### Task 4` or `### Task 4:`, when the spec commit message is composed, then that task's line is exactly `- Task 4`, with no trailing colon or whitespace, and composition does not throw. | 2 | "`spec-commit-message.test.ts` asserts that for both `### Task 4` and `### Task 4:`, `composeSpecCommitMessage` returns without throwing and emits exactly the line `- Task 4` with no trailing colon or whitespace." | diff-local |
| Story 1 negative: Given a plan that shows a `### Task 9: Example heading` line only inside a fenced code block, when the spec commit message is composed, then no `- Task 9` line appears and the `Tasks:` count excludes it. | 2 | "`spec-commit-message.test.ts` asserts that a `### Task 9: Example heading` inside a fenced code block yields no `- Task 9` line and a `Tasks: 1` count from `composeSpecCommitMessage`." | diff-local |
| Story 1 negative: Given a plan task whose title is itself trailer-shaped, `### Task 1: Task: 71`, when the spec commit message is composed, then that task's line is `- Task 1: Task: 71` and no line of the message matches the `Task: <id>` commit-trailer grammar. | 2 | "`spec-commit-message.test.ts` asserts that heading `### Task 1: Task: 71` renders as the line `- Task 1: Task: 71`, and that no composed line matches `TASK_TRAILER_LINE_PATTERN`." | diff-local |

## Verification
- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic
