**Status:** Accepted

# Stories: Plan dependency graphs must resolve before a new plan passes its authoring gates (#1393)

Technical track; no PRD. Acceptance criteria derive from issue #1393's desired outcomes, the
operator-confirmed "new plans only" scope in
`.docs/track/task-dependency-gate-is-a-presence-check-unorderab.md`, and the approved architecture
review (conditions C1–C5) with the `adr-2026-09-29-plan-slice-manifest` decision 2 and 4 amendments.
"Strict dependency validation" means: every task except engine-appended remediation tasks declares
exactly one `**Dependencies:**` line in the existing accepted grammar (`none`, or a comma list of task
references), every cited id is a task the plan declares, and the declared graph has no cycle. "A
remediation task" means a task whose id `isEngineAppendedRemediationTaskId` recognizes. "Merged plan"
means a plan file that already exists at the merge-base of the feature worktree with the default
branch.

## Story 1: Strict dependency validation names every unorderable or dangling task

As a plan author, I want the dependency check to resolve the graph I declared and name exactly which tasks break it, so that I fix an unorderable plan in seconds instead of discovering it inside BUILD.

### Acceptance Criteria

#### Happy Path
- Given a plan whose tasks each declare one `**Dependencies:**` line that is `none` or cites only declared task ids, and whose graph has no cycle, when strict dependency validation runs, then it reports no violation.
- Given a plan whose remediation tasks carry no `**Dependencies:**` line while every other task carries a valid one, when strict dependency validation runs, then it reports no violation for the remediation tasks.

#### Negative Paths
- Given a plan where Task 1 declares `**Dependencies:** Task 2` and Task 2 declares `**Dependencies:** Task 1`, when strict dependency validation runs, then it reports one cycle violation whose message names both Task 1 and Task 2 and no task outside the cycle.
- Given a plan with a three-task cycle (Task 3 depends on Task 5, Task 5 on Task 7, Task 7 on Task 3) plus an independent Task 1, when strict dependency validation runs, then the cycle violation names Tasks 3, 5 and 7 and does not name Task 1.
- Given a task that declares a dependency on itself, when strict dependency validation runs, then it reports a cycle violation naming that task.
- Given Task 2 declaring `**Dependencies:** Task 99` where the plan declares no Task 99, when strict dependency validation runs, then the violation message names both Task 99 as the unknown id and Task 2 as the citing task.
- Given a plan that has a `## Task Dependency Graph` section but in which some non-remediation task has no `**Dependencies:**` line, when strict dependency validation runs, then it reports a missing-line violation naming that task, so the section alone does not satisfy the check.
- Given a task whose `**Dependencies:**` line uses a range such as `Tasks 1–9` or free prose such as `all prior`, when strict dependency validation runs, then it reports a malformed-dependencies violation naming that task and quoting the accepted forms, rather than guessing the intended ids.

### Done When
- [ ] A two-task cycle, a three-task cycle beside an independent task, and a self-dependency each produce exactly one cycle violation whose message lists exactly the cycle's task ids.
- [ ] A dangling citation produces a violation message containing both the citing task id and the missing id.
- [ ] A plan with only a `## Task Dependency Graph` section and no per-task lines produces a missing-line violation for every non-remediation task.
- [ ] A conforming acyclic plan with remediation tasks lacking `**Dependencies:**` lines produces zero violations.

## Story 2: Land refuses any plan whose dependency graph does not resolve

As the composer operator, I want `land` to reject a spec whose plan dependencies cannot be ordered or cite missing tasks, sliced or not, so that no unorderable plan reaches a spec PR.

### Acceptance Criteria

#### Happy Path
- Given an unsliced plan that passes strict dependency validation and every other land check, when `landSpec` runs, then it lands the spec as it does today.
- Given a sliced plan that passes strict dependency validation and the existing `plan-slices` rung, when `landSpec` runs, then it lands the spec as it does today.

#### Negative Paths
- Given an unsliced plan with a dependency cycle, when `landSpec` runs, then it throws a land gate error identified as the new dependency rung whose message names every task id in the cycle, and nothing is committed.
- Given an unsliced plan where one task cites a missing id, when `landSpec` runs, then it throws the dependency-rung land gate error naming the citing task and the missing id.
- Given an unsliced plan that declares only a `## Task Dependency Graph` section with no per-task `**Dependencies:**` lines, when `landSpec` runs, then it throws the dependency-rung land gate error naming the tasks missing a line.
- Given a sliced plan whose tasks within one slice form a cycle, when `landSpec` runs, then it throws the dependency-rung land gate error naming the cycle's task ids even though the `plan-slices` rung accepted the slice structure.
- Given a sliced plan that already fails the `plan-slices` rung, when `landSpec` runs, then the `plan-slices` error is thrown unchanged and the dependency rung adds no duplicate message.

### Done When
- [ ] `LandGateIdentifier` contains a member for the dependency rung, and a cyclic unsliced plan fails land with that identifier.
- [ ] Land rejection messages for a cycle, a dangling id, and a section-only plan each contain the specific task ids involved.
- [ ] A conforming unsliced plan and a conforming sliced plan both land successfully.

## Story 3: The conduct plan gate validates a newly authored plan strictly and leaves merged plans alone

As an operator running conduct or daemon DECIDE, I want the `plan` gate to reject an unorderable plan that this feature authored, while never re-judging a plan that was already merged, so that authoring mistakes surface at the plan step and in-flight builds are not kicked back.

### Acceptance Criteria

#### Happy Path
- Given a feature worktree whose plan file is absent at the merge-base and passes strict dependency validation plus the existing coverage checks, when the `plan` gate is evaluated, then it is satisfied.
- Given a feature worktree whose plan file exists at the merge-base and carries legacy lines such as `Tasks 1–9`, when the `plan` gate is evaluated, then it applies only today's presence check and is satisfied.
- Given a merged plan to which BUILD has appended remediation tasks without `**Dependencies:**` lines, when the `plan` gate is recomputed after a step, then it stays satisfied under the presence check.

#### Negative Paths
- Given a feature worktree whose plan file is absent at the merge-base and contains a dependency cycle, when the `plan` gate is evaluated, then it is unsatisfied and its reason names every task id in the cycle.
- Given a newly authored plan that cites a missing task id, when the `plan` gate is evaluated, then it is unsatisfied and its reason names the citing task and the missing id.
- Given a newly authored plan with only a `## Task Dependency Graph` section, when the `plan` gate is evaluated, then it is unsatisfied and its reason names the tasks missing a `**Dependencies:**` line.
- Given a feature worktree where the merge-base cannot be resolved, when the `plan` gate is evaluated on a plan that passes the presence check, then it applies the presence check, and its result states that strict dependency validation was skipped because the merge-base was unresolved.
- Given a feature worktree where the merge-base cannot be resolved and the plan has neither a `## Task Dependency Graph` section nor any `**Dependencies:**` line, when the `plan` gate is evaluated, then it is unsatisfied with today's no-dependency-tree reason.

### Done When
- [ ] In a git fixture, a cyclic plan added on the feature branch leaves the `plan` gate unsatisfied with the cycle's task ids in its reason.
- [ ] In a git fixture, a legacy plan with range-form `**Dependencies:**` lines committed on the default branch before the merge-base leaves the `plan` gate satisfied.
- [ ] In a git fixture with no resolvable merge-base, the `plan` gate result names the unresolved merge-base fallback.

## Story 4: Merged specs stay buildable

As the daemon operator, I want backlog eligibility to keep its existing presence check, so that the 130 merged plans the strict parser would reject are not stranded.

### Acceptance Criteria

#### Happy Path
- Given a merged spec whose plan carries legacy-form `**Dependencies:**` lines (ranges, annotated `none`, bare ids) and a present dependency tree, when daemon backlog discovery evaluates it, then it is eligible exactly as before this change.

#### Negative Paths
- Given a merged spec whose plan has neither a `## Task Dependency Graph` section nor any `**Dependencies:**` line, when daemon backlog discovery evaluates it, then it is blocked with the existing `no-dependency-tree` reason and remedy, unchanged.
- Given a merged spec whose plan contains a dependency cycle but declares a dependency tree, when daemon backlog discovery evaluates it, then it remains eligible and is not blocked by the strict check.

### Done When
- [ ] Daemon backlog discovery calls only `planHasDependencyTree` for the dependency-tree eligibility check, and existing backlog dependency-tree tests pass unchanged.
- [ ] A merged-spec fixture with range-form lines remains eligible.

## Story 5: The plan authoring skill states the enforced dependency rule

As a plan author, I want `/plan` to tell me the rule land and the plan gate now enforce, so that I write a conforming dependency graph the first time.

### Acceptance Criteria

#### Happy Path
- Given `skills/plan/SKILL.md`, when an author reads its dependency guidance and checklist, then it states that every task (remediation tasks excepted) carries exactly one `**Dependencies:**` line of `none` or comma-separated task references, that cited ids must exist, and that the graph must be acyclic, enforced at land and the `plan` gate.

#### Negative Paths
- Given `skills/plan/SKILL.md`, when it is searched for guidance that a `## Task Dependency Graph` section alone satisfies the dependency requirement, then none is found; the section is described only as an optional diagram alongside the per-task lines.
- Given `skills/plan/SKILL.md`, when it is searched for an example `**Dependencies:**` line using a range such as `Tasks 1–9` or free prose, then none is found.

### Done When
- [ ] The skill's checklist no longer contains the alternative "or the plan includes a `## Task Dependency Graph` section".
- [ ] Every example `**Dependencies:**` line in the skill passes strict dependency validation.
