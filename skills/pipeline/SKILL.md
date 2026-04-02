---
name: pipeline
description: "Use when executing an implementation plan with multiple tasks. Factory orchestration with three autonomy levels, quality gates, rework budgets, and audit trails."
enforcement: structural
phase: build
standalone: false
requires: [".docs/plans/ with implementation plan"]
---

## Purpose

Orchestrates execution of an implementation plan through quality-gated stages. Three autonomy
levels let the user dial trust up or down. Tracks state in `.pipeline/` for visibility and
feeds the retro skill with audit data.

## Practices

### Autonomy Levels

| Level | Human Role | Agent Authority | When to Use |
|-------|-----------|----------------|-------------|
| **Conservative** | Approves each task before execution | Sequential only, proposes before executing | First time using the harness, unfamiliar domain |
| **Standard** | Reviews at batch boundaries | Parallel agents on non-overlapping files, quality gates | Known domain, trusted test suite |
| **Full** | Reviews completed features | Parallel agents + parallel worktrees, auto-merge on green | Mature project, well-defined stories |

Default to **Standard** unless the user specifies otherwise.

### Per-Task Execution

For each task in the implementation plan:

```
0. UPDATE STATUS — Mark task as "in_progress" in .pipeline/task-status.json
1. DECOMPOSE    — Read task, identify files to touch, check dependencies met
2. IMPLEMENT    — TDD cycle (RED → DOMAIN → GREEN → DOMAIN → COMMIT)
3. REVIEW       — Dispatch evaluator with fresh context
4. FIX          — Address review findings (if any)
5. VERIFY       — Run full test suite
6. COMMIT       — Clean commit with descriptive message
7. UPDATE STATUS — Mark task as "completed" in .pipeline/task-status.json
```

**Task status tracking is mandatory — write directly to `.pipeline/task-status.json`.**

Do NOT rely on conversation-level task tools (TaskCreate/TaskUpdate) for persistence — those
are ephemeral and lost between sessions. Write to the JSON file at each task boundary:
- Mark `in_progress` before coding
- Mark `completed` after commit
- The post-commit hook is a backup; fix stale status immediately if detected

**Batch independent tasks:** Group tasks that don't modify overlapping files into batches for
parallel or combined execution. Two strategies:

1. **Combined dispatch** — When consecutive tasks follow the same pattern (e.g., "add validations
   to Model X" repeated for 5 models), batch into a single agent that handles all in one TDD pass.
2. **Parallel dispatch** — When tasks are independent but follow different patterns, dispatch each
   as a separate parallel Agent tool call (Standard/Full autonomy).

Only batch/parallelize when tasks don't modify overlapping files (check `**Files likely touched:**`
in the plan). When in doubt, run sequentially.

### Quality Gates

**HARD GATE: Evaluator dispatch is mandatory at required batch boundaries.**

**Rate limit cooldown: sleep 15 seconds before dispatching the evaluator** to avoid stacking
on top of the just-completed TDD agent's API usage.

At batch boundaries, dispatch an evaluator agent with **fresh, scoped context** (no shared
state with the generator). Provide the evaluator with:
- The **git diff** for this batch only (not the full codebase)
- The **acceptance criteria** for this batch's tasks (extracted from stories, not full story files)
- The **test output summary** (pass/fail counts + failure snippets, not full verbose output)
- The tech-context review checklist if loaded in session

Do NOT send full story files, full plan files, or unrelated source files. The evaluator
runs the full 3-stage review from the `code-review` skill on this scoped context.

**Evaluator frequency scaling:** For plans with ≤15 tasks, dispatch the evaluator at every
OTHER batch boundary, plus always on the final batch. Pre-batch verification (full test suite,
linter, `/simplify`) still runs at EVERY boundary regardless. For plans with >15 tasks,
dispatch the evaluator at every batch boundary (no change).

**Evaluator diff scope:** Always scope the evaluator to the **current batch's diff only**
(`git diff <batch-start-commit>..HEAD`), not the full branch diff. For the final batch,
add a lightweight integration check (full branch stat summary) but do NOT re-review earlier
batches line by line — they already passed their own evaluator gate.

**Enforcement:** After each batch, write the evaluator verdict to
`.pipeline/audit-trail/batch-N/review.json`. If this file does not exist for the current
batch, the next batch CANNOT start. The pipeline must check for the verdict file before
proceeding — not rely on the agent remembering to dispatch the evaluator.

The evaluator runs:

1. **Spec compliance** — All acceptance criteria (happy + negative) have corresponding tests?
2. **Code quality** — Clear, readable, no duplication, no complexity violations, stack-specific checks?
3. **Domain integrity** — Domain types used, boundaries respected, naming correct?

The evaluator also runs a **security check** at each batch boundary:
- Are new endpoints authenticated?
- Do new inputs have validation?
- Are tokens/sessions expiring?
- Run Brakeman incrementally on changed files

The pipeline **cannot proceed** past a batch boundary without an evaluator verdict:

| Verdict | Action |
|---------|--------|
| APPROVE | Proceed to next batch |
| REQUEST_CHANGES | Fix and re-review (counts toward rework budget) |
| BLOCK | Halt. Escalate to user. |

Skipping the evaluator is what allows duplication, missing specs, and security gaps to compound
across an entire pipeline run. This is the harness's strongest quality mechanism — never skip it.

**Code-review gate satisfaction:** The final batch evaluator verdict satisfies the code-review
gate (Step 10 in `/conduct`). After the final batch evaluator returns APPROVE, write a marker
file at `.pipeline/audit-trail/code-review-satisfied.md` containing the verdict date and batch
number. When pipeline is used, a separate `/code-review` dispatch is not needed.

### Rework Budget

Each task gets **3 rework cycles** per quality gate:
- Cycle 1-2: Auto-fix and re-review (Standard/Full autonomy)
- Cycle 3: If still failing, **escalate to user** with full context:
  - What the evaluator found
  - What fixes were attempted
  - What's still failing and why

### Conflict Check Integration

If stories in `.docs/stories/` have been modified since the plan was created:
- Re-run `conflict-check` before starting the next task
- If new conflicts found: halt and resolve before continuing

### State Management

Track all state in `.pipeline/`: `config.yaml` (autonomy level, project refs), `plan-ref.md` (active plan path), `task-status.json` (per-task status and rework cycle counts), and `audit-trail/` (per-task `review.json`, `rework-N.json`, `commit.txt`, plus `summary.json` for retro).

### Parallel Execution (Standard and Full Autonomy)

When tasks within a batch have no file-level dependencies on each other, dispatch them
in parallel using the Agent tool. This does NOT require worktrees — parallel agents work
in the same directory on non-overlapping files.

**When to parallelize:**
- Tasks touch different files (check `**Files likely touched:**` in the plan)
- Tasks have `Dependencies: none` or depend only on already-completed tasks
- Tasks follow the same pattern (e.g., "add validation to Model X" for 5 models)

**How to parallelize:**
1. Read the plan and identify tasks with no mutual dependencies
2. Group independent tasks into parallel batches (max 3 concurrent agents)
3. Dispatch each task as a separate Agent tool call in a single message
4. Each agent receives: the task description, the test directory, the source directory
5. Wait for all agents to complete
6. Run the full test suite to verify no conflicts
7. If tests fail: identify the conflict, fix sequentially, re-run

**Worktree-based parallelism (Full autonomy only):**
For tasks that touch overlapping files or need full isolation:
- Dispatch the `worktree-manager` agent to create parallel worktrees under `.worktrees/`
- Each worktree gets its own task batch
- After completion, merge results back sequentially
- The worktree-manager handles merge order, conflict resolution, and post-merge testing

**Conservative autonomy:** All tasks run sequentially. No parallel execution.

### Batch Boundaries

At natural batch boundaries (after completing a group of related tasks):

**Pre-batch verification (before starting next batch):**
- Run the full test suite — if ANY test fails that is NOT an expected RED test, stop and fix
  before proceeding. Previous session bugs must not accumulate.
- Verify the current branch is merge-ready: no WIP commits, no TODO-fixme code added this batch,
  all new code has tests. The branch should be shippable at any batch boundary, even if the
  feature is incomplete.

**Post-batch checks:**
- Run the linter (if tech-context specifies one)
- Run `/simplify` to check for accumulated duplication (dry business logic, not dry code)
- Run a **micro-retro** (see below)
- Append to `.pipeline/progress.log` — a chronological narrative of what was done, what was
  tried, what worked, and what's next (see Progress Log below)
- Present a progress summary to the user
- In Conservative mode: get explicit approval to continue
- In Standard mode: continue unless the user intervenes
- In Full mode: continue automatically

### Micro-Retros (Per-Phase)

At each batch boundary, perform a lightweight retro: spec compliance, duplication, complexity, gate accuracy, and autonomy friction. Record findings in `.pipeline/audit-trail/batch-N-retro.md`. These feed the full `/retro` with phase-level granularity.

### Memory Checkpoint (Per-Batch)

**GATE: Every batch must persist at least one `.memory/` entry before proceeding.**

Persist decisions, patterns, gotchas, or context learned during the batch. Update `.memory/index.md` after each write.

### Progress Log

Append to `.pipeline/progress.log` at every batch boundary — a chronological narrative for cross-session continuity. The `session-start-context.sh` hook reads the last 30 lines at session start.

```
## Batch 1 — 2026-03-28 14:30
- Completed: task-1 (User model), task-2 (registration endpoint) | Rework: 0 cycles
- Issue: PostgreSQL JSONB casting needed explicit type (wrote .memory/gotchas/)
- Next: task-3 (authentication) | State: 2/13 tasks, all tests passing, merge-ready
```

### Git Revert Recovery

When the rework budget is exhausted, consider reverting to the last clean batch boundary commit (`git revert --no-commit HEAD~N..HEAD`) and re-approaching rather than continuing to patch. Each batch boundary is a merge-ready state, so reverting never loses unrelated work.

### Pipeline Summary

Track tasks completed/total, rework cycles used, human interventions triggered, and elapsed time (first task start to last commit). This data feeds directly into the `retro` skill.

## Verification

- [ ] Autonomy level set (default: Standard)
- [ ] Implementation plan loaded and validated
- [ ] Each task follows TDD cycle (not skipping RED or DOMAIN phases)
- [ ] Quality gates enforced after each task
- [ ] Rework budget tracked (escalate at 3 cycles)
- [ ] State tracked in `.pipeline/` with audit trail
- [ ] Conflict check re-run if stories changed
- [ ] Batch summaries presented at natural boundaries
- [ ] Pipeline summary available for retro
