**Status:** Accepted

# Stories: One owner per review question (#1805)

PRD: `.docs/specs/build-review-re-judges-what-the-plan-architecture-.md`. ADRs: `adr-2026-08-22-*`.

## Story 1: The three overlapping rubrics are removed

**Requirement:** FR-1, FR-23

As an operator, I want the scope, completeness, and rootCause rubrics gone so that build_review stops re-judging what the plan, the architecture review, and prd_audit already own.

### Acceptance Criteria

#### Happy Path
- Given a config that still turns on every old rubric, when build_review runs, then no reviewer session is started for scope, completeness, or rootCause
- Given the updated repository, when I list the rubrics that can actually run, then the only one is `test-quality` (old rubric names are still accepted in config, but as no-ops — see Story 15)
- Given the updated repository, when I look for the old rubric skills, then `build-review-scope`, `build-review-completeness`, `build-review-root-cause`, and `build-review-tautology` and their tests and fixtures are gone

#### Negative Paths
- Given a review result that claims to come from the `completeness` rubric, when the engine checks it, then it is rejected as an unknown rubric and treated as a broken review run, not as a failed feature
- Given an old saved exemption record that only the removed rubrics ever produced, when the engine computes the review verdict, then it skips the record and does not crash

### Done When
- [ ] The runnable-rubric list contains only `test-quality`; the four old skill folders and their tests no longer exist
- [ ] A result naming a removed rubric is rejected with a message that names the rubric

## Story 2: build_review passes when nothing is turned on

**Requirement:** FR-2

As an operator, I want build_review to run only the rubrics I choose so that turning everything off is a valid, passing setup rather than an error.

### Acceptance Criteria

#### Happy Path
- Given build_review is on but no rubric is on, when the step runs, then it passes, logs the reason "no rubrics enabled" to the event log, and starts no reviewer session
- Given build_review is on with only `test-quality` on, when the step runs, then exactly one reviewer runs

#### Negative Paths
- Given build_review is on but no rubric is on, when the config is loaded, then it loads cleanly with no error about "at least one rubric"
- Given the only enabled rubric fails, when the engine decides what to do, then the feature goes back to build and no task is added to the plan

### Done When
- [ ] A config with zero rubrics loads, and the step passes with the logged reason
- [ ] This repository's own `.ai-conductor/config.yml` enables `test-quality` (the shipped default stays off); the interim rootCause-disable block is removed
- [ ] Nothing in build_review can add a task to the plan

## Story 3: test-quality only looks at tests for new behavior

**Requirement:** FR-3, FR-4

As an operator, I want test-quality to check that tests written for new behavior actually prove that behavior so that fake-green tests are caught while refactors are left alone. "New behavior" means the criteria in this feature's own stories file and the tasks in its own plan file (the sealed set for this slug), and the tests considered are only those in this feature's diff against its merge-base — so a rebase that brings in other merged work never widens what is judged.

### Acceptance Criteria

#### Happy Path
- Given a changed test marked `Covers: S3.1` (a story criterion), when test-quality gathers its input, then that test is included
- Given a changed test marked `Covers: task:7` (a plan task), when test-quality gathers its input, then that test is included
- Given every included test fails when its production code is stubbed out, when the reviewer judges them, then the verdict is pass with no findings
- Given an included test that still passes when its production function returns a constant, when the reviewer judges it, then it raises a "test is insensitive" finding pointing at that test

#### Negative Paths
- Given none of the changed tests carry a `Covers:` marker tied to a criterion or task, when test-quality runs, then it has nothing to judge, starts no reviewer, and passes with the reason "empty scope"
- Given a test that was only moved to another file without changing its assertions, when test-quality runs, then it is ignored and produces no finding
- Given the feature branch is rebased onto a base that added tests for another feature, when test-quality runs, then those tests are not in the diff against the new merge-base and are not judged
- Given a `Covers:` marker naming a criterion that does not exist in this feature's stories file, when test-quality gathers its input, then the marker is reported as unresolved and that test is left out

### Done When
- [ ] `Covers:` accepts `FR-N`, `S<n>.<m>`, and `task:<id>`; only changed tests with a valid marker are judged
- [ ] Empty scope passes with the logged reason; a stub-passable test produces a "test is insensitive" finding

## Story 4: The revert check informs the reviewer instead of deciding for it

**Requirement:** FR-5

As an operator, I want the "revert production and rerun tests" check to be information the reviewer can use, not a rule that fails tests that stay green, and I want it to run only when test-quality is on.

### Acceptance Criteria

#### Happy Path
- Given test-quality is on and has tests to judge, when it runs, then the revert-check result is included in the reviewer's input as evidence
- Given the revert check stays green but the reviewer, reading the test, finds it genuinely checks the behavior, when the reviewer reports no findings, then the verdict is pass

#### Negative Paths
- Given test-quality is off, when build_review runs, then no reverted copy of the code is created and no revert-check test run happens
- Given test-quality is on but has nothing to judge, when it runs, then the revert check is skipped
- Given the revert check itself cannot run (the test command errors), when the rubric runs, then this counts as a broken review run, not a failed feature

### Done When
- [ ] The revert check only runs when test-quality is on and has tests to judge; its result lives only inside the reviewer's evidence
- [ ] No engine rule turns a green revert check into a finding

## Story 5: A task only closes once its Done when: checks are shown true

**Requirement:** FR-6

As an operator, I want each task's Done when: checks proven when the task closes so that "did BUILD finish this task" has an owner — without breaking plans that predate Done when:.

### Acceptance Criteria

#### Happy Path
- Given a plan task with three Done when: checks, when BUILD closes it, then the task record shows evidence for all three and the task is marked completed
- Given a verify-only task with Done when: checks, when it closes through the normal verify-only path, then that path's evidence satisfies the checks

#### Negative Paths
- Given a task with three checks and evidence for only two, when BUILD tries to close it, then it stays in progress and the missing check is named
- Given a task with no Done when: block at all, when BUILD closes it, then it closes under the old rule with nothing extra required
- Given a check that cannot be made true without going beyond the approved plan, when BUILD reports that, then the run stops for a human as a "plan gap", naming the task and the check, and no task is added to the plan

### Done When
- [ ] The engine reads Done when: checks per task and records evidence for each at close
- [ ] An old plan with no Done when: blocks builds exactly as before; the plan-gap stop is logged with its class

## Story 6: prd_audit grades against the stories

**Requirement:** FR-7

As an operator, I want prd_audit to read the implemented code and check it against each story's acceptance criteria — using the PRD for intent when there is one — so that one gate answers "was this built as expected" on every kind of feature.

### Acceptance Criteria

#### Happy Path
- Given a feature with a PRD and stories, when prd_audit runs, then every story criterion gets a verdict row citing the implemented code that satisfies or misses it, and the PRD's requirements are shown as the intent behind them
- Given a feature with stories but no PRD, when prd_audit runs, then every story criterion still gets a verdict row and the report says no PRD was present

#### Negative Paths
- Given a stories file whose criteria cannot be read, when prd_audit runs, then it fails and names the stories file, rather than passing by default
- Given a PRD requirement that no story covers, when prd_audit runs, then it is reported as a plan gap against that requirement instead of being silently skipped

### Done When
- [ ] Verdict rows are keyed by story criterion; the report states whether a PRD was used
- [ ] Unreadable criteria fail the gate with the file named

## Story 7: prd_audit runs on every feature

**Requirement:** FR-8

As an operator, I want prd_audit to run regardless of size or track so that behavior changes are always graded.

### Acceptance Criteria

#### Happy Path
- Given a small, technical-track feature, when it reaches SHIP, then prd_audit runs and its verdict gates finish
- Given the stories file or PRD is edited after prd_audit already passed, when the next step boundary arrives, then the earlier pass is thrown out and prd_audit runs again
- Given implementation code or acceptance-test code changes after prd_audit already passed (a kickback or rebase), when the next step boundary arrives, then the earlier pass is thrown out and prd_audit runs again, as today
- Given a project in any language, when acceptance tests are identified for this purpose, then they are found by their `Covers:` marker (a leading comment line or suite name), never by file path or test framework

#### Negative Paths
- Given a committed config setting that disables prd_audit, when the feature reaches SHIP, then the step is skipped and the log names the config setting as the reason
- Given a feature with no track marker at all, when it reaches SHIP, then prd_audit still runs

### Done When
- [ ] prd_audit has no track-based skip; edits to stories, the PRD, or production code invalidate a prior pass
- [ ] An end-to-end test shows a small technical feature cannot finish without a prd_audit verdict

## Story 8: Every prd_audit finding carries one grade

**Requirement:** FR-10, FR-11

As an operator, I want each finding in a report graded on its own as PASS, FIXABLE, PLAN_GAP, or OVER_SCOPE — with FIXABLE tied to a real plan task and criterion — so that the engine decides what happens next, not the reviewer. A report holds many findings; some may be FIXABLE and others PLAN_GAP in the same run.

### Acceptance Criteria

#### Happy Path
- Given a FIXABLE finding that names plan task 4 and criterion S2.1, when the report is read, then it is accepted and sent down the fix path
- Given a PLAN_GAP finding that names criterion S5.2, when the report is read, then it is accepted and handled by the plan-gap rules

#### Negative Paths
- Given a FIXABLE finding that names no plan task, when the report is read, then the report is rejected as malformed, the finding is named, and nothing is added to the plan
- Given a FIXABLE finding that names a task not in the plan, when the report is read, then it is rejected as malformed
- Given a finding with a grade outside the four, when the report is read, then it is rejected and the run counts as a broken review, not a failed feature
- Given a single finding that claims two grades at once, when the report is read, then it is rejected (two separate findings, each with one grade, are accepted)

### Done When
- [ ] The grade is validated against the closed list; FIXABLE must name a real task and criterion
- [ ] A malformed report can never reach the code that adds plan tasks

## Story 9: prd_audit judges "did we build more than asked"

**Requirement:** FR-9

As an operator, I want extra shipped behavior judged against intent so that harmless additions are accepted automatically and user-visible surprises stop for me.

### Acceptance Criteria

#### Happy Path
- Given an addition that sits inside the PRD's stated scope, when prd_audit grades it OVER_SCOPE but within intent, then it is recorded as an accepted widening and the gate does not fail
- Given an addition outside intent that users cannot see, when graded, then it is noted in the verdict and the shipped record, and the feature ships
- Given a feature with no PRD, when an OVER_SCOPE finding is judged, then intent is taken from the stories and the plan's stated outcome, and the report says so
- Given an over-scope stop that the operator clears to accept the widening, when prd_audit runs again, then that widening is recorded as operator-accepted and is graded within intent, not raised again
- Given a BUILD commit carrying a `Scope:` trailer with a rationale, when prd_audit judges that widening, then the rationale is part of the evidence it weighs

#### Negative Paths
- Given an addition outside intent that users can see, when graded, then the run stops for a human as "over scope", naming the behavior
- Given an operator reseal whose stated reason does not justify the change it made to a protected artifact, when prd_audit judges it, then an OVER_SCOPE finding names that reseal
- Given an operator reseal with a reason that does justify the change, when judged, then no finding is raised

### Done When
- [ ] OVER_SCOPE findings say whether the addition is within intent, outside but invisible, or outside and visible; each routes as above
- [ ] Reseal evidence is part of prd_audit's input; no scope judgement remains in build_review
- [ ] Clearing an over-scope stop writes an operator-accepted widening record that later prd_audit runs honour

## Story 10: prd_audit's fix lap is capped

**Requirement:** FR-12, FR-13, FR-18

As an operator, I want prd_audit's fix-up work capped by settings I control so that a plan cannot grow with every review lap.

### Acceptance Criteria

#### Happy Path
- Given a 20-task plan and three FIXABLE findings on the first lap, when prd_audit fails, then three tasks are added, each naming its criterion and parent task and carrying a Done when: block that restates the criterion, and BUILD runs once more
- Given default settings and a 12-task plan with four FIXABLE findings, when prd_audit fails, then the cap is three (25% of 12) and the run stops for a human listing all four
- Given settings raising the cap to 8 tasks and 50%, when a 20-task plan gets six FIXABLE findings, then six tasks are added

#### Negative Paths
- Given a feature that already used its one fix lap, when prd_audit fails again, then the run stops for a human as "kickback cap", lists every finding, and adds nothing
- Given a setting of zero fix laps, when the config is loaded, then it is rejected and the setting is named
- Given more FIXABLE findings than the cap allows, when prd_audit fails, then no tasks are added at all (not the first few) and the stop lists all of them
- Given a plan that already had `rem-*` tasks before this change, when the baseline is computed, then those count as authored and do not use up the cap

### Done When
- [ ] The cap is checked before any task is added; going over adds nothing and stops the run
- [ ] Every task prd_audit adds carries a Done when: block, so Story 5's close rule applies to it
- [ ] The lap count lives in the per-gate kickback ledger; cap settings must be at least 1

## Story 11: A plan gap stops the run only when it matters

**Requirement:** FR-14

As an operator, I want a plan gap on a main-path criterion to stop for me, and a gap on an edge case to be noted and shipped, so that I am not interrupted for every small miss.

### Acceptance Criteria

#### Happy Path
- Given a PLAN_GAP on a negative-path criterion, when prd_audit finishes, then the gap is noted in the verdict and the shipped record and the feature continues
- Given a setting that says stop on any plan gap, when a negative-path PLAN_GAP occurs, then the run stops

#### Negative Paths
- Given a PLAN_GAP on a happy-path criterion, when prd_audit finishes, then the run stops for a human as "plan gap", naming the criterion, and nothing is added to the plan
- Given a PLAN_GAP whose criterion cannot be told apart as happy-path or negative-path, when it is routed, then it is treated as happy-path and stops the run

### Done When
- [ ] Happy vs negative is decided by which section of the story the criterion sits under
- [ ] Noted plan gaps appear in the shipped record under a findings section

## Story 12: The as-built review runs on every feature

**Requirement:** FR-15

As an operator, I want the as-built architecture review to run always, with each check turned on only when there is something for it to check, so that small features get the "is this code actually reachable" guard too.

### Acceptance Criteria

#### Happy Path
- Given a small feature with no ADRs and no diagrams, when it reaches SHIP, then the review runs the reachability and plan-gap checks, skips the ADR and diagram checks, and logs why each was skipped
- Given a large feature with approved ADRs, when it reaches SHIP, then all four checks run
- Given a setting that turns off the reachability check for small features, when a small feature reaches SHIP, then that check is skipped and the setting is named as the reason

#### Negative Paths
- Given a feature whose DECIDE-time architecture review was skipped, when it reaches SHIP, then the as-built review still runs
- Given a new exported function with no production caller, when the reachability check runs on a small feature, then the verdict is BLOCKED and names the function

### Done When
- [ ] The as-built step has no size-based skip and no "skip because DECIDE skipped" rule; per-check settings are validated
- [ ] The test that pins which gates run for small features includes this step

## Story 13: The as-built review can say "the plan is the limit" but never sends work back

**Requirement:** FR-16, FR-17

As an operator, I want the as-built review to report when the design itself falls short, without ever ordering BUILD to do unplanned work.

### Acceptance Criteria

#### Happy Path
- Given code that faithfully implements the approved design while all acceptance criteria pass, when the review reports PLAN_GAP, then the gap is noted in the verdict and shipped record and the feature moves on to retro
- Given a PLAN_GAP where a stated outcome is not delivered, when the report is read, then the run stops for a human as "plan gap"

#### Negative Paths
- Given a BLOCKED verdict, when the report is read, then the run stops for a human exactly as it does today
- Given any as-built verdict, when the SHIP steps route, then no "go back to build" is ever issued from this step
- Given a report with no verdict line, when it is read, then the gate stays unsatisfied

### Done When
- [ ] The report reader accepts PLAN_GAP plus a flag for whether the outcome was delivered; there is no as-built → build route in the engine
- [ ] An end-to-end test shows a PLAN_GAP with passing criteria ships with the gap recorded

## Story 14: I can see how much a plan has grown

**Requirement:** FR-19

As an operator, I want to see authored, added, and remaining task counts per feature so that I know how close it is to its cap.

### Acceptance Criteria

#### Happy Path
- Given a feature with 19 authored tasks and 3 added by prd_audit, when I view its status, then it shows authored 19, added 3 (prd_audit), remaining 1 of a cap of 4
- Given tasks are added, when the addition completes, then an event with the same counts is written to the event log

#### Negative Paths
- Given a feature from before this change with no growth record, when I view its status, then the counts are computed from the plan and shown, not an error
- Given a growth record that has been hand-edited into an impossible state, when it is read, then the counts are recomputed from the plan and the discrepancy is logged

### Done When
- [ ] The growth counts live in the kickback ledger and appear in status output and the event log

## Story 15: Old settings keep working as no-ops

**Requirement:** FR-20

As a consumer, I want my existing config to keep loading after the update so that an engine update never stops my runs.

### Acceptance Criteria

#### Happy Path
- Given a config that turns on `build_review.rubrics.scope`, when it loads, then it loads fine and a single warning names the setting and the ADR that retired it
- Given a config with both `rootCause` and `causalIntegrity` set, when it loads, then both are ignored and the old "ambiguous" error does not fire

#### Negative Paths
- Given a config with a rubric name that never existed, when it loads, then it is still rejected as unknown
- Given the project scaffolder creating a fresh config, when it runs, then no retired setting appears in the output

### Done When
- [ ] The retired list covers scope, completeness, rootCause, causalIntegrity, tautology, and wiring; the warning appears once per load
- [ ] A scaffolder test asserts no retired settings are emitted

## Story 16: Features from before the change still build

**Requirement:** FR-21, FR-22

As an operator, I want merged specs and in-flight features from before this change to build all the way to SHIP so that the update strands nothing.

### Acceptance Criteria

#### Happy Path
- Given a merged plan with no Done when: blocks and five `rem-*` tasks, when the daemon builds it, then tasks close under the old rule, the five count as authored, and the feature reaches SHIP
- Given a worktree holding review results and dispositions from the removed rubrics, when the feature resumes, then they are ignored and build_review proceeds

#### Negative Paths
- Given a saved disposition file naming a removed rubric, when the engine reads it, then it does not crash and logs that the record was ignored
- Given a plan where a previously added `rem-*` task heading has been deleted, when the completion check runs, then it still blocks as it does today (the removal guard is unchanged)

### Done When
- [ ] An end-to-end test builds a pre-change fixture feature to SHIP; stale dispositions are logged and ignored
