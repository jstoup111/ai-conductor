**Status:** Accepted

# Stories: Plan task structure becomes one strict compiled contract

Track: technical (no PRD). Tier: L.
Architecture: `.docs/decisions/architecture-review-plan-task-dependencies-should-be-a-machine-readabl.md`
Governing decision: `adr-2026-10-10-single-two-mode-plan-compiler` D1-D7.
Source: jstoup111/ai-conductor#623

Terms:
- A **marked** plan carries the format marker: an exact whole line, outside any fenced block,
  that selects strict mode. An **unmarked** plan has no such line and compiles in legacy mode. A
  plan whose marker line is misplaced, duplicated, of an unknown version, or written as a heading is
  neither: it fails compilation, and land, discovery, and the build refuse it as they refuse a
  marked plan that does not compile.
- A **golden** is a consumer's output for one plan, captured by running that consumer's code at
  the base commit of this change, before any consumer moves, and committed as a test fixture.
- An **appended task** is a task whose id the engine recorded when it appended remediation tasks.
  Every other task is an **authored task**, whatever its id looks like. The engine's record is
  not part of the plan text: the plan check applies it to the compiled plan, and a required-field
  violation it then finds on an authored task is reported as a plan-compile error.

## Story 1: Unmarked plans behave exactly as they did before the upgrade

**Requirement:** adr-2026-10-10-single-two-mode-plan-compiler D4

As the operator, I want every plan authored before this change to keep producing the same task
ids, fields, counts, and digests in every engine consumer, so that no in-flight build or
merged-unbuilt spec changes its verdict when the engine upgrades.

### Acceptance Criteria

#### Happy Path
- Given any plan committed under `.docs/plans/` at the base of this change, when each engine consumer that reads task structure evaluates it after the change, then its result (task ids, titles, bodies, declared paths, Done-when checks, story ids, verify-only flags, slices, and task counts) equals that consumer's golden for that plan.
- Given any plan committed under `.docs/plans/` at the base of this change, when its task digests are computed after the change, then every digest is byte-identical to its golden.
- Given an unmarked plan with a heading `### Task 1, 2: Shared title`, when the consumers that read it as two tasks and the consumer that read it as no task each evaluate it, then each returns its golden.
- Given an unmarked plan containing a `## Task Dependency Graph` section, when the authored-task count that sets the remediation growth cap is computed, then it equals its golden, which counts that section.

#### Negative Paths
- Given an unmarked plan whose task headings use `T<n> —` separators, bare `### Task 2` headings, and a task heading inside a fenced code block, when every consumer evaluates it, then each consumer's result equals its golden and none reports a task its golden does not contain.
- Given an unmarked plan whose last task is followed by plan-level `## Verification` prose, when task bodies, declared paths, and digests are computed, then each equals its golden: bodies and digests stop at that heading, and declared paths still include prose paths found after it.
- Given an in-flight build of an unmarked plan whose task statuses and digests were recorded before the upgrade, when the build resumes on the upgraded engine, then the task-status sidecar is unchanged, no task is reopened, and no task or feature is parked.
- Given an unmarked plan that has no `**Dependencies:**` line and no `## Task Dependency Graph` section, when daemon discovery vets it, then it is skipped with reason `no-dependency-tree`, as before the change.
- Given a consumer view for which no golden fixture exists, when the equivalence test runs, then it fails naming the consumer and the plan.

### Done When
- [ ] [test] Goldens for every consumer over every plan committed under `.docs/plans/` are captured from the base commit and committed as fixtures before any consumer is migrated.
- [ ] [test] An equivalence test compares every legacy view's output with its golden, digests byte for byte, and fails on any difference or missing golden.
- [ ] [test] Fixture plans cover multi-id headings, bare `Task N`, `T<n>` with em-dash and en-dash separators, fenced task headings, `## Task Dependency Graph`, and trailing plan-level sections, each with per-consumer goldens.

## Story 2: Only the plan compiler recognizes task headings

**Requirement:** adr-2026-10-10-single-two-mode-plan-compiler D1

As the operator, I want exactly one engine module to decide what a plan's tasks are, so that a
change to the grammar cannot leave some consumers on an older reading.

### Acceptance Criteria

#### Happy Path
- Given the engine source after this change, when the single-owner audit runs, then it passes.
- Given a marked plan, when the land check, discovery vetting, task seeding, evidence derivation, remediation append, the seal's remediation-tail check, build_review inputs, and the coherence and coverage checks each read it, then they all report the same task id set.

#### Negative Paths
- Given an engine source file outside the compiler module containing a regular expression literal or `RegExp` source that anchors a heading followed by `Task` or `T<digit>`, when the single-owner audit runs, then it fails naming that file and line.
- Given an engine source file outside the compiler module containing a regular expression for a per-task field token (`**Files:**`, `**Files**:`, `**Files likely touched:**`, `**Dependencies:**`, `**Done when:**`, `**Story:**`, `**Type:**`, or `**Verify-only:**`), when the single-owner audit runs, then it fails naming that file and line.
- Given a test file, or the compiler module itself, containing such patterns, when the single-owner audit runs, then those files are not reported.

### Done When
- [ ] [test] The single-owner audit fails on a fixture source file for each heading and field pattern above and names its path and line.
- [ ] [test] The single-owner audit passes on the engine source tree after this change.
- [ ] [test] For one marked fixture plan, land, discovery, task seeding, evidence derivation, the seal, build_review inputs, and coherence report the same task id set.

## Story 3: The format marker selects strict mode

**Requirement:** adr-2026-10-10-single-two-mode-plan-compiler D2

As the operator, I want a plan to opt into the strict grammar with one plain line in its header,
so that new plans get strict checking while every older plan stays in legacy mode.

### Acceptance Criteria

#### Happy Path
- Given a plan whose header has the format marker line before the first task heading, when it is compiled, then it compiles in strict mode.
- Given a plan with no format marker line, when it is compiled, then it compiles in legacy mode with the results of Story 1.
- Given a plan whose prose mentions the marker inline or in backticks, or only inside a fenced block, when it is compiled, then that mention is neither a marker nor an error, and the plan's mode is decided only by whole-line markers outside fences.

#### Negative Paths
- Given a plan whose only format marker line appears after the first task heading, when it is compiled, then compilation fails with an error naming the marker's line and stating that the marker must precede the first task heading.
- Given a plan that has the format marker line twice, or a marker naming an unknown format version, when it is compiled, then compilation fails with an error naming the line and the problem.
- Given a plan that writes the marker as a Markdown heading, when it is compiled, then compilation fails naming that line, and no consumer counts that heading as a task.
- Given a marked plan whose marker line is removed by an operator reseal mid-build, when the build next reads the plan, then it compiles in legacy mode, and the digest of every task whose heading and body did not change equals its recorded digest, so no finished task is reopened.

### Done When
- [ ] [test] Compiling marked and unmarked fixtures reports strict and legacy mode respectively.
- [ ] [test] Misplaced, duplicated, unknown-version, and heading-form markers each produce a compile error naming the line; inline, backticked, and fenced mentions produce none.
- [ ] [test] For a canonical fixture, task digests are identical with and without the marker line, in both modes.

## Story 4: Strict mode accepts the canonical plan shape and refuses every other shape

**Requirement:** adr-2026-10-10-single-two-mode-plan-compiler D3

As the operator, I want marked plans to have one task heading shape and required fields, so that
heading drift becomes a named error instead of a phantom task, a missing task, or a false park.

### Acceptance Criteria

#### Happy Path
- Given a marked plan whose authored tasks use `### Task <id>: <title>` headings and declare Files, Story, Dependencies, and Done when, when it is compiled, then it compiles cleanly and each task carries its id, title, dependency edges, declared paths, Done-when checks, story ids, and verify-only flag.
- Given a marked plan whose tasks declare Files as `**Files:**`, `**Files**:`, or `**Files likely touched:**`, declare `**Files:** none` or `same as Task 2`, declare `**Story:** prerequisite` or `n/a`, set verify-only with `**Verify-only:** yes` or `**Type:** verification`, and include a `## Slices` manifest, when it is compiled, then it compiles cleanly with the declared paths, inherited paths, story ids, verify-only flags, and slice membership the plan skill defines for those forms.
- Given a marked plan containing `## Task Dependency Graph` and `## Task Graph` sections, when it is compiled, then neither section is a task, and each task's body, paths, Done-when checks, and digest stop at the next heading at its level or above.
- Given a marked plan where Task 3 declares `**Dependencies:** Tasks 1, 2`, Task 4 declares `**Dependencies:** Task 3 (schema)`, and Task 1 declares `**Dependencies:** none`, when it is compiled, then Task 3's edges are tasks 1 and 2, Task 4's edge is task 3, and Task 1 has none.
- Given a marked plan whose tasks declare `**Story:**` values the plan skill allows today, including a free-form infrastructure label such as `repo release gate (shared helper)`, when it is compiled, then each Story declaration is accepted with the story ids today's grammar derives from it.
- Given a marked plan where one task declares paths on a `**Files likely touched:**` line, another on a `**Files:**` line, and a third names backticked paths only in its Steps prose, when commit-boundary scope containment reads the compiled plan, then the first two tasks' paths count as declarations and the third task has no declaration, as before this change.

#### Negative Paths
- Given a marked plan with a task heading `### Task 1, 2: Shared`, `### Task 1-3: x`, `## Task 4: x` at level 2, `### T5 — x`, or `### Task 6` with no title, when it is compiled, then compilation fails with one error per heading naming its line and the violated rule, and none of these headings becomes a task.
- Given a marked plan with an authored task, including one whose id begins with `rem-`, that lacks a Files, Story, Dependencies, or Done-when declaration, when it is compiled, then compilation fails naming the task id and each missing field.
- Given a marked plan where a task depends on a task id the plan does not declare, when it is compiled, then compilation fails naming the task and the unknown dependency.
- Given a marked plan whose dependency edges form a cycle, directly (Task 2 depends on Task 2), between two tasks, or through three or more tasks, when it is compiled, then compilation fails with an error naming every task in the cycle in dependency order.
- Given a marked plan whose Dependencies line is a range (`Tasks 1-3`) or prose (`all prior tasks`), when it is compiled, then compilation fails naming the task and listing the accepted forms.
- Given a marked plan with no task headings, when it is compiled, then compilation fails with a no-tasks error, and no consumer treats the plan as an empty task list.
- Given a marked plan where two task headings carry the same id, when it is compiled, then compilation fails naming both lines.
- Given a marked plan whose `## Slices` manifest names a task id that the compile refused or that does not exist, when it is compiled, then compilation fails naming the manifest row and the id.
- Given a marked plan containing heading-shaped text such as `### Task 9: example` inside a fenced code block, when it is compiled, then that text is not a task and causes no error.
- Given a marked plan with several violations, when it is compiled, then every violation is reported in one result rather than only the first.

### Done When
- [ ] [test] A canonical marked fixture, plus one fixture per accepted alias form, compiles into tasks whose ids, titles, edges, paths, Done-when checks, stories, verify-only flags, and slice membership match the declarations.
- [ ] [test] Each refused heading shape, each missing required field, and each unknown, duplicate, or manifest-mismatched id produces its own error naming line, task, and rule.
- [ ] [test] Self, two-task, and three-task dependency-cycle fixtures each fail compilation with an error naming every task in the cycle.
- [ ] [test] An authored `rem-` task with no Files, Story, or Dependencies declaration fails compilation naming each missing field.

## Story 5: Land refuses a marked plan that does not compile

**Requirement:** adr-2026-10-10-single-two-mode-plan-compiler D6

As the operator, I want a malformed marked plan refused when the spec is landed, so that the
mistake is fixed while the author is still authoring, not discovered during a build.

### Acceptance Criteria

#### Happy Path
- Given a spec whose marked plan compiles cleanly and is within the plan task-count limit, when the spec is landed, then land accepts the plan.
- Given a spec whose plan is unmarked, when the spec is landed, then land applies the same plan checks, in the same order, with the same outcome and gate id it produced before this change.

#### Negative Paths
- Given a spec whose marked plan has compile errors, including a malformed Done-when tag or a slice violation, when the spec is landed, then land refuses it under one plan-compile gate id, the refusal lists every compile error with its line, task, and rule, and no commit is created.
- Given a refusal whose error list is longer than the land-rejection event's reason bound, when the event is recorded, then the event reason is truncated at that bound while the refusal printed to the author still lists every error.
- Given a spec whose marked plan compiles cleanly but exceeds the plan task-count hard stop, when the spec is landed, then land refuses it under the existing task-count gate.
- Given a spec whose marked plan both has compile errors and exceeds the task-count hard stop, when the spec is landed, then land refuses it under the plan-compile gate, and the task-count and coherence checks are not reported.
- Given a spec whose marked plan compiles cleanly and whose coherence artifact cites a task id that plan does not declare, when the spec is landed, then land refuses it naming the citation and the unresolvable id.

### Done When
- [ ] [test] Landing a fixture spec with a multi-violation marked plan fails under the plan-compile gate id, and the printed refusal lists every violation with line, task, and rule.
- [ ] [test] Landing a fixture spec with an unmarked plan gives the same gate id and outcome as before the change.
- [ ] [test] A marked plan over the task-count hard stop is refused by the task-count gate.

## Story 6: Daemon discovery skips a marked plan that does not compile and says why

**Requirement:** adr-2026-10-10-single-two-mode-plan-compiler D6

As the operator, I want a merged spec whose marked plan does not compile kept out of the build
queue with its errors visible, so that a spec that skipped land, or was edited after land, cannot
start a build on a plan the engine cannot read.

### Acceptance Criteria

#### Happy Path
- Given a merged spec on the base branch with a marked plan that compiles cleanly and approved stories, when discovery vets it, then it is eligible for dispatch.
- Given a merged spec with an unmarked plan, when discovery vets it, then it is eligible or skipped exactly as it would have been before this change.

#### Negative Paths
- Given a merged spec whose marked plan has compile errors, including a task with no dependency declaration, when discovery vets it, then it is not dispatched and daemon status shows a blocked entry with reason `plan-compile-failed` whose remedy lists every compile error.
- Given a merged spec whose marked plan has no `**Dependencies:**` line anywhere, when discovery vets it, then its blocked entry has reason `plan-compile-failed`, not `no-dependency-tree`.
- Given a blocked marked spec whose compile errors change on the base branch, when discovery next vets it, then the blocked entry's remedy lists the current errors even if the discovery log line for that slug is suppressed as a repeat.
- Given a blocked marked spec whose plan is fixed on the base branch, when discovery next vets it, then it becomes eligible with no further operator action.

### Done When
- [ ] [test] Discovery over a fixture base branch with a non-compiling marked plan leaves it undispatched, with a `plan-compile-failed` blocked entry whose remedy contains each compile error.
- [ ] [test] Changing the fixture's errors between two discovery passes updates the remedy on the second pass.
- [ ] [test] Discovery over an unmarked fixture plan gives the same eligibility and reason as before the change.

## Story 7: A marked plan that stops compiling mid-build halts once, loudly

**Requirement:** adr-2026-10-10-single-two-mode-plan-compiler D6

As the operator, I want a build whose marked plan becomes unreadable to stop with the errors
named, so that it never runs on a guessed or empty task list.

### Acceptance Criteria

#### Happy Path
- Given a build of a marked plan that compiles, when task seeding reads the plan, then the build proceeds with the compiled tasks.

#### Negative Paths
- Given a build of a marked plan that was amended mid-build into a shape with compile errors, when task seeding next reads the plan, then the build raises one `needs-human` halt whose reason names the plan path and lists every compile error, and no task is marked done, reopened, or parked as a result.
- Given a build of a marked plan that does not compile, when any build consumer would otherwise read task structure, then no consumer proceeds as if the plan had zero tasks, and the build reports no "empty or missing plan" park.
- Given a halted build whose plan has been fixed, when the halt is cleared and the build re-dispatched, then it resumes from its recorded task progress, except that a task whose heading or body text changed in the fix is reopened under the existing reopen rule.

### Done When
- [ ] [test] A build fixture whose marked plan fails compilation halts `needs-human` with a reason naming the plan path and each compile error, and the task-status sidecar is unchanged.
- [ ] [test] Every build consumer given a failed compile result refuses to proceed rather than returning an empty task list.

## Story 8: Remediation append keeps working on marked and unmarked plans

**Requirement:** adr-2026-10-10-single-two-mode-plan-compiler D7

As the operator, I want engine-appended remediation tasks to remain a pure append that the seal
accepts, on both plan modes, so that gate remediation is not broken by the new grammar.

### Acceptance Criteria

#### Happy Path
- Given a marked plan and a remediation gap, when the engine appends remediation tasks, then the appended tasks compile in strict mode as appended tasks with only the fields the remediation renderer emits, the plan's existing text is an unchanged byte prefix, and the seal accepts the amendment.
- Given an unmarked plan and a remediation gap, when the engine appends remediation tasks, then the appended text, the resulting task ids, the authored-task count, and the seal's decision equal their goldens.

#### Negative Paths
- Given a remediation append whose rendered tasks would not compile, when the append runs, then it fails with the compile errors named and the plan file is left byte-identical.
- Given a marked plan's appended tail containing a non-task heading, when the seal checks the amendment, then it refuses it as it does today.
- Given a marked plan's appended tail containing a `### Task <id>:` heading whose id the engine did not record as appended, when the seal checks the amendment, then it refuses it as it does today.

### Done When
- [ ] [test] Appending remediation tasks to a marked fixture produces a plan that compiles strictly, keeps the original bytes as a prefix, and is accepted by the seal.
- [ ] [test] Appending to an unmarked fixture matches the goldens for appended bytes, task ids, authored-task count, and seal decision.
- [ ] [test] A forced non-compiling append fails naming the errors and leaves the plan file byte-identical.

## Story 9: A compiled plan depends only on its text

**Requirement:** adr-2026-10-10-single-two-mode-plan-compiler D5

As the operator, I want compiling a plan to depend only on its text, so that one caller's context
can never leak into another caller's view of the same plan.

### Acceptance Criteria

#### Happy Path
- Given the same plan text read by consumers for two different features, when each applies its own protected-path filtering, then each gets its golden for its own feature.

#### Negative Paths
- Given a plan file whose text changes between two reads in one process, when it is compiled after the change, then the result reflects the new text, not the earlier result.
- Given a plan compile that failed, when a different, valid plan text is compiled next in the same process, then the valid plan compiles cleanly.
- Given a build run, when plans are compiled, then no file under `.docs/` or `.pipeline/` is created or changed by compilation.

### Done When
- [ ] [test] Two feature descriptions over one fixture plan text produce their respective protected-path goldens.
- [ ] [test] Changing plan text between compiles in one process yields the new result.
- [ ] [test] Compiling over a fixture worktree leaves `.docs/` and `.pipeline/` byte-identical.

## Story 10: Plans authored by the plan skill compile in strict mode

**Requirement:** adr-2026-10-10-single-two-mode-plan-compiler D2, D3

As the operator, I want the shipped plan skill to produce marked plans in the strict shape, so
that every newly authored plan, in this repository and in consumer projects, gets strict checking.

### Acceptance Criteria

#### Happy Path
- Given the plan skill's task template and every task example it contains, when they are assembled into a marked plan and compiled, then the plan compiles cleanly in strict mode.
- Given the plan skill's plan skeleton, when it is read, then it contains the format marker line before its first task heading.

#### Negative Paths
- Given a plan skill that contains a task example the strict grammar refuses, when the skill-contract test runs, then it fails naming the example.
- Given a plan skill skeleton with no marker line, or with the marker after its first task heading, when the skill-contract test runs, then it fails naming the problem.
- Given a marked fixture plan and its unmarked copy, when the base-commit goldens are captured for both, then their task ids, counts, and digests are identical, so engines without this change read a marked plan the same as its unmarked copy.

### Done When
- [ ] [test] A skill-contract test compiles the plan skill's template and examples as a marked plan and passes only on a clean strict compile.
- [ ] [test] The skill-contract test fails when the skeleton's marker line is missing or misplaced.
- [ ] [test] Base-commit goldens for a marked fixture equal those for its unmarked copy.
