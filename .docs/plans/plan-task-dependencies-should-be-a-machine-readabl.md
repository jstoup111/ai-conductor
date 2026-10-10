# Implementation Plan: Plan task structure becomes one strict compiled contract

**Date:** 2026-10-10
**Source:** jstoup111/ai-conductor#623
**Design:** technical track — no PRD; `.docs/track/plan-task-dependencies-should-be-a-machine-readabl.md`, `.docs/architecture/plan-task-dependencies-should-be-a-machine-readabl.md`, `.docs/decisions/architecture-review-plan-task-dependencies-should-be-a-machine-readabl.md` (APPROVED WITH CONDITIONS, C1–C6)
**Stories:** .docs/stories/plan-task-dependencies-should-be-a-machine-readabl.md
**Conflict check:** Clean as of 2026-10-10 (`.docs/conflicts/plan-task-dependencies-should-be-a-machine-readabl.md`, PASS after operator-accepted resolutions)

## Summary

Introduce one plan compiler as the only engine code that recognizes plan task headings and
per-task fields. Unmarked plans compile through legacy views pinned to base-commit goldens. Marked
plans compile under one strict grammar, refused at land, discovery, and build. 25 tasks in four
slices, delivered as one PR (stacked delivery is not enabled).

## Technical Approach

- **One module directory.** New `src/conductor/src/engine/plan-compiler/` owns task recognition:
  `index.ts` (`compilePlan(text)` and the result types), `marker.ts`, `legacy-views.ts`,
  `strict.ts`, `dependencies.ts`, `digest.ts`, and `plan-check.ts`. `compilePlan` returns a
  discriminated union: `{ kind: 'compiled', mode: 'strict' | 'legacy', plan }` or
  `{ kind: 'errors', mode, errors: [CompileError, ...] }` with a non-empty error list; both arms carry `mode`. Marked fixtures used by Tasks 7 and 13 are strict-complete (every authored task declares Files, Story, Dependencies, and Done when) so later strict rules do not turn them into errors. Each
  `CompileError` carries `line`, `taskId` (when one applies), `rule`, and `message`. Results are
  frozen and memoized in process by the sha256 of the text; nothing is written to disk.
- **Legacy views preserve today's per-consumer behavior.** Today's parsers disagree (for example,
  `parsePlanTasks` returns no task for `### Task 1, 2: x` while `TASK_HEADER_PATTERN` returns two;
  `conductor.ts`'s authored-task count matches any `Task` heading, including
  `## Task Dependency Graph`). Each interpretation moves verbatim into a named legacy view in
  `legacy-views.ts` (for example `legacyViews.sharedBodies`, `legacyViews.autohealTasks`,
  `legacyViews.authoredTaskCount`, `legacyViews.attributionTaskIds`,
  `legacyViews.coherenceStoryMap`, `legacyViews.hasDependencyTree`, `legacyViews.sealTailTaskIds`).
  Each view's output over every committed plan equals a golden captured at the base commit
  before any consumer moves.
- **Goldens come first.** Task 1 captures goldens with a test-only capture script that calls the
  shared parsers and verbatim copies of each ad-hoc regex, as they exist at the base commit. The
  goldens are committed JSON fixtures; every later equivalence test compares against them, so the
  oracle never needs the old code to stay callable.
- **Existing exports become adapters.** `plan-task-parse.ts` keeps its non-heading helpers
  (`TASK_ID_PATTERN`, `resolvePlanTaskReference`, `normalizePlanTaskId`, `isMalformedTestTag`,
  `TASK_TRAILER_LINE_PATTERN`). Its parser exports (`parsePlanTaskBodies`, `parsePlanTaskPaths`,
  and the rest) and `autoheal.ts`'s `parsePlanTasks` / `parsePlanTaskVerifyOnly` become thin
  adapters over `compilePlan`: legacy mode returns the matching legacy view, strict mode projects
  the compiled tasks, and a failed compile throws `PlanCompileFailure` (never an empty map).
  Ad-hoc regex sites are replaced by calls to the adapters or to a named legacy view.
- **Strict mode.** The marker is the exact whole line `Plan-Format: 2`, outside fences, before
  the first task heading. A strict task heading is exactly `### Task <id>: <title>` with one H9
  id. A task's span ends at the next heading at its level or above, and that one span feeds every
  field. Authored tasks declare Files (any of `**Files:**`, `**Files**:`,
  `**Files likely touched:**`), Story (today's value grammar), Dependencies, and Done when.
  Dependencies use the adr-2026-09-29 D4 grammar for every authored task, resolved through
  `resolvePlanTaskReference`, and must be acyclic.
- **Appended versus authored is applied after compile.** `checkPlan(compiled, appendedTaskIds)`
  in `plan-check.ts` classifies tasks using the engine's appended-id record and returns the
  authored-task required-field violations as `CompileError`s. Callers that refuse (land,
  discovery, build) call `checkPlan`; `compilePlan` itself stays a function of text.
- **Refusal points.** Land gains `LandGateIdentifier` `plan-compile`, reporting every error, then
  the existing task-count gate, then coherence. Discovery gains `BlockedSpecItem.reason`
  `plan-compile-failed` with the errors in `remedy`, recomputed every pass. Build raises one
  `needs-human` halt where `conductor.ts` seeds task status.
- **Local pattern: pure parser plus typed result, no disk state.** `plan-slices.ts`
  (`validatePlanSlices`) and `plan-done-when.ts` (`validatePlanDoneWhen`) are pure functions of
  plan text returning typed results that land converts to `landGateError`. The compiler follows
  that shape. Allowed variation: one result for all fields instead of one function per field.
  Search hints: `validatePlanSlices`, `landGateError(`, `BlockedSpecItem`, `writeHaltMarker(`.

## Prerequisites

- None. No migration, config key, or dependency. Stacked delivery stays disabled.

## Slices

| Slice | Title | Tasks |
| --- | --- | --- |
| 1 | Compiler core, legacy views, and goldens | 1, 2, 3, 4, 5, 6 |
| 2 | Format marker and strict grammar | 7, 8, 9, 10, 11, 12, 13 |
| 3 | Consumer migration and refusal points | 14, 15, 16, 17, 18, 19, 20, 21, 22, 23 |
| 4 | Plan skill authoring contract | 24, 25 |

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given any plan committed under `.docs/plans/` at the base of this change, when each engine consumer that reads task structure evaluates it after the change, then its result (task ids, titles, bodies, declared paths, Done-when checks, story ids, verify-only flags, slices, and task counts) equals that consumer's golden for that plan. | 4 | "`validatePlanTaskCount` task counts equal their goldens for every manifest plan and fixture" | diff-local |
| Story 1 happy: Given any plan committed under `.docs/plans/` at the base of this change, when its task digests are computed after the change, then every digest is byte-identical to its golden. | 4 | "compares every `planTaskDigests` value with its golden byte for byte" | diff-local |
| Story 1 happy: Given an unmarked plan with a heading `### Task 1, 2: Shared title`, when the consumers that read it as two tasks and the consumer that read it as no task each evaluate it, then each returns its golden. | 4 | "For the multi-id fixture, `parsePlanTaskBodies` returns two task ids and `parsePlanTasks` returns no task, each equal to its golden." | diff-local |
| Story 1 happy: Given an unmarked plan containing a `## Task Dependency Graph` section, when the authored-task count that sets the remediation growth cap is computed, then it equals its golden, which counts that section. | 5 | "`legacyViews.authoredTaskCount` returns the golden count for the `## Task Dependency Graph` fixture" | diff-local |
| Story 1 negative: Given an unmarked plan whose task headings use `T<n> —` separators, bare `### Task 2` headings, and a task heading inside a fenced code block, when every consumer evaluates it, then each consumer's result equals its golden and none reports a task its golden does not contain. | 4 | "including the multi-id, bare `Task N`, `T<n>` em-dash and en-dash, fenced-heading, and trailing `## Verification` fixtures" | diff-local |
| Story 1 negative: Given an unmarked plan whose last task is followed by plan-level `## Verification` prose, when task bodies, declared paths, and digests are computed, then each equals its golden: bodies and digests stop at that heading, and declared paths still include prose paths found after it. | 4 | "end the last task at that heading while `parsePlanTaskPaths` still includes the backticked path named after it" | diff-local |
| Story 1 negative: Given an in-flight build of an unmarked plan whose task statuses and digests were recorded before the upgrade, when the build resumes on the upgraded engine, then the task-status sidecar is unchanged, no task is reopened, and no task or feature is parked. | 16 | "`.pipeline/task-status.json` is byte-identical, no `plan_amendment` reopen obligation exists, and no park or `no_task_progress` decision is recorded" | diff-local |
| Story 1 negative: Given an unmarked plan that has no `**Dependencies:**` line and no `## Task Dependency Graph` section, when daemon discovery vets it, then it is skipped with reason `no-dependency-tree`, as before the change. | 15 | "over the unmarked no-dependency-tree fixture returns a blocked entry with reason `no-dependency-tree`" | diff-local |
| Story 1 negative: Given a consumer view for which no golden fixture exists, when the equivalence test runs, then it fails naming the consumer and the plan. | 4 | "The equivalence test fails, naming the consumer key and the plan, when a golden is missing for a view it evaluates." | diff-local |
| Story 2 happy: Given the engine source after this change, when the single-owner audit runs, then it passes. | 23 | "`findTaskStructureRegexes` over every `src/conductor/src/**/*.ts` file reports no finding." | diff-local |
| Story 2 happy: Given a marked plan, when the land check, discovery vetting, task seeding, evidence derivation, remediation append, the seal's remediation-tail check, build_review inputs, and the coherence and coverage checks each read it, then they all report the same task id set. | 23 | "report an identical task id set" | diff-local |
| Story 2 negative: Given an engine source file outside the compiler module containing a regular expression literal or `RegExp` source that anchors a heading followed by `Task` or `T<digit>`, when the single-owner audit runs, then it fails naming that file and line. | 23, 14 | "The engine-wide audit test fails, naming the path and line, when an audit fixture file containing a `Task` heading regex is added to the set of files it scans." | diff-local |
| Story 2 negative: Given an engine source file outside the compiler module containing a regular expression for a per-task field token (`**Files:**`, `**Files**:`, `**Files likely touched:**`, `**Dependencies:**`, `**Done when:**`, `**Story:**`, `**Type:**`, or `**Verify-only:**`), when the single-owner audit runs, then it fails naming that file and line. | 14 | "a bare `^###\s+` heading splitter, or one of the eight field tokens" | diff-local |
| Story 2 negative: Given a test file, or the compiler module itself, containing such patterns, when the single-owner audit runs, then those files are not reported. | 14 | "does not report `*.test.ts` files or files under `plan-compiler/`" | diff-local |
| Story 3 happy: Given a plan whose header has the format marker line before the first task heading, when it is compiled, then it compiles in strict mode. | 7 | "`compilePlan` reports `mode: 'strict'` for a fixture whose `Plan-Format: 2` line precedes the first task heading" | diff-local |
| Story 3 happy: Given a plan with no format marker line, when it is compiled, then it compiles in legacy mode with the results of Story 1. | 7 | "For the unmarked copy, every legacy view returned through `compilePlan` equals that fixture's golden" | diff-local |
| Story 3 happy: Given a plan whose prose mentions the marker inline or in backticks, or only inside a fenced block, when it is compiled, then that mention is neither a marker nor an error, and the plan's mode is decided only by whole-line markers outside fences. | 7 | "inline, backticked, and fenced mentions of `Plan-Format: 2` neither change the mode nor produce a `CompileError`" | diff-local |
| Story 3 negative: Given a plan whose only format marker line appears after the first task heading, when it is compiled, then compilation fails with an error naming the marker's line and stating that the marker must precede the first task heading. | 7 | "A marker only after the first task heading yields a `CompileError` naming its line and stating it must precede the first task heading" | diff-local |
| Story 3 negative: Given a plan that has the format marker line twice, or a marker naming an unknown format version, when it is compiled, then compilation fails with an error naming the line and the problem. | 7 | "a duplicated marker and `Plan-Format: 3` each yield a `CompileError` naming the line and the problem" | diff-local |
| Story 3 negative: Given a plan that writes the marker as a Markdown heading, when it is compiled, then compilation fails naming that line, and no consumer counts that heading as a task. | 7 | "every adapter and `legacyViews` reader throws `PlanCompileFailure` for that plan rather than returning or counting a task for the heading" | diff-local |
| Story 3 negative: Given a marked plan whose marker line is removed by an operator reseal mid-build, when the build next reads the plan, then it compiles in legacy mode, and the digest of every task whose heading and body did not change equals its recorded digest, so no finished task is reopened. | 8 | "`compilePlan` reports `mode: 'legacy'` and `seedTaskStatus` admits no `plan_amendment` reopen obligation" | diff-local |
| Story 4 happy: Given a marked plan whose authored tasks use `### Task <id>: <title>` headings and declare Files, Story, Dependencies, and Done when, when it is compiled, then it compiles cleanly and each task carries its id, title, dependency edges, declared paths, Done-when checks, story ids, and verify-only flag. | 11 | "returns `kind: 'compiled'`, `checkPlan` returns no error, and each task carries its id, title, dependency edges, declared paths, Done-when checks, story ids, and verify-only flag" | diff-local |
| Story 4 happy: Given a marked plan whose tasks declare Files as `**Files:**`, `**Files**:`, or `**Files likely touched:**`, declare `**Files:** none` or `same as Task 2`, declare `**Story:** prerequisite` or `n/a`, set verify-only with `**Verify-only:** yes` or `**Type:** verification`, and include a `## Slices` manifest, when it is compiled, then it compiles cleanly with the declared paths, inherited paths, story ids, verify-only flags, and slice membership the plan skill defines for those forms. | 12 | "with a valid `## Slices` manifest returns `kind: 'compiled'` with the declared paths, inherited paths, story ids, verify-only flags, and slice membership" | diff-local |
| Story 4 happy: Given a marked plan containing `## Task Dependency Graph` and `## Task Graph` sections, when it is compiled, then neither section is a task, and each task's body, paths, Done-when checks, and digest stop at the next heading at its level or above. | 9, 10 | "`## Task Dependency Graph` and `## Task Graph` produce no task, and each task's body and digest stop at the next heading at its level or above" | diff-local |
| Story 4 happy: Given a marked plan where Task 3 declares `**Dependencies:** Tasks 1, 2`, Task 4 declares `**Dependencies:** Task 3 (schema)`, and Task 1 declares `**Dependencies:** none`, when it is compiled, then Task 3's edges are tasks 1 and 2, Task 4's edge is task 3, and Task 1 has none. | 11 | "gives Task 3 edges to tasks 1 and 2, Task 4 an edge to task 3, and Task 1 no edges" | diff-local |
| Story 4 happy: Given a marked plan whose tasks declare `**Story:**` values the plan skill allows today, including a free-form infrastructure label such as `repo release gate (shared helper)`, when it is compiled, then each Story declaration is accepted with the story ids today's grammar derives from it. | 10 | "`repo release gate (shared helper)`" | diff-local |
| Story 4 happy: Given a marked plan where one task declares paths on a `**Files likely touched:**` line, another on a `**Files:**` line, and a third names backticked paths only in its Steps prose, when commit-boundary scope containment reads the compiled plan, then the first two tasks' paths count as declarations and the third task has no declaration, as before this change. | 13 | "checks a staged path against the declared files of the first two tasks and treats the prose-only task as having no declaration" | diff-local |
| Story 4 negative: Given a marked plan with a task heading `### Task 1, 2: Shared`, `### Task 1-3: x`, `## Task 4: x` at level 2, `### T5 — x`, or `### Task 6` with no title, when it is compiled, then compilation fails with one error per heading naming its line and the violated rule, and none of these headings becomes a task. | 9 | "yields its own `CompileError` naming line and rule, and none appears as a task" | diff-local |
| Story 4 negative: Given a marked plan with an authored task, including one whose id begins with `rem-`, that lacks a Files, Story, Dependencies, or Done-when declaration, when it is compiled, then compilation fails naming the task id and each missing field. | 10 | "for an authored task with a numeric id and for an authored task whose id begins with `rem-`" | diff-local |
| Story 4 negative: Given a marked plan where a task depends on a task id the plan does not declare, when it is compiled, then compilation fails naming the task and the unknown dependency. | 11 | "A dependency on an undeclared id yields a `CompileError` naming the task and the unknown id" | diff-local |
| Story 4 negative: Given a marked plan whose dependency edges form a cycle, directly (Task 2 depends on Task 2), between two tasks, or through three or more tasks, when it is compiled, then compilation fails with an error naming every task in the cycle in dependency order. | 11 | "Self, two-task, and three-task cycle fixtures each yield one `CompileError` naming every task in the cycle in dependency order." | diff-local |
| Story 4 negative: Given a marked plan whose Dependencies line is a range (`Tasks 1-3`) or prose (`all prior tasks`), when it is compiled, then compilation fails naming the task and listing the accepted forms. | 11 | "`Tasks 1-3` and `all prior tasks` each yield a `CompileError` naming the task and listing the accepted forms." | diff-local |
| Story 4 negative: Given a marked plan with no task headings, when it is compiled, then compilation fails with a no-tasks error, and no consumer treats the plan as an empty task list. | 12 | "`validatePlanDoneWhen` each throw `PlanCompileFailure` for it rather than returning an empty result" | diff-local |
| Story 4 negative: Given a marked plan where two task headings carry the same id, when it is compiled, then compilation fails naming both lines. | 9 | "Two headings with the same id yield a `CompileError` naming both lines" | diff-local |
| Story 4 negative: Given a marked plan whose `## Slices` manifest names a task id that the compile refused or that does not exist, when it is compiled, then compilation fails naming the manifest row and the id. | 12 | "A manifest row naming an undeclared id or a refused heading's id yields a `CompileError` naming the manifest row and the id." | diff-local |
| Story 4 negative: Given a marked plan containing heading-shaped text such as `### Task 9: example` inside a fenced code block, when it is compiled, then that text is not a task and causes no error. | 9 | "`### Task 9: example` inside a fenced block yields no task and no error" | diff-local |
| Story 4 negative: Given a marked plan with several violations, when it is compiled, then every violation is reported in one result rather than only the first. | 9 | "returns one `kind: 'errors'` result listing every violation" | diff-local |
| Story 5 happy: Given a spec whose marked plan compiles cleanly and is within the plan task-count limit, when the spec is landed, then land accepts the plan. | 20 | "`landSpec` accepts a clean marked fixture within the task-count limit" | diff-local |
| Story 5 happy: Given a spec whose plan is unmarked, when the spec is landed, then land applies the same plan checks, in the same order, with the same outcome and gate id it produced before this change. | 15 | "after calling the Done-when, task-count, and slice rungs in the same order" | diff-local |
| Story 5 negative: Given a spec whose marked plan has compile errors, including a malformed Done-when tag or a slice violation, when the spec is landed, then land refuses it under one plan-compile gate id, the refusal lists every compile error with its line, task, and rule, and no commit is created. | 20 | "A marked fixture with heading, malformed `[tests]` tag, and slice violations is refused with `LandGateError.gate === 'plan-compile'`" | diff-local |
| Story 5 negative: Given a refusal whose error list is longer than the land-rejection event's reason bound, when the event is recorded, then the event reason is truncated at that bound while the refusal printed to the author still lists every error. | 20 | "the recorded event reason is truncated at that bound while the thrown error's message lists every error" | diff-local |
| Story 5 negative: Given a spec whose marked plan compiles cleanly but exceeds the plan task-count hard stop, when the spec is landed, then land refuses it under the existing task-count gate. | 20 | "A clean marked fixture over the task-count hard stop is refused with gate `plan-task-count`" | diff-local |
| Story 5 negative: Given a spec whose marked plan both has compile errors and exceeds the task-count hard stop, when the spec is landed, then land refuses it under the plan-compile gate, and the task-count and coherence checks are not reported. | 20 | "a message containing neither the task-count nor the coherence finding" | diff-local |
| Story 5 negative: Given a spec whose marked plan compiles cleanly and whose coherence artifact cites a task id that plan does not declare, when the spec is landed, then land refuses it naming the citation and the unresolvable id. | 20 | "A clean marked fixture whose coherence artifact cites an undeclared task id is refused with a message naming the citation and the id." | diff-local |
| Story 6 happy: Given a merged spec on the base branch with a marked plan that compiles cleanly and approved stories, when discovery vets it, then it is eligible for dispatch. | 21 | "`discoverBacklog` returns a clean marked fixture as eligible" | diff-local |
| Story 6 happy: Given a merged spec with an unmarked plan, when discovery vets it, then it is eligible or skipped exactly as it would have been before this change. | 15 | "over an eligible unmarked fixture returns it as eligible" | diff-local |
| Story 6 negative: Given a merged spec whose marked plan has compile errors, including a task with no dependency declaration, when discovery vets it, then it is not dispatched and daemon status shows a blocked entry with reason `plan-compile-failed` whose remedy lists every compile error. | 21 | "the daemon status blocked-specs output lists that slug with that reason and a remedy containing every compile error" | diff-local |
| Story 6 negative: Given a merged spec whose marked plan has no `**Dependencies:**` line anywhere, when discovery vets it, then its blocked entry has reason `plan-compile-failed`, not `no-dependency-tree`. | 21 | "A marked fixture with no `**Dependencies:**` line anywhere is blocked with reason `plan-compile-failed`, not `no-dependency-tree`" | diff-local |
| Story 6 negative: Given a blocked marked spec whose compile errors change on the base branch, when discovery next vets it, then the blocked entry's remedy lists the current errors even if the discovery log line for that slug is suppressed as a repeat. | 21 | "the second pass's remedy lists the new errors while the per-slug log line is not emitted again" | diff-local |
| Story 6 negative: Given a blocked marked spec whose plan is fixed on the base branch, when discovery next vets it, then it becomes eligible with no further operator action. | 21 | "After the fixture plan is fixed, the next `discoverBacklog` pass returns it as eligible." | diff-local |
| Story 7 happy: Given a build of a marked plan that compiles, when task seeding reads the plan, then the build proceeds with the compiled tasks. | 22 | "a build over a compiling marked fixture seeds its compiled tasks and proceeds" | diff-local |
| Story 7 negative: Given a build of a marked plan that was amended mid-build into a shape with compile errors, when task seeding next reads the plan, then the build raises one `needs-human` halt whose reason names the plan path and lists every compile error, and no task is marked done, reopened, or parked as a result. | 22 | "the next `build` completion predicate evaluation makes the conductor write exactly one `needs-human` halt whose reason names the plan path and each error" | diff-local |
| Story 7 negative: Given a build of a marked plan that does not compile, when any build consumer would otherwise read task structure, then no consumer proceeds as if the plan had zero tasks, and the build reports no "empty or missing plan" park. | 22 | "coverage-binding inputs, and coherence each throw `PlanCompileFailure` instead of proceeding with an empty task list" | diff-local |
| Story 7 negative: Given a halted build whose plan has been fixed, when the halt is cleared and the build re-dispatched, then it resumes from its recorded task progress, except that a task whose heading or body text changed in the fix is reopened under the existing reopen rule. | 22 | "admits a `plan_amendment` reopen for every task whose heading or body text changed in the fix, and admits none for any other task" | diff-local |
| Story 8 happy: Given a marked plan and a remediation gap, when the engine appends remediation tasks, then the appended tasks compile in strict mode as appended tasks with only the fields the remediation renderer emits, the plan's existing text is an unchanged byte prefix, and the seal accepts the amendment. | 19 | "`compilePlan` returns `kind: 'compiled'` in strict mode, `checkPlan` with the recorded ids returns no error, the original bytes are a prefix, and `isEngineAppendedRemediationAmendment` returns true" | diff-local |
| Story 8 happy: Given an unmarked plan and a remediation gap, when the engine appends remediation tasks, then the appended text, the resulting task ids, the authored-task count, and the seal's decision equal their goldens. | 19 | "equal to that appender's Task 2 append golden" | diff-local |
| Story 8 negative: Given a remediation append whose rendered tasks would not compile, when the append runs, then it fails with the compile errors named and the plan file is left byte-identical. | 19 | "A render that does not compile makes the append throw an error listing the compile errors, and the plan file is byte-identical afterwards." | diff-local |
| Story 8 negative: Given a marked plan's appended tail containing a non-task heading, when the seal checks the amendment, then it refuses it as it does today. | 19 | "returns false for a marked plan tail containing a non-task heading" | diff-local |
| Story 8 negative: Given a marked plan's appended tail containing a `### Task <id>:` heading whose id the engine did not record as appended, when the seal checks the amendment, then it refuses it as it does today. | 19 | "for a tail containing `### Task x:` whose id is not in the recorded appended ids" | diff-local |
| Story 9 happy: Given the same plan text read by consumers for two different features, when each applies its own protected-path filtering, then each gets its golden for its own feature. | 6 | "returns each of two feature descriptions' `foreignProtectedReferencesByTaskId` golden" | diff-local |
| Story 9 negative: Given a plan file whose text changes between two reads in one process, when it is compiled after the change, then the result reflects the new text, not the earlier result. | 3 | "`compilePlan` returns a result reflecting the new text when called with changed text in the same process" | diff-local |
| Story 9 negative: Given a plan compile that failed, when a different, valid plan text is compiled next in the same process, then the valid plan compiles cleanly. | 7 | "After `compilePlan` returns `kind: 'errors'` for one text, a valid text compiled next returns `kind: 'compiled'` in the same process." | diff-local |
| Story 9 negative: Given a build run, when plans are compiled, then no file under `.docs/` or `.pipeline/` is created or changed by compilation. | 3 | "A snapshot of `.docs/` and `.pipeline/` in a fixture worktree is byte-identical before and after compiling every fixture plan." | diff-local |
| Story 10 happy: Given the plan skill's task template and every task example it contains, when they are assembled into a marked plan and compiled, then the plan compiles cleanly in strict mode. | 24 | "passes only when `compilePlan` returns `kind: 'compiled'` and `checkPlan` returns no error" | diff-local |
| Story 10 happy: Given the plan skill's plan skeleton, when it is read, then it contains the format marker line before its first task heading. | 24 | "The test passes only when the skill's plan skeleton contains the `Plan-Format: 2` line before its first task heading." | diff-local |
| Story 10 negative: Given a plan skill that contains a task example the strict grammar refuses, when the skill-contract test runs, then it fails naming the example. | 24 | "The test fails naming the example when a task example in the skill does not compile in strict mode." | diff-local |
| Story 10 negative: Given a plan skill skeleton with no marker line, or with the marker after its first task heading, when the skill-contract test runs, then it fails naming the problem. | 24 | "The test fails naming the problem when the skill's plan skeleton lacks the `Plan-Format: 2` line" | diff-local |
| Story 10 negative: Given a marked fixture plan and its unmarked copy, when the base-commit goldens are captured for both, then their task ids, counts, and digests are identical, so engines without this change read a marked plan the same as its unmarked copy. | 25 | "hold identical task ids, `conductor.ts` authored-task count golden, and `planTaskDigests` values" | diff-local |

## Architecture Obligation Coverage

Every citable decision in the four ADRs this spec adds or amends is represented once.

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-10-10-single-two-mode-plan-compiler#D1 | task | task-23 | `findTaskStructureRegexes` over every `src/conductor/src/**/*.ts` file reports no finding. |
| adr-2026-10-10-single-two-mode-plan-compiler#D2 | task | task-7 | `compilePlan` reports `mode: 'strict'` for a fixture whose `Plan-Format: 2` line precedes the first task heading |
| adr-2026-10-10-single-two-mode-plan-compiler#D3 | task | task-9, task-10, task-11 | Each of `### Task 1, 2: Shared`, `### Task 1-3: x`, `## Task 4: x`, `### T5 — x`, and `### Task 6` yields its own `CompileError` naming line and rule |
| adr-2026-10-10-single-two-mode-plan-compiler#D4 | task | task-4, task-5 | compares every `planTaskDigests` value with its golden byte for byte |
| adr-2026-10-10-single-two-mode-plan-compiler#D5 | task | task-3, task-6 | A snapshot of `.docs/` and `.pipeline/` in a fixture worktree is byte-identical before and after compiling every fixture plan. |
| adr-2026-10-10-single-two-mode-plan-compiler#D6 | task | task-20, task-21, task-22 | is refused with `LandGateError.gate === 'plan-compile'` |
| adr-2026-10-10-single-two-mode-plan-compiler#D7 | task | task-19 | the original bytes are a prefix, and `isEngineAppendedRemediationAmendment` returns true |
| adr-2026-09-29-plan-slice-manifest#D1 | existing | none | `plan-slices.ts` parses the optional `## Slices` manifest table today; this feature keeps the grammar and only relocates the reader, pinned to goldens by Task 4. |
| adr-2026-09-29-plan-slice-manifest#D2 | task | task-4 | `validatePlanSlices` results |
| adr-2026-09-29-plan-slice-manifest#D3 | task | task-12 | `checkPlan` reports a task in no slice unless its id is in the supplied appended-id record |
| adr-2026-09-29-plan-slice-manifest#D4 | task | task-11 | `Tasks 1-3` and `all prior tasks` each yield a `CompileError` naming the task and listing the accepted forms. |
| adr-2026-09-29-plan-slice-manifest#D5 | task | task-20 | A marked fixture with heading, malformed `[tests]` tag, and slice violations is refused with `LandGateError.gate === 'plan-compile'` |
| adr-2026-09-29-plan-slice-manifest#D6 | existing | none | `coverage_binding` already re-validates slices through `validatePlanSlices`; it consumes the relocated reader unchanged. |
| adr-2026-09-29-plan-slice-manifest#D7 | no-change | none | This feature emits no slice-change event and does not alter `plan_slices_changed`. |
| adr-2026-09-29-plan-slice-manifest#D8 | no-change | none | `stacked_prs` stays disabled and its config keys are untouched; the plan is sliced but not stacked. |
| adr-2026-09-29-plan-slice-manifest#D9 | existing | none | `plan-slices-skill-contract.test.ts` already keeps the plan skill's slice grammar honest; Task 24 edits the skill and that test must keep passing. |
| adr-2026-08-21-review-bound-by-plan-done-when-criteria#D1 | task | task-10, task-20, task-21 | one check, or six checks, or whose check begins with the malformed tag `[tests]`, yields a `CompileError` naming the task and the rule |
| adr-2026-08-21-review-bound-by-plan-done-when-criteria#D2 | no-change | none | This feature does not touch the build_review `boundTo` contract field. |
| adr-2026-08-21-review-bound-by-plan-done-when-criteria#D3 | no-change | none | This feature does not change the build_review rubric reducer or `beyond` judgements. |
| adr-2026-08-21-review-bound-by-plan-done-when-criteria#D4 | no-change | none | This feature does not change the beyond-finding store. |
| adr-2026-08-21-review-bound-by-plan-done-when-criteria#D5 | no-change | none | This feature does not change daemon filing of beyond findings. |
| adr-2026-08-21-review-bound-by-plan-done-when-criteria#D6 | no-change | none | This feature does not change the `boundTo` contract statements or their spine events. |
| adr-2026-10-07-sliced-plan-story-ownership-and-stack-eligibility#D1 | no-change | none | Stacking stays disabled, so the ownership and eligibility rungs keep their existing engagement rule. |
| adr-2026-10-07-sliced-plan-story-ownership-and-stack-eligibility#D2 | task | task-4, task-10 | story ids, story line ids |
| adr-2026-10-07-sliced-plan-story-ownership-and-stack-eligibility#D3 | existing | none | `evaluateStackEligibility` in `plan-slices.ts` is unchanged; it reads story ownership from the relocated reader. |
| adr-2026-10-07-sliced-plan-story-ownership-and-stack-eligibility#D4 | no-change | none | No complexity sign-off line is added; stacked delivery is not approved for this feature. |
| adr-2026-10-07-sliced-plan-story-ownership-and-stack-eligibility#D5 | existing | none | Land and `coverage_binding` keep calling the same predicates from one config source; only their plan reader moves. |
| adr-2026-10-07-sliced-plan-story-ownership-and-stack-eligibility#D6 | existing | none | Ownership recording at `coverage_binding` is unchanged and engages only on a sliced, flag-on run. |
| adr-2026-10-07-sliced-plan-story-ownership-and-stack-eligibility#D7 | existing | none | `MAX_CHILD_ID` and `stacked_prs.max_slices` are unchanged by this feature. |

## Tasks

### Task 1: Capture base-commit goldens for every task-structure consumer

**Story:** 1
**Type:** infrastructure
**Dependencies:** none
**Files:** `src/conductor/test/engine/plan-compiler/capture-goldens.ts`, `src/conductor/test/fixtures/plan-compiler/goldens/`, `src/conductor/test/engine/plan-compiler/goldens.test.ts`

**Steps:**
1. Before any production change, write `capture-goldens.ts`. It reads (never writes) every committed plan in the repository plan directory at the base commit, records that list as `goldens/manifest.json`, and for each plan records every consumer's output: the shared parsers (`parsePlanTaskBodies`, `parsePlanTaskTitles`, `parsePlanTaskPaths` including `declaredTaskIds` and `hasFilesLineByTaskId`, `parsePlanTaskDoneWhen` including `malformedTaskIds`, `parsePlanTaskStoryIds`, `parsePlanTaskStoryLineIds`, `planTaskDigests`), `validatePlanTaskCount`, `validatePlanDoneWhen`, `autoheal.ts` `parsePlanTasks` and `parsePlanTaskVerifyOnly`, `validatePlanSlices`, `collectPlanCoverage`, and `planHasDependencyTree`, each by calling the exported function itself. For each inline, non-exported reader (`conductor.ts` authored-task count and growth-task existence check, `attribution-inputs.ts` task ids, `coherence-validator.ts` story map, task title, `**Story:**` line, and `**Type:**` line readings, `kickback-ledger.ts` task ids, the `artifacts.ts` completion regex, the `remediation-append.ts` and `remediation-task-append.ts` heading readers, the seal's tail-id reader), the script calls a verbatim copy of the whole enclosing function body, with a comment naming its source file and symbol. The script exports the key list as `BASE_CONSUMER_KEYS`.
2. Run it once at the base commit and commit one JSON golden per plan.
3. Write `goldens.test.ts`: every plan in `manifest.json` has a golden holding every key in `BASE_CONSUMER_KEYS`, and each copied function body occurs verbatim in its named source file at the base commit. Verify RED by deleting one golden, then GREEN.
4. Commit.

**Done when:**
- [test] `goldens.test.ts` asserts that every plan listed in `goldens/manifest.json` has a committed golden file holding one entry per key in `BASE_CONSUMER_KEYS`.
- [test] `goldens.test.ts` asserts each copied inline reader's whole function body occurs verbatim in the source file its comment names, as of the base commit, and that exported consumers were captured by calling the exported function.
- [test] `goldens.test.ts` fails, naming the consumer key and the plan, when a golden file or a consumer key is missing.
- The goldens commit precedes every commit that changes `src/conductor/src/engine/`, as shown by `git log --reverse` on this branch.

### Task 2: Divergent-shape fixtures, protected-path goldens, and a base-commit append record

**Story:** 1
**Type:** infrastructure
**Dependencies:** Task 1
**Files:** `src/conductor/test/fixtures/plan-compiler/plans/`, `src/conductor/test/fixtures/plan-compiler/specs/`, `src/conductor/test/fixtures/plan-compiler/goldens/`, `src/conductor/test/engine/plan-compiler/capture-goldens.ts`, `src/conductor/test/engine/plan-compiler/goldens.test.ts`

**Steps:**
1. Add fixture plans: multi-id `### Task 1, 2: Shared title`; bare `### Task 2`; `### T3 — x` and `### T4 – x`; a task heading inside a fenced block; a `## Task Dependency Graph` section; a last task followed by `## Verification` prose naming a backticked path; a plan with no dependency tree; and a canonical plan plus its copy carrying the line `Plan-Format: 2` above the first task heading.
2. Extend the capture script, still before any production change, to record for these fixtures: every key in `BASE_CONSUMER_KEYS`; and, under a separate `FIXTURE_ONLY_KEYS` list, `parsePlanTaskPaths(text, featureDesc)` `foreignProtectedReferencesByTaskId` for two named feature descriptions; for an unmarked fixture, the result of running each appender (`appendRemediationTasks` and the `remediation-task-append.ts` appender) followed by `isEngineAppendedRemediationAmendment` (appended bytes, appended task ids, authored-task count after append, seal decision); and, for unmarked fixture specs under `fixtures/plan-compiler/specs/` (each with stories, complexity, and coherence artifacts), `landSpec`'s gate id, outcome, and ordered plan-rung calls (recorded through an injectable rung-order seam, or by the order of rung errors on a fixture failing all three) and `discoverBacklog`'s eligibility and blocked reason.
3. Extend `goldens.test.ts` to assert every fixture has a golden with every consumer key, and that the protected-path, append, and entry-point goldens hold their recorded fields.
4. Capture at the base commit and commit.

**Done when:**
- [test] `goldens.test.ts` asserts each listed fixture under `src/conductor/test/fixtures/plan-compiler/plans/` has a committed golden with every consumer key.
- [test] The protected-path goldens hold `foreignProtectedReferencesByTaskId` for both named feature descriptions, the append golden holds appended bytes, appended task ids, the authored-task count, and the seal decision, and the entry-point goldens hold land's gate id, outcome, and rung order and discovery's verdict for each unmarked fixture spec.
- The fixture-goldens commit precedes every commit that changes `src/conductor/src/engine/`, as shown by `git log --reverse` on this branch.

### Task 3: Compiler core with an in-process memo

**Story:** 9
**Type:** infrastructure
**Dependencies:** Task 2
**Files:** `src/conductor/src/engine/plan-compiler/index.ts`, `src/conductor/test/engine/plan-compiler/compile-core.test.ts`

**Steps:**
1. Write failing tests: compiling text A then a changed text B in one process returns B's result; compiling every fixture plan over a fixture worktree leaves `.docs/` and `.pipeline/` byte-identical.
2. Verify RED.
3. Implement `compilePlan(text)` returning the frozen discriminated union, with mode `legacy` for every text (strict mode arrives in Task 7), memoized by `sha256(text)` in a module-level map. No filesystem access.
4. Verify GREEN and commit.

**Done when:**
- [test] `compilePlan` returns a result reflecting the new text when called with changed text in the same process, as asserted by the changed-text case in `compile-core.test.ts`.
- [test] A snapshot of `.docs/` and `.pipeline/` in a fixture worktree is byte-identical before and after compiling every fixture plan.

### Task 4: Legacy views for the shared parsers, with adapters

**Story:** 1
**Type:** refactor
**Dependencies:** Task 3
**Files:** `src/conductor/src/engine/plan-compiler/legacy-views.ts`, `src/conductor/src/engine/plan-compiler/digest.ts`, `src/conductor/src/engine/plan-task-parse.ts`, `src/conductor/src/engine/autoheal.ts`, `src/conductor/src/engine/plan-slices.ts`, `src/conductor/src/engine/plan-task-count.ts`, `src/conductor/src/engine/plan-done-when.ts`, `src/conductor/test/engine/plan-compiler/legacy-equivalence.test.ts`

**Steps:**
1. Write `legacy-equivalence.test.ts`: for every plan in `goldens/manifest.json` and every fixture, each shared-parser view's output equals its golden, with digests compared byte for byte. This test pins behavior; it passes at base by construction.
2. Move `TASK_HEADER_PATTERN`, its span rules, the field-line regexes, `planTaskDigests`, `parsePlanTasks`, `VERIFY_ONLY_LINE`, and the slice-manifest and Dependencies-line readers verbatim into `legacy-views.ts` and `digest.ts`. Turn the old exports into adapters over `compilePlan(text)` that return the legacy view. `validatePlanSlices`, `validatePlanTaskCount`, and `validatePlanDoneWhen` consume the compiled legacy view instead of matching headings.
3. Verify the equivalence test still passes and commit.

**Done when:**
- [test] `legacy-equivalence.test.ts` asserts that bodies, titles, declared paths with `declaredTaskIds` and `hasFilesLineByTaskId`, Done-when checks with `malformedTaskIds`, story ids, story line ids, verify-only flags, `parsePlanTasks` tasks, `validatePlanSlices` results, and `validatePlanTaskCount` task counts equal their goldens for every manifest plan and fixture.
- [test] The same test compares every `planTaskDigests` value with its golden byte for byte, including the multi-id, bare `Task N`, `T<n>` em-dash and en-dash, fenced-heading, and trailing `## Verification` fixtures.
- [test] For the trailing `## Verification` fixture, `parsePlanTaskBodies` and `planTaskDigests` end the last task at that heading while `parsePlanTaskPaths` still includes the backticked path named after it, each equal to its golden.
- [test] For the multi-id fixture, `parsePlanTaskBodies` returns two task ids and `parsePlanTasks` returns no task, each equal to its golden.
- [test] The equivalence test fails, naming the consumer key and the plan, when a golden is missing for a view it evaluates.

### Task 5: Legacy views for the ad-hoc readers

**Story:** 1
**Type:** refactor
**Dependencies:** Task 4
**Files:** `src/conductor/src/engine/plan-compiler/legacy-views.ts`, `src/conductor/test/engine/plan-compiler/legacy-equivalence.test.ts`

**Steps:**
1. Extend `legacy-equivalence.test.ts` with a key for each ad-hoc reader captured in Task 1.
2. Add one named view per reader, moving each regex verbatim: `authoredTaskCount`, `growthTaskExists(id)`, `attributionTaskIds`, `coherenceStoryMap`, `coherenceTaskTitles`, `coherenceStoryLine`, `coherenceTypeLine`, `planCoverage` (from `collectPlanCoverage`), `kickbackLedgerTaskIds`, `completionTaskHeadingPresent`, `hasDependencyTree`, `remediationAppendHeadings`, `remediationTaskAppendHeadings`, `sealTailTaskIds`. Callers move in slice 3.
3. Verify the views equal their goldens and commit.

**Done when:**
- [test] `legacy-equivalence.test.ts` asserts each ad-hoc view's output equals its golden for every manifest plan and fixture.
- [test] `legacyViews.authoredTaskCount` returns the golden count for the `## Task Dependency Graph` fixture, which counts that section as `conductor.ts` did.
- [test] `legacyViews.hasDependencyTree` returns `false` for the no-dependency-tree fixture, matching its golden.
- [test] `legacyViews.planCoverage` equals the `collectPlanCoverage` golden for every manifest plan and fixture.

### Task 6: Protected-path filtering applies the feature description after compilation

**Story:** 9
**Type:** refactor
**Dependencies:** Task 4
**Files:** `src/conductor/src/engine/plan-task-parse.ts`, `src/conductor/src/engine/plan-compiler/legacy-views.ts`, `src/conductor/test/engine/plan-compiler/protected-path-filter.test.ts`

**Steps:**
1. Write a test: one fixture plan text with the two named feature descriptions yields each description's protected-path golden from `parsePlanTaskPaths(text, featureDesc)`, in either call order, with one memo entry.
2. Split the foreign-protected-reference filter out of the compiled view so `parsePlanTaskPaths` applies `featureDesc` to the memoized result, keeping `featureDesc` out of the memo key.
3. Verify and commit.

**Done when:**
- [test] `protected-path-filter.test.ts` asserts that `parsePlanTaskPaths` over one fixture plan text returns each of two feature descriptions' `foreignProtectedReferencesByTaskId` golden, in either call order.
- [test] The same test asserts that `compilePlan` is called with the plan text alone, by checking the memo holds one entry after both calls.

### Task 7: Format marker selects strict mode, and failed compiles throw from adapters

**Story:** 3
**Type:** happy-path
**Dependencies:** Tasks 4, 5
**Files:** `src/conductor/src/engine/plan-compiler/marker.ts`, `src/conductor/src/engine/plan-compiler/index.ts`, `src/conductor/src/engine/plan-compiler/legacy-views.ts`, `src/conductor/src/engine/plan-task-parse.ts`, `src/conductor/src/engine/autoheal.ts`, `src/conductor/test/engine/plan-compiler/marker.test.ts`

**Steps:**
1. Write failing tests: a marker before the first task heading gives `mode: 'strict'`; no marker gives `mode: 'legacy'` with results equal to the fixture's goldens; inline, backticked, and fenced mentions are not markers and cause no error; a marker only after the first task heading, a duplicated marker, `Plan-Format: 3`, and `## Plan-Format: 2` each give a `CompileError` naming the line; each `plan-task-parse.ts` and `autoheal.ts` adapter throws `PlanCompileFailure` for a `kind: 'errors'` result; a failed compile followed by a valid text in one process compiles the valid text.
2. Verify RED.
3. Implement fence-aware detection of the exact whole line `Plan-Format: 2` in `marker.ts`, wire mode selection into `compilePlan`, and make every adapter and `legacyViews` reader throw `PlanCompileFailure` on `kind: 'errors'` through one helper in `index.ts`.
4. Verify GREEN and commit.

**Done when:**
- [test] `compilePlan` reports `mode: 'strict'` for a fixture whose `Plan-Format: 2` line precedes the first task heading, and `mode: 'legacy'` for its unmarked copy, as asserted in `marker.test.ts`.
- [test] For the unmarked copy, every legacy view returned through `compilePlan` equals that fixture's golden, and inline, backticked, and fenced mentions of `Plan-Format: 2` neither change the mode nor produce a `CompileError`.
- [test] A marker only after the first task heading yields a `CompileError` naming its line and stating it must precede the first task heading; a duplicated marker and `Plan-Format: 3` each yield a `CompileError` naming the line and the problem.
- [test] A `## Plan-Format: 2` heading yields a `CompileError` naming its line, and every adapter and `legacyViews` reader throws `PlanCompileFailure` for that plan rather than returning or counting a task for the heading.
- [test] After `compilePlan` returns `kind: 'errors'` for one text, a valid text compiled next returns `kind: 'compiled'` in the same process.

### Task 8: Task digests ignore the marker in both modes

**Story:** 3
**Type:** verification
**Verify-only:** yes
**Dependencies:** Tasks 7, 9
**Files:** `src/conductor/test/engine/plan-compiler/digest-mode.test.ts`

**Steps:**
1. Write pinning tests (Task 9's shared span rule already makes them pass; this task proves it): for the canonical fixture, each task digest is identical in strict mode (marked copy) and legacy mode (unmarked copy); a marked plan with recorded digests, compiled again after the marker line is removed, compiles in legacy mode and yields the same digest for every unchanged task, so `seedTaskStatus` reopens nothing.
2. Verify the tests pass against Task 9's implementation and commit them; no production change.

**Done when:**
- [test] `digest-mode.test.ts` asserts each task digest of the canonical marked fixture equals the digest of the same task in its unmarked copy.
- [test] After the marker is stripped from a marked fixture with recorded digests, `compilePlan` reports `mode: 'legacy'` and `seedTaskStatus` admits no `plan_amendment` reopen obligation for any task whose heading and body are unchanged.

### Task 9: Strict heading grammar and task spans

**Story:** 4
**Type:** happy-path
**Dependencies:** Task 7
**Files:** `src/conductor/src/engine/plan-compiler/strict.ts`, `src/conductor/src/engine/plan-compiler/index.ts`, `src/conductor/test/engine/plan-compiler/strict-headings.test.ts`

**Steps:**
1. Write failing tests: canonical `### Task <id>: <title>` headings compile with ids and titles; `## Task Dependency Graph` and `## Task Graph` are not tasks and end the preceding task's body and digest span; `### Task 1, 2: Shared`, `### Task 1-3: x`, `## Task 4: x`, `### T5 — x`, and `### Task 6` each yield one error naming line and rule and no task; duplicate ids name both lines; `### Task 9: example` inside a fence is ignored; a plan with several violations reports all of them.
2. Verify RED.
3. Implement the closed heading grammar and the single span rule in `strict.ts`, collecting every error.
4. Verify GREEN and commit.

**Done when:**
- [test] `compilePlan` on a canonical marked fixture returns tasks whose ids and titles match its `### Task <id>: <title>` headings, as asserted in `strict-headings.test.ts`.
- [test] In a marked fixture, `## Task Dependency Graph` and `## Task Graph` produce no task, and each task's body and digest stop at the next heading at its level or above.
- [test] Each of `### Task 1, 2: Shared`, `### Task 1-3: x`, `## Task 4: x`, `### T5 — x`, and `### Task 6` yields its own `CompileError` naming line and rule, and none appears as a task.
- [test] Two headings with the same id yield a `CompileError` naming both lines; `### Task 9: example` inside a fenced block yields no task and no error.
- [test] A marked fixture containing all of the above violations returns one `kind: 'errors'` result listing every violation.

### Task 10: Strict field declarations, Done-when shape, and the authored-task plan check

**Story:** 4
**Type:** happy-path
**Dependencies:** Task 9
**Files:** `src/conductor/src/engine/plan-compiler/strict.ts`, `src/conductor/src/engine/plan-compiler/plan-check.ts`, `src/conductor/test/engine/plan-compiler/strict-fields.test.ts`

**Steps:**
1. Write failing tests: declarations through `**Files:**`, `**Files**:`, `**Files likely touched:**`, `**Files:** none`, and `same as Task 2` yield the paths, inheritance, and `hasFilesLine` the legacy views define; `**Story:** prerequisite`, `n/a`, and `repo release gate (shared helper)` yield today's story ids; `**Verify-only:** yes` and `**Type:** verification` set verify-only; declared paths and Done-when checks stop at the task's span end; a Done-when block with no checks or a malformed `[tests]` tag is a `CompileError`; `checkPlan` with an empty appended-id record reports each missing Files, Story, Dependencies, or Done-when declaration on an authored task with a numeric id and on one with id `rem-x`, and reports nothing for a task whose id is in the record.
2. Verify RED.
3. Implement field extraction over the strict span (reusing the legacy field-line grammar and the `validatePlanDoneWhen` and `isMalformedTestTag` rules as compile errors) and `checkPlan(compiled, appendedTaskIds)`.
4. Verify GREEN and commit.

**Done when:**
- [test] `strict-fields.test.ts` asserts a marked fixture using every Files, Story (including `**Story:** prerequisite`, `n/a`, and `repo release gate (shared helper)`), and verify-only alias form compiles to tasks whose declared paths, inherited paths, `hasFilesLine`, story ids, and verify-only flags equal those the legacy views return for the unmarked copy.
- [test] In a marked fixture, each task's declared paths and Done-when checks stop at the next heading at its level or above.
- [test] A marked task whose Done-when block has no checks, one check, or six checks, or whose check begins with the malformed tag `[tests]`, yields a `CompileError` naming the task and the rule (2–5 checks, or the malformed tag and its check).
- [test] `checkPlan` returns one `CompileError` per missing Files, Story, Dependencies, or Done-when declaration, naming the task id and field, for an authored task with a numeric id and for an authored task whose id begins with `rem-`.
- [test] `checkPlan` returns no required-field error for a task whose id is in the supplied appended-id record and that carries only the remediation renderer's fields.

### Task 11: Strict dependency grammar, unknown references, and cycles

**Story:** 4
**Type:** happy-path
**Dependencies:** Task 10
**Files:** `src/conductor/src/engine/plan-compiler/dependencies.ts`, `src/conductor/src/engine/plan-compiler/strict.ts`, `src/conductor/src/engine/plan-compiler/index.ts`, `src/conductor/test/engine/plan-compiler/strict-dependencies.test.ts`

**Steps:**
1. Write failing tests: a canonical marked fixture compiles cleanly with every field; `Tasks 1, 2`, `Task 3 (schema)`, and `none` yield edges {1, 2}, {3}, and {}; `Tasks 1-3` and `all prior tasks` yield an error naming the task and the accepted forms; an undeclared id yields an error naming the task and the id; self, two-task, and three-task cycles each yield an error naming every task in the cycle in dependency order.
2. Verify RED.
3. Implement the adr-2026-09-29 D4 grammar for every `**Dependencies:**` line present in a strict plan (a missing line is a `checkPlan` required-field error, so appended tasks without one still compile), resolving references through `resolvePlanTaskReference`, plus cycle detection by depth-first search that reports the cycle path.
4. Verify GREEN and commit.

**Done when:**
- [test] A canonical marked fixture whose authored tasks declare Files, Story, Dependencies, and Done when returns `kind: 'compiled'`, `checkPlan` returns no error, and each task carries its id, title, dependency edges, declared paths, Done-when checks, story ids, and verify-only flag.
- [test] `strict-dependencies.test.ts` asserts `compilePlan` gives Task 3 edges to tasks 1 and 2, Task 4 an edge to task 3, and Task 1 no edges for the `Tasks 1, 2`, `Task 3 (schema)`, and `none` lines.
- [test] `Tasks 1-3` and `all prior tasks` each yield a `CompileError` naming the task and listing the accepted forms.
- [test] A dependency on an undeclared id yields a `CompileError` naming the task and the unknown id, and references resolve through `resolvePlanTaskReference`.
- [test] Self, two-task, and three-task cycle fixtures each yield one `CompileError` naming every task in the cycle in dependency order.

### Task 12: Strict slice manifest and empty plans

**Story:** 4
**Type:** negative-path
**Dependencies:** Task 11
**Files:** `src/conductor/src/engine/plan-compiler/strict.ts`, `src/conductor/src/engine/plan-compiler/plan-check.ts`, `src/conductor/src/engine/plan-slices.ts`, `src/conductor/src/engine/plan-task-count.ts`, `src/conductor/src/engine/plan-done-when.ts`, `src/conductor/src/engine/plan-compiler/legacy-views.ts`, `src/conductor/test/engine/plan-compiler/strict-slices.test.ts`

**Steps:**
1. Write failing tests: a marked fixture combining every alias form with a valid `## Slices` manifest compiles cleanly with the declared membership; a manifest row naming an undeclared id, or an id whose heading the compile refused, yields an error naming the row and the id; a marked plan with no task headings yields a no-tasks error and every adapter throws for it; `checkPlan` exempts from slice membership only tasks in the appended-id record.
2. Verify RED.
3. Validate the manifest against the strict task set (for a marked plan, `validatePlanSlices` at `coverage_binding` returns the compiled slice result and leaves the appended-task exemption to `checkPlan`), add the no-tasks rule, apply the appended-task membership exemption in `checkPlan`, and make `validatePlanSlices`, `validatePlanTaskCount`, and `validatePlanDoneWhen` throw `PlanCompileFailure` on a `kind: 'errors'` result.
4. Verify GREEN and commit.

**Done when:**
- [test] A marked fixture combining every Files, Story, and verify-only alias form with a valid `## Slices` manifest returns `kind: 'compiled'` with the declared paths, inherited paths, story ids, verify-only flags, and slice membership.
- [test] A manifest row naming an undeclared id or a refused heading's id yields a `CompileError` naming the manifest row and the id.
- [test] A marked plan with no task headings yields a no-tasks `CompileError`, and every adapter exported by `plan-task-parse.ts` and `autoheal.ts`, every `legacyViews` reader reached through `compilePlan`, `validatePlanSlices`, `validatePlanTaskCount`, and `validatePlanDoneWhen` each throw `PlanCompileFailure` for it rather than returning an empty result.
- [test] `checkPlan` reports a task in no slice unless its id is in the supplied appended-id record, and the compile reports a task in two slices, an empty slice, two slices with one position, and more than `MAX_CHILD_ID` slices, each as a `CompileError` naming the slice, and a dependency on a task in a later slice as a `CompileError` naming both tasks.

### Task 13: Scope containment counts only declaration lines in both modes

**Story:** 4
**Type:** happy-path
**Dependencies:** Task 10
**Files:** `src/conductor/src/engine/task-seed.ts`, `src/conductor/src/engine/plan-scope-containment.ts`, `src/conductor/test/engine/plan-compiler/containment-declarations.test.ts`

**Steps:**
1. Write a failing test: a marked plan with a `**Files likely touched:**` task, a `**Files:**` task, and a prose-only engine-appended remediation task (its id in the appended-id record, so `checkPlan` requires no Files line) is seeded through `seedTaskStatus`, then commit-boundary containment is evaluated for a staged path under each task.
2. Run it. If it already passes because Task 10's strict compile exposes `hasFilesLine` through the adapters, commit it as a pin with no production change; otherwise it is RED.
3. If RED, make `seedTaskStatus` read `hasFilesLine` from the compiled plan in both modes.
4. Verify GREEN and commit.

**Done when:**
- [test] `containment-declarations.test.ts` asserts `seedTaskStatus` on that marked fixture, with the prose-only task's id in the appended-id record, records declared `files` for the `**Files likely touched:**` and `**Files:**` tasks and no `files` for the prose-only task.
- [test] `plan-scope-containment` checks a staged path against the declared files of the first two tasks and treats the prose-only task as having no declaration, for both the marked fixture and its unmarked copy.

### Task 14: Single-owner audit core

**Story:** 2
**Type:** infrastructure
**Dependencies:** Task 4
**Files:** `src/conductor/test/engine/plan-compiler/single-owner-audit.ts`, `src/conductor/test/engine/plan-compiler/single-owner-audit.test.ts`, `src/conductor/test/fixtures/plan-compiler/audit/`

**Steps:**
1. Write `findTaskStructureRegexes(paths)` in a test helper: it reports path and line for every regular-expression literal and `RegExp(` source that anchors a Markdown heading followed by `Task` or `T<digit>`, or that is a bare level-3 heading anchor (`^###\s+` with nothing required after it), or contains a per-task field token (`**Files:**`, `**Files**:`, `**Files likely touched:**`, `**Dependencies:**`, `**Done when:**`, `**Story:**`, `**Type:**`, `**Verify-only:**`); it scans the paths it is given and skips paths ending `.test.ts` and files under `src/conductor/src/engine/plan-compiler/`.
2. Add audit fixture source files covering each pattern as a literal and as `RegExp(` source, and test that each is reported.
3. Verify and commit.

**Done when:**
- [test] `single-owner-audit.test.ts` asserts `findTaskStructureRegexes` reports path and line for each audit fixture file containing a heading followed by `Task` or by `T<digit>`, each as a regex literal and as `RegExp(` source, a bare `^###\s+` heading splitter, or one of the eight field tokens.
- [test] `findTaskStructureRegexes` does not report `*.test.ts` files or files under `plan-compiler/`.

### Task 15: Land, artifacts, and discovery read through the compiler

**Story:** 1
**Type:** refactor
**Dependencies:** Tasks 5, 12, 14
**Files:** `src/conductor/src/engine/engineer/land-spec.ts`, `src/conductor/src/engine/artifacts.ts`, `src/conductor/src/engine/daemon-backlog.ts`, `src/conductor/test/engine/plan-compiler/unmarked-entry-points.test.ts`

**Steps:**
1. Write tests (pins at base): landing an unmarked fixture spec gives the same gate id, outcome, and ordered sequence of plan rungs as in the Task 2 entry-point goldens; discovery over the no-dependency-tree fixture yields reason `no-dependency-tree`, and an eligible unmarked fixture stays eligible.
2. Replace the `artifacts.ts` completion regex, `planHasDependencyTree`'s regexes, and `collectPlanCoverage`'s heading splitter and field regexes with `legacyViews.completionTaskHeadingPresent`, `legacyViews.hasDependencyTree`, and `legacyViews.planCoverage` (compiled tasks for marked plans).
3. Verify and commit.

**Done when:**
- [test] `unmarked-entry-points.test.ts` asserts `landSpec` on an unmarked fixture spec returns the same `LandGateIdentifier` and outcome as its Task 2 entry-point golden, after calling the Done-when, task-count, and slice rungs in the same order, as recorded by a spy.
- [test] `discoverBacklog` over the unmarked no-dependency-tree fixture returns a blocked entry with reason `no-dependency-tree`, and over an eligible unmarked fixture returns it as eligible.
- [test] `collectPlanCoverage` returns its golden for every manifest plan and fixture, and `findTaskStructureRegexes` reports no finding in `land-spec.ts`, `artifacts.ts`, or `daemon-backlog.ts`.

### Task 16: Build progress readers move onto the compiler

**Story:** 1
**Type:** refactor
**Dependencies:** Tasks 5, 12, 14
**Files:** `src/conductor/src/engine/task-seed.ts`, `src/conductor/src/engine/task-progress.ts`, `src/conductor/src/engine/per-task-commit-floor.ts`, `src/conductor/src/engine/task-attribution.ts`, `src/conductor/src/engine/attribution-inputs.ts`, `src/conductor/src/engine/task-cli.ts`, `src/conductor/src/engine/conductor.ts`, `src/conductor/src/engine/kickback-ledger.ts`, `src/conductor/test/engine/plan-compiler/in-flight-resume.test.ts`

**Steps:**
1. Write a test: an unmarked fixture worktree whose `.pipeline/task-status.json` and digests were recorded at base resumes through `seedTaskStatus` with the sidecar unchanged, no reopen obligation, and no park decision.
2. Replace the `attribution-inputs.ts`, `conductor.ts` (authored-task count and growth-task existence), and `kickback-ledger.ts` regexes with their named legacy views for unmarked plans and the compiled tasks for marked plans; route the other readers through the adapters.
3. Verify and commit.

**Done when:**
- [test] `in-flight-resume.test.ts` asserts that after `seedTaskStatus` on the recorded unmarked fixture, `.pipeline/task-status.json` is byte-identical, no `plan_amendment` reopen obligation exists, and no park or `no_task_progress` decision is recorded.
- [test] The remediation growth cap computed by `conductor.ts` for the `## Task Dependency Graph` fixture equals the cap computed from its golden authored-task count.
- [test] `findTaskStructureRegexes` reports no finding in any file listed for this task.

### Task 17: build_review, coverage, and Done-when readers move onto the compiler

**Story:** 2
**Type:** refactor
**Dependencies:** Tasks 5, 12, 14
**Files:** `src/conductor/src/engine/build-review-inputs.ts`, `src/conductor/src/engine/build-review-scope-dependencies.ts`, `src/conductor/src/engine/build-review-test-bindings.ts`, `src/conductor/src/engine/build-review-adjudication-coordinator.ts`, `src/conductor/src/engine/coverage-binding-inputs.ts`, `src/conductor/src/engine/coverage-binding-envelope.ts`, `src/conductor/src/engine/coverage-binding-conflict-inputs.ts`, `src/conductor/src/engine/done-when-test-reference.ts`, `src/conductor/src/engine/plan-protected-targets.ts`

**Steps:**
1. Route each reader through the `plan-task-parse.ts` adapters, or through `compilePlan` plus the Task 7 helper that throws `PlanCompileFailure` on `kind: 'errors'`; remove any local field regex.
2. Run the existing tests for these modules; they must pass unchanged.
3. Commit.

**Done when:**
- The existing test files for each listed module pass with no assertion changed, as shown by the diff touching none of their `expect(` lines.
- [test] `findTaskStructureRegexes` reports no finding in any production file listed for this task.

### Task 18: Coherence, prd_audit, as-built, and remediation-context readers move onto the compiler

**Story:** 2
**Type:** refactor
**Dependencies:** Tasks 5, 12, 14
**Files:** `src/conductor/src/engine/engineer/coherence-validator.ts`, `src/conductor/src/engine/prd-audit-contract.ts`, `src/conductor/src/engine/prd-audit-projection.ts`, `src/conductor/src/engine/as-built-contract.ts`, `src/conductor/src/engine/as-built-projection.ts`, `src/conductor/src/engine/architecture-obligation-coverage.ts`, `src/conductor/src/engine/remediation-context-pointers.ts`, `src/conductor/src/engine/remediation-hints.ts`, `src/conductor/src/engine/remediation-projection.ts`, `src/conductor/src/engine/remediation-plan-contract.ts`, `src/conductor/src/engine/engineer/spec-commit-message.ts`

**Steps:**
1. Replace `coherence-validator.ts`'s task-heading and `**Story:**`/`**Type:**` line regexes with `legacyViews.coherenceStoryMap`, `coherenceTaskTitles`, `coherenceStoryLine`, and `coherenceTypeLine` for unmarked plans and the compiled tasks for marked plans; route the others through the adapters, and have any direct `compilePlan` caller throw through the Task 7 helper on `kind: 'errors'`.
2. Run the existing tests for these modules; they must pass unchanged.
3. Commit.

**Done when:**
- The existing test files for each listed module pass with no assertion changed, as shown by the diff touching none of their `expect(` lines.
- [test] `findTaskStructureRegexes` reports no finding in any production file listed for this task.

### Task 19: Remediation append and the seal on both plan modes

**Story:** 8
**Type:** happy-path
**Dependencies:** Tasks 10, 11, 12, 14
**Files:** `src/conductor/src/engine/remediation-append.ts`, `src/conductor/src/engine/remediation-task-append.ts`, `src/conductor/src/engine/protected-artifact-seal.ts`, `src/conductor/test/engine/plan-compiler/remediation-append-modes.test.ts`

**Steps:**
1. Write failing tests: appending to a marked fixture yields a plan that compiles strictly, keeps the original bytes as a prefix, passes `checkPlan` with the recorded ids, and is accepted by `isEngineAppendedRemediationAmendment`; appending to the unmarked fixture matches the Task 2 append golden; a forced non-compiling render throws naming the errors and leaves the plan file byte-identical; a marked tail with a non-task heading, or with `### Task x:` not in the record, is refused.
2. Verify RED.
3. Make the appenders render canonical `### Task <id>: <title>` remediation tasks, recompile before writing, and throw on compile errors; make the seal take tail ids from `legacyViews.sealTailTaskIds` (unmarked) or the compiled tasks (marked) while keeping its non-task-heading refusal.
4. Verify GREEN and commit.

**Done when:**
- [test] `remediation-append-modes.test.ts` asserts that after `appendRemediationTasks` on a marked fixture, `compilePlan` returns `kind: 'compiled'` in strict mode, `checkPlan` with the recorded ids returns no error, the original bytes are a prefix, and `isEngineAppendedRemediationAmendment` returns true.
- [test] Appending to the unmarked fixture with each appender (`appendRemediationTasks` and the `remediation-task-append.ts` appender) produces appended bytes, task ids, a `legacyViews.authoredTaskCount`, and a seal decision equal to that appender's Task 2 append golden.
- [test] A render that does not compile makes the append throw an error listing the compile errors, and the plan file is byte-identical afterwards.
- [test] `isEngineAppendedRemediationAmendment` returns false for a marked plan tail containing a non-task heading, and for a tail containing `### Task x:` whose id is not in the recorded appended ids.
- [test] `findTaskStructureRegexes` reports no finding in any production file listed for this task.

### Task 20: Land refuses a marked plan under the plan-compile gate

**Story:** 5
**Type:** negative-path
**Dependencies:** Tasks 12, 15
**Files:** `src/conductor/src/engine/engineer/land-spec.ts`, `src/conductor/test/engine/plan-compiler/land-plan-compile.test.ts`

**Steps:**
1. Write failing tests: a clean marked plan lands; a multi-violation marked plan including a malformed `[tests]` tag and a slice violation is refused under `plan-compile` with every error listed and no commit; a long error list is truncated only in the land-rejection event reason; a clean marked plan over the task-count hard stop is refused under `plan-task-count`; a fixture with compile errors, an over-limit count, and a coherence defect reports only `plan-compile`; a clean marked plan whose coherence artifact cites an undeclared id is refused naming the citation and id.
2. Verify RED.
3. Add `'plan-compile'` to `LandGateIdentifier`; for a plan that is marked or whose compile returns `kind: 'errors'` (a misplaced or malformed marker line), replace the Done-when, task-count, and slice rungs with `compilePlan` plus `checkPlan` (with no appended ids), then `validatePlanTaskCount`, keeping every other rung (stories reference and approval, `stacked-delivery`, coherence) in its existing position; keep unmarked plans on today's ordered rungs.
4. Verify GREEN and commit.

**Done when:**
- [test] `land-plan-compile.test.ts` asserts `landSpec` accepts a clean marked fixture within the task-count limit.
- [test] A marked fixture with heading, malformed `[tests]` tag, and slice violations is refused with `LandGateError.gate === 'plan-compile'`, a message listing every error's line, task, and rule, and no new commit.
- [test] For an error list longer than the land-rejection event's reason bound, the recorded event reason is truncated at that bound while the thrown error's message lists every error.
- [test] A clean marked fixture over the task-count hard stop is refused with gate `plan-task-count`, and a fixture with compile errors, an over-limit count, and a coherence defect is refused with gate `plan-compile` and a message containing neither the task-count nor the coherence finding.
- [test] A clean marked fixture whose coherence artifact cites an undeclared task id is refused with a message naming the citation and the id.

### Task 21: Discovery blocks a marked plan that does not compile

**Story:** 6
**Type:** negative-path
**Dependencies:** Tasks 12, 15
**Files:** `src/conductor/src/engine/daemon-backlog.ts`, `src/conductor/test/engine/plan-compiler/discovery-plan-compile.test.ts`

**Steps:**
1. Write failing tests: a clean marked fixture with approved stories is eligible; a marked fixture in which one task lacks a Dependencies line, and one with a malformed Done-when block, are blocked with reason `plan-compile-failed` and a remedy listing every error; the daemon status blocked-specs output lists that slug and reason; a marked fixture with no Dependencies line anywhere gets `plan-compile-failed`, not `no-dependency-tree`; changing the errors between two passes updates the remedy on the second pass even when the log line is suppressed; fixing the plan makes it eligible on the next pass.
2. Verify RED.
3. Add `'plan-compile-failed'` to `BlockedSpecItem.reason`; for a plan that is marked or whose compile returns `kind: 'errors'`, vet with `compilePlan` and `checkPlan` (with no appended ids) before the dependency-tree check, recomputing the remedy every pass.
4. Verify GREEN and commit.

**Done when:**
- [test] `discovery-plan-compile.test.ts` asserts `discoverBacklog` returns a clean marked fixture as eligible.
- [test] A marked fixture in which one task lacks a `**Dependencies:**` line is returned as a blocked entry with reason `plan-compile-failed` whose remedy names that task's missing declaration and every other compile error, and the daemon status blocked-specs output lists that slug with that reason and a remedy containing every compile error.
- [test] A marked fixture with no `**Dependencies:**` line anywhere is blocked with reason `plan-compile-failed`, not `no-dependency-tree`, and one with an empty Done-when block is blocked with reason `plan-compile-failed`.
- [test] When the fixture's errors change between two `discoverBacklog` passes, the second pass's remedy lists the new errors while the per-slug log line is not emitted again.
- [test] After the fixture plan is fixed, the next `discoverBacklog` pass returns it as eligible.

### Task 22: A marked plan that stops compiling halts the build once

**Story:** 7
**Type:** negative-path
**Dependencies:** Tasks 12, 16, 17, 18, 19
**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/src/engine/task-seed.ts`, `src/conductor/src/engine/artifacts.ts`, `src/conductor/src/engine/build-review-halt-render.ts`, `src/conductor/src/engine/repair-restage.ts`, `src/conductor/test/engine/plan-compiler/build-compile-halt.test.ts`

**Steps:**
1. Write failing tests: a compiling marked fixture seeds and proceeds; a build that seeded a compiling marked plan, whose plan is then amended into a shape with a compile error or a missing required field, writes one `needs-human` halt at the next seeding whose reason names the plan path and every error, with `.pipeline/task-status.json` unchanged and no park; for the compile-error variant every build reader of task structure (`seedTaskStatus`, `task-progress`, autoheal evidence derivation, `per-task-commit-floor`, `task-attribution`, `build-review-inputs`, remediation append, the seal's tail-id reader, coverage-binding inputs, coherence) throws `PlanCompileFailure`; after the fix and halt clear, the build resumes and reopens only tasks whose text changed.
2. Verify RED.
3. In `seedTaskStatus`, for a plan that is marked or fails to compile, run `checkPlan` with the engine's appended-id record before any digest comparison and raise `PlanCompileFailure` on its errors (unmarked plans never run `checkPlan`). Build-entry seeding happens in the `build` completion predicate in `artifacts.ts` (which today turns seed errors into `done: false`), at the dispatch boundary in `build-review-halt-render.ts`, and in `repair-restage.ts`; make each propagate `PlanCompileFailure` as a typed `plan-compile-failed` result, and have `conductor.ts` turn that result into one `writeHaltMarker(reason, 'needs-human')` instead of a failed-completion retry.
4. Verify GREEN and commit.

**Done when:**
- [test] `build-compile-halt.test.ts` asserts a build over a compiling marked fixture seeds its compiled tasks and proceeds.
- [test] After a build seeds a compiling marked plan and the plan is amended into a shape with a compile error or a missing Files line, the next `build` completion predicate evaluation makes the conductor write exactly one `needs-human` halt whose reason names the plan path and each error; `.pipeline/task-status.json` is byte-identical, `.pipeline/engine-state.json` gains no `plan_amendment` obligation, and no auto-park, `no_task_progress`, failed-completion retry, or empty-plan decision is recorded.
- [test] For the variant amended into a compile error, `seedTaskStatus`, task progress, autoheal evidence derivation, the per-task commit floor, task attribution, build_review inputs, remediation append, the seal's tail-id reader, coverage-binding inputs, and coherence each throw `PlanCompileFailure` instead of proceeding with an empty task list.
- [test] After the plan is fixed and the halt cleared, the re-dispatched build keeps recorded task statuses, admits a `plan_amendment` reopen for every task whose heading or body text changed in the fix, and admits none for any other task.

### Task 23: The whole engine passes the single-owner audit, and consumers agree on task ids

**Story:** 2
**Type:** happy-path
**Dependencies:** Tasks 13, 16, 17, 18, 19, 20, 21, 22
**Files:** `src/conductor/test/engine/plan-compiler/single-owner-audit.test.ts`, `src/conductor/test/engine/plan-compiler/cross-consumer-ids.test.ts`

**Steps:**
1. Extend the audit test to run `findTaskStructureRegexes` over every `src/conductor/src/**/*.ts` file.
2. Write a cross-consumer test: for one marked fixture, the land compile, discovery vetting, `seedTaskStatus`, autoheal evidence derivation, remediation append's recompile, the seal's tail-id reader, build_review inputs, the coverage-binding inputs, `collectPlanCoverage`, and coherence all report the same task id set.
3. Verify and commit.

**Done when:**
- [test] `findTaskStructureRegexes` over every `src/conductor/src/**/*.ts` file reports no finding.
- [test] The engine-wide audit test fails, naming the path and line, when an audit fixture file containing a `Task` heading regex is added to the set of files it scans.
- [test] `cross-consumer-ids.test.ts` asserts that for one marked fixture, land, discovery, `seedTaskStatus`, autoheal evidence derivation, remediation append, the seal's tail-id reader, build_review inputs, coverage-binding inputs, `collectPlanCoverage`, and coherence report an identical task id set.

### Task 24: The plan skill stamps the marker and authors the strict shape

**Story:** 10
**Type:** happy-path
**Dependencies:** Task 12
**Files:** `skills/plan/SKILL.md`, `src/conductor/test/plan-compiler-skill-contract.test.ts`

**Steps:**
1. Write a failing skill-contract test: it extracts the skill's task template and each `### Task` example block, assembles each into its own plan with `Plan-Format: 2` (so examples that reuse ids do not collide), and requires a clean strict compile and `checkPlan`; it requires the plan skeleton to contain `Plan-Format: 2` before its first task heading; otherwise it fails naming the example or the skeleton problem.
2. Verify RED.
3. Update `skills/plan/SKILL.md`: add `Plan-Format: 2` to the plan skeleton header, state the strict heading shape and required fields, and make every example strict-clean.
4. Verify GREEN and commit.

**Done when:**
- [test] `plan-compiler-skill-contract.test.ts` compiles the plan skill's template and examples as a marked plan and passes only when `compilePlan` returns `kind: 'compiled'` and `checkPlan` returns no error.
- [test] The test fails naming the example when a task example in the skill does not compile in strict mode.
- [test] The test fails naming the problem when the skill's plan skeleton lacks the `Plan-Format: 2` line or places it after its first task heading.
- [test] The test passes only when the skill's plan skeleton contains the `Plan-Format: 2` line before its first task heading.

### Task 25: A marked plan reads the same as its unmarked copy on engines without this change

**Story:** 10
**Type:** negative-path
**Dependencies:** Task 2
**Files:** `src/conductor/test/engine/plan-compiler/marker-compat.test.ts`

**Steps:**
1. Write a test comparing the base-commit goldens of the canonical marked fixture and its unmarked copy (captured in Task 2).
2. Verify GREEN and commit.

**Done when:**
- [test] `marker-compat.test.ts` asserts the base-commit goldens of the marked canonical fixture and its unmarked copy hold identical task ids, `conductor.ts` authored-task count golden, and `planTaskDigests` values.
- [test] The test fails naming the differing consumer key when the two goldens differ.

## Task Dependency Graph

```
1 ── 2 ─┬─ 3 ── 4 ─┬─ 5 ─┬─ 7 ─┬─ 9 ── 10 ─┬─ 11 ── 12 ─┬─ 20 (also 15)
        │          │     │     └─ 8 (also 9)├─ 13        ├─ 21 (also 15)
        │          │     │                  └─ 19 (11, 12, 14)   ├─ 22 (also 16, 17, 18, 19)
        │          ├─ 6  ├─ 15 (also 14)                 └─ 24
        │          └─ 14 ├─ 16 (also 14)
        │                ├─ 17 (also 14)
        │                └─ 18 (also 14)
        └─ 25
13, 16, 17, 18, 19, 20, 21, 22 ── 23
12 ── 15, 16, 17, 18 (in addition to 5 and 14)
```

## Integration Points

- After Task 5: every legacy view equals its golden; no consumer has moved yet.
- After Task 12: a marked plan compiles or fails with named errors, but no entry point refuses yet.
- After Tasks 20–22: land, discovery, and the build each refuse a non-compiling marked plan.
- After Task 23: every consumer reads through the compiler, and the audit enforces it engine-wide.

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic
- [ ] Tasks do not invalidate each other's fixtures or assertions
