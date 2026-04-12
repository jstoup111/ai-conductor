# Story: Pipeline Factory Orchestration

**Status:** DRAFT
**Epic:** EP-001 Conductor Core Engine
**Skill:** pipeline/SKILL.md

As a developer building a Medium or Large feature, I want the pipeline skill to orchestrate
task execution with quality gates, batch evaluation, and rework budgets so that the build
phase is systematic and quality-controlled.

## Acceptance Criteria

### Happy Path
- Given a plan with ordered tasks, when the pipeline runs, then it executes tasks sequentially,
  dispatching each to a subagent via the TDD skill
- Given a task completes successfully, when verified, then its status is recorded in
  `.pipeline/task-status.json` as `completed`
- Given a batch boundary is reached (every N tasks), when the evaluator runs, then it reviews
  the batch diff for spec compliance, code quality, domain integrity, and security
- Given the evaluator approves, when the next batch starts, then it proceeds with any
  REQUEST_CHANGES noted for improvement
- Given all tasks complete, when a final evaluator runs, then it reviews the full branch
  summary and writes `.pipeline/audit-trail/code-review-satisfied.md` if approved

### Negative Paths
- Given a task fails, when the pipeline retries, then it gets one rework attempt before
  moving to the next task — failed tasks are logged
- Given the evaluator returns BLOCK verdict, when the batch review completes, then the
  pipeline stops and escalates to the user with full context
- Given a task has unmet dependencies, when it is reached, then it is skipped with a warning
  and the dependency failure is logged
- Given all tasks complete but some failed, when the build summary is shown, then it reports
  "incomplete — X/Y tasks done" and the build step fails

### Done When
- [ ] Tasks execute sequentially from the plan
- [ ] Each task dispatched to subagent with isolated context
- [ ] Task status tracked in .pipeline/task-status.json
- [ ] Evaluator runs at batch boundaries
- [ ] BLOCK verdict stops the pipeline
- [ ] One rework retry per failed task
- [ ] Build marked done only when all tasks complete
- [ ] Skipped for Small tier (direct /tdd instead)
