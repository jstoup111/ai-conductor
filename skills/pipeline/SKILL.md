---
name: pipeline
description: "Use when executing an implementation plan with multiple tasks. Factory orchestration with three autonomy levels, quality gates, rework budgets, and audit trails."
enforcement: structural
phase: build
standalone: false
requires: ["docs/plans/ with implementation plan"]
---

## Purpose

Orchestrates execution of an implementation plan through quality-gated stages. Three autonomy
levels let the user dial trust up or down. Tracks state in `.pipeline/` for visibility and
feeds the retro skill with audit data.

## Practices

### Autonomy Levels

| Level | Human Role | Agent Authority | When to Use |
|-------|-----------|----------------|-------------|
| **Conservative** | Approves each task before execution | Proposes, doesn't execute | First time using the harness, unfamiliar domain |
| **Standard** | Reviews at batch boundaries | Executes with quality gates, escalates on failure | Known domain, trusted test suite |
| **Full** | Reviews completed features | Parallel execution, auto-merge on green | Mature project, well-defined stories |

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

**Task status tracking is mandatory.** Update `.pipeline/task-status.json` at the START and
END of every task. The post-commit hook also updates status, but do not rely on it alone —
update explicitly. Status must reflect reality at all times.

### Quality Gates

**HARD GATE: Evaluator dispatch is mandatory, not optional.**

At every batch boundary, dispatch an evaluator agent with **fresh context** (no shared state
with the generator). The evaluator runs the full 3-stage review from the `code-review` skill:

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

### Rework Budget

Each task gets **3 rework cycles** per quality gate:
- Cycle 1-2: Auto-fix and re-review (Standard/Full autonomy)
- Cycle 3: If still failing, **escalate to user** with full context:
  - What the evaluator found
  - What fixes were attempted
  - What's still failing and why

### Conflict Check Integration

If stories in `docs/stories/` have been modified since the plan was created:
- Re-run `conflict-check` before starting the next task
- If new conflicts found: halt and resolve before continuing

### State Management

Track all state in `.pipeline/`:

```
.pipeline/
├── config.yaml              # Autonomy level, project references
├── plan-ref.md              # Path to the active implementation plan
├── task-status.json         # Per-task status tracking
│   {
│     "task-1": {"status": "completed", "rework_cycles": 0},
│     "task-2": {"status": "in_progress", "rework_cycles": 1},
│     "task-3": {"status": "pending"}
│   }
└── audit-trail/
    ├── task-1/
    │   ├── review.json      # Evaluator verdict
    │   ├── rework-1.json    # First rework attempt (if any)
    │   └── commit.txt       # Final commit SHA
    ├── task-2/
    │   └── ...
    └── summary.json         # Aggregate stats for retro
```

### Parallel Execution (Full Autonomy Only)

When autonomy is set to Full and tasks have no dependencies:
- Dispatch multiple generator agents in parallel via the Agent tool
- Each agent works in an isolated git worktree
- Merge results after all parallel tasks complete and pass review
- If merge conflicts arise: resolve sequentially, re-run affected tests

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

At each batch boundary, perform a lightweight retro covering just the completed batch:

1. **Spec compliance** — Are all acceptance criteria for completed tasks covered by tests?
2. **Duplication check** — Has business logic been copy-pasted? Extract on 2nd occurrence.
3. **Complexity check** — Any methods >15 lines or >3 branches? Extract to service objects.
4. **Gate accuracy** — Did the evaluator catch real issues? Miss anything obvious?
5. **Autonomy friction** — Did any approval prompt fire more than once for the same action?

Record findings in `.pipeline/audit-trail/batch-N-retro.md`. These feed the full `/retro`
at the end, giving it phase-level granularity instead of just a single end-of-feature view.

### Memory Checkpoint (Per-Batch)

**GATE: Every batch must persist at least one `.memory/` entry before proceeding.**

At each batch boundary, ask:
- **Decisions** — What architectural choices were made? Why? → `.memory/decisions/`
- **Patterns** — What code patterns emerged or were reused? → `.memory/patterns/`
- **Gotchas** — What was surprising, tricky, or broke unexpectedly? → `.memory/gotchas/`
- **Context** — What domain knowledge was learned? → `.memory/context/`

Update `.memory/index.md` after each write. An empty `.memory/` at the end of a pipeline
run means the harness failed — future sessions will have no context for why decisions were made.

### Progress Log

Append to `.pipeline/progress.log` at every batch boundary. This is a chronological narrative
for cross-session continuity — when a new session starts, reading the last 30 lines tells the
agent exactly where things stand.

```
## Batch 1 — 2026-03-28 14:30
- Completed: task-1 (User model + validations), task-2 (registration endpoint)
- Rework: 0 cycles
- Issue hit: PostgreSQL JSONB casting needed explicit type (wrote .memory/gotchas/)
- Next up: task-3 (authentication)
- State: 2/13 tasks, all tests passing, branch merge-ready
```

The `session-start-context.sh` hook reads the last 30 lines of this file at session start.

### Git Revert Recovery

When the rework budget is exhausted (3 cycles failed), before escalating consider:

1. Find the last clean batch boundary commit: `git log --oneline | head -10`
2. Check if reverting to that commit and re-approaching would be faster than patching
3. If yes: `git revert --no-commit HEAD~N..HEAD` to undo the failed batch, then re-attempt

The last clean TDD commit is always a safe revert point. Each batch boundary produces a
merge-ready state, so reverting to one never loses unrelated work.

### Pipeline Summary

Track and surface:
- Tasks completed / total
- Rework cycles used
- Human interventions triggered
- Time between first task start and last task commit

This data feeds directly into the `retro` skill.

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
