**Status:** Accepted

# Stories: DECIDE sweeps task-versus-task oscillation inside a plan (#1540)

Technical track (no PRD). Source: jstoup111/ai-conductor#1540. Tier: S. Scope: skill prose only
(`skills/coherence-check/SKILL.md`, `skills/plan/SKILL.md`, `skills/conflict-check/SKILL.md`); no
engine, parser or gate change.

**Intent.** Two plan tasks whose fixtures or assertions invalidate each other are caught during
DECIDE, before the spec lands. At Medium and Large tier, plan review (the `plan_review` step after
`/coherence-check`) is the independent sweep that runs over the final plan, so it owns
task-versus-task pairs. It records a grounded finding as a blocking contradiction finding in the
review artifact, which the land-time plan-review gate blocks. An acyclic dependency graph stops being read
as evidence that tasks do not interfere. Each sweep states which layer pairs it owns, so a layer
nobody sweeps shows up in the skill text.

Motivating instance: spec `rebase-invalidated-test-failures-never-reach-build` (#1535). Its Task 3
locked `classifyGateInvalidation`'s gate set for a delta containing excluded paths. Its Task 9
moved `agents/*.md` from excluded to source. The two tasks sat on independent dependency chains,
and the spec passed a clean conflict-check and a fully covered coherence-check.

## Story 1: plan review sweeps task pairs and blocks on a grounded interference

As an operator landing a Medium or Large spec, I want plan review to ask the
both-directions question of task pairs, so that two tasks that invalidate each other block land
instead of reaching BUILD.

### Acceptance Criteria

#### Happy Path
- Given a plan where one task locks an assertion or fixture and another task changes the behavior
  that assertion or fixture depends on, as in #1535's Task 3 and Task 9, when the reviewer follows
  `skills/plan-review/SKILL.md`, then the skill directs it to ask, for each task pair sharing a
  behavior, entity, file or fixture, "if I fully complete task A, does task B's `Done when` still
  hold?", in both directions.
- Given a reviewer that finds such an invalidation, when it records the finding, then the skill
  directs it to record a blocking contradiction finding naming both tasks. The evidence must quote
  the opposing text from both tasks, and the finding then blocks at land through the plan-review gate.
- Given a pair that fails in both directions, when the skill classifies it, then it is named an
  oscillation. Given a pair that fails in only one direction, it is named a contradiction. Both are
  recorded as blocking findings, because the dependency graph does not stop the build from completing the two
  tasks in either order.

#### Negative Paths
- Given a reviewer that suspects two tasks interfere but cannot quote opposing text from both tasks,
  when it follows the skill, then it records the suspicion as an advisory finding at most and records
  no blocking finding for it.
- Given a reviewer that records a severity word outside the closed set, such as `oscillation` or
  `interference`, when the engine validates the result, then that finding is rejected rather than
  silently passing.

### Done When
- [ ] `skills/plan-review/SKILL.md` contains a task-versus-task sweep. It states the
      both-directions question, the shared behavior/entity/file/fixture pairing criterion, and the
      blocking-finding recording rule, with opposing quotes from both tasks.
- [ ] The plan-review skill's verification checklist contains an item for the task-versus-task sweep.
- [ ] The existing coherence-check verdict vocabulary (`covered` / `gap` / `fail`) is unchanged.

## Story 2: Independent tasks and S-tier specs gain no new ceremony

As a plan author, I want genuinely independent tasks and Small specs to pass without new
artifacts or steps, so that the new sweep costs nothing where there is nothing to find.

### Acceptance Criteria

#### Happy Path
- Given a Medium or Large plan whose tasks share no behavior, entity, file or fixture, when
  plan review runs, then the sweep adds no finding. Existing coherence `task` rows keep their
  current coverage verdicts.

#### Negative Paths
- Given an S-tier spec, which skips `/coherence-check` and plan review, when its DECIDE chain runs,
  then no skill makes a task-versus-task sweep or artifact required beyond the plan's tier-S §7b
  contradiction judge. `skills/plan/SKILL.md` names the sweep as plan review's work at Medium and
  Large tier.

### Done When
- [ ] The sweep text in `skills/plan-review/SKILL.md` states that pairs with nothing shared need
      no finding.
- [ ] No skill adds a required step or artifact for S-tier specs. The tier-required artifact list
      is unchanged.

## Story 3: plan treats acyclic and non-interfering as separate properties

As a plan author, I want the plan skill to stop implying that an acyclic dependency graph shows
the tasks are independent, so that interference is not assumed away by a passing DAG check.

### Acceptance Criteria

#### Happy Path
- Given `skills/plan/SKILL.md`, when an agent reads its verification checklists, then
  "dependencies are acyclic" and "tasks do not invalidate each other's fixtures or assertions" are
  separate items. The second names plan review as the sweep that checks it at Medium and
  Large tier.

#### Negative Paths
- Given a plan whose dependency graph is acyclic but contains two unordered tasks that invalidate
  each other, when an agent follows `skills/plan/SKILL.md`, then no checklist item or prose treats
  the acyclic result as satisfying the non-interference check.

### Done When
- [ ] Both plan verification checklists (the in-template one and the skill's own) carry the
      acyclic item and a distinct non-interference item that points to plan review.
- [ ] Existing plan skill-contract tests, including
      `src/conductor/test/engine/plan-slices-skill-contract.test.ts` and
      `src/conductor/test/engine/plan-task-count-skill-contract.test.ts`, still pass.

## Story 4: Each sweep states which layer pairs it owns

As a harness maintainer, I want the DECIDE sweeps to state which layer pairs each one owns, so that
a layer nobody sweeps is visible from the skill text instead of being found in a landed spec.

### Acceptance Criteria

#### Happy Path
- Given `skills/conflict-check/SKILL.md`, `skills/coherence-check/SKILL.md` and
  `skills/plan-review/SKILL.md`, when an agent reads any one, then it finds the same ownership
  statement. Story versus story belongs to `/conflict-check`. Cross-layer pairs and task versus task
  belong to plan review at Medium and Large tier, and to the plan's §7b judge at Small tier.
  `/conflict-check` runs before `/plan` and cannot see tasks.

#### Negative Paths
- Given `skills/coherence-check/SKILL.md`, when an agent reads it, then no sentence says that all
  same-layer pairs belong to `/conflict-check`, and no sentence directs coherence-check itself to run
  a contradiction or oscillation sweep.

### Done When
- [ ] All three skills carry a consistent layer-ownership statement naming story↔story, cross-layer
      and task↔task with their owner.
- [ ] `skills/coherence-check/SKILL.md` no longer defers every same-layer pair to
      `/conflict-check`.
