# Story: Pipeline Factory Orchestration

**Status:** ACCEPTED
**Epic:** EP-001 Conductor Core Engine
**Skill:** pipeline/SKILL.md

> **Amended 2026-07-05 by `adr-2026-07-05-engine-owned-task-status.md` (APPROVED) and
> `.docs/stories/prd-audit-kickback-preserves-task-status.md`:** the pipeline agent no longer
> records `completed`/`skipped` in `.pipeline/task-status.json` — completion authority moved to
> the engine, derived from `Task: <id>` commit trailers (ADR H4/H5/H6). The agent records
> completion by *committing with the trailer* (or a no-op `Evidence:` commit for
> pre-completed/skipped tasks); it retains only advisory `pending`/`in_progress` scheduling
> writes. Criteria below referencing agent-written `completed` status describe the superseded
> pre-2026-07-05 contract.

> **Amended 2026-07-09 by `adr-2026-07-09-deterministic-evidence-attribution-enforcement.md`
> (APPROVED, #433) and `.docs/stories/deterministic-evidence-attribution.md`:** the advisory
> `pending`/`in_progress` scheduling writes are no longer hand-edits of
> `.pipeline/task-status.json` — the orchestrator performs them via
> `conduct-ts task start <id>` / `conduct-ts task done <id>`, which validate the id against the
> seeded set, write atomically, and stamp/clear `.pipeline/current-task` for the commit hooks.
> The scheduling semantics are unchanged; only the mechanism is engine-owned.

> **Amended 2026-07-10 by `adr-2026-07-10-session-hook-task-stamping` (APPROVED, #477):** the
> orchestrator no longer invokes `conduct-ts task start/done` itself — engine-installed session
> hooks (PreToolUse/PostToolUse on the subagent-dispatch tool) perform the `in_progress` flip and
> `.pipeline/current-task` stamp/clear mechanically when the dispatch happens. Each dispatch
> prompt carries `Task: <id>` or `Task: none` as its first line; an unmarked or unknown-id
> dispatch is blocked at dispatch time. The CLI remains for operator/recovery use. Scheduling
> semantics again unchanged; the trigger moved from prompt discipline to machinery.

As a developer building a Medium or Large feature, I want the pipeline skill to orchestrate
task execution with quality gates, batch evaluation, and rework budgets so that the build
phase is systematic and quality-controlled.

## Acceptance Criteria

### Happy Path
- Given a plan with ordered tasks, when the pipeline runs, then it checks each task's
  acceptance criteria against existing code and marks already-satisfied tasks as `pre-completed`
- Given tasks remain, when execution begins, then tasks within a batch are dispatched to
  subagents — in parallel when files don't overlap, sequentially when they do
- Given a task completes successfully, when verified, then its status is recorded in
  `.pipeline/task-status.json` as `completed`
- Given a batch boundary is reached, when the evaluator runs, then it reviews the batch diff
  for spec compliance, code quality, domain integrity, and security. Evaluator frequency
  scales by tier: Large every 4 tasks, Medium every 8 tasks, Small skips intermediate
- Given the evaluator writes its verdict file, when the next batch starts, then it checks
  the verdict file exists — the next batch CANNOT start without it
- Given a batch boundary, when post-batch checks run, then the pipeline runs `/simplify`,
  linting, and a micro-retro before proceeding
- Given all tasks complete, when a final evaluator runs, then it reviews the full branch
  summary and writes `.pipeline/audit-trail/code-review-satisfied.md` if approved
- Given each batch completes, when a memory checkpoint runs, then at least one `.memory/`
  entry is persisted per batch

### Negative Paths
- Given a task fails, when the pipeline retries, then it gets 3 rework cycles per quality
  gate — each cycle re-dispatches the subagent with error context
- Given all 3 rework cycles fail, when exhausted, then the pipeline escalates to the user
  with full context
- Given the evaluator returns BLOCK verdict, when the batch review completes, then the
  pipeline stops and escalates to the user
- Given a task has unmet dependencies, when it is reached, then it is blocked and reported —
  the pipeline does not silently skip it
- Given all tasks complete but some failed, when the build summary is shown, then it reports
  "incomplete — X/Y tasks done" and the build step fails
- Given a connection interruption occurs mid-task, when the pipeline resumes, then it checks
  for uncommitted changes and recent commits before re-dispatching

### Done When
- [ ] Pre-completion scan marks already-satisfied tasks before dispatching
- [ ] Tasks dispatch in parallel when files don't overlap, sequential when they do
- [ ] Task status tracked in .pipeline/task-status.json
- [ ] Evaluator frequency scales by tier (Large/4, Medium/8, Small/skip)
- [ ] Evaluator verdict file gates next batch
- [ ] Post-batch: /simplify, linting, micro-retro
- [ ] 3 rework cycles per failed task (not 1)
- [ ] BLOCK verdict stops the pipeline
- [ ] Memory checkpoint per batch
- [ ] Build marked done only when all tasks complete
- [ ] Skipped for Small tier (direct /tdd instead)
