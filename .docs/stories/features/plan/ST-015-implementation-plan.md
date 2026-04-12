# Story: Implementation Plan Generation

**Status:** DRAFT
**Epic:** EP-001 Conductor Core Engine
**Skill:** plan/SKILL.md

As a developer, I want the plan skill to convert user stories into a step-by-step
implementation plan with task dependencies so that the build phase has clear, ordered work.

## Acceptance Criteria

### Happy Path
- Given accepted stories exist in `.docs/stories/`, when the plan skill runs, then it
  generates tasks with 2-5 minute granularity covering every acceptance criterion
- Given tasks are generated, when dependencies exist between them, then each task lists its
  dependencies explicitly (e.g., "depends on: task 3")
- Given the plan is complete, when it is saved, then it goes to `.docs/plans/<feature>.md`
- Given every acceptance criterion in stories, when the plan is checked, then each criterion
  maps to at least one task (no coverage gaps)

### Negative Paths
- Given an acceptance criterion from stories has no corresponding task, when the coverage
  check runs, then the plan is BLOCKED with: "Plan has coverage gaps — [criterion] has no task"
- Given circular dependencies between tasks, when the plan is validated, then it reports the
  cycle and requires resolution before proceeding
- Given a story was added after the plan was written, when the conductor checks the gate,
  then it detects the new criterion and flags coverage gaps

### Done When
- [ ] Tasks have 2-5 minute granularity
- [ ] Every acceptance criterion maps to at least one task
- [ ] Task dependencies are explicit
- [ ] Plan saved to .docs/plans/
- [ ] Coverage gaps are detected and block progression
