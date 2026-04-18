---
name: pipeline
description: "Use when executing an implementation plan with multiple tasks. Factory orchestration with three autonomy levels, quality gates, rework budgets, and audit trails."
enforcement: structural
phase: build
standalone: false
requires: [".docs/plans/ with implementation plan"]
---

## Purpose

Orchestrates execution of an implementation plan through quality-gated stages. The conductor
(`bin/conduct`) drives the task loop — it parses the plan, iterates tasks, and sends one prompt
per task. Claude orchestrates each task by dispatching subagents for implementation. Subagent
context is isolated and discarded after completion, keeping the orchestrator's context lean.

## Execution Model

```
bin/conduct (bash)          Claude (orchestrator)         Subagent (implementer)
─────────────────          ─────────────────────         ──────────────────────
Parse plan, extract task →  Receive task context    →     Full TDD cycle
                            Dispatch subagent       →     RED → DOMAIN → GREEN
                            Verify result           ←     → DOMAIN → COMMIT
Check task-status.json  ←   Report PASS/FAIL              (context discarded)
Next task or evaluator
```

**Key constraint:** Claude MUST dispatch subagents for implementation via the Agent tool.
It must NOT implement directly in the orchestration session. This keeps the orchestrator's
context bounded to ~2-3 summary lines per task regardless of feature size.

## Practices

### Autonomy Levels

| Level | Human Role | Agent Authority | When to Use |
|-------|-----------|----------------|-------------|
| **Conservative** | Approves each task before execution | Sequential only, proposes before executing | First time using the harness, unfamiliar domain |
| **Standard** | Reviews at batch boundaries | Parallel agents on non-overlapping files, quality gates | Known domain, trusted test suite |
| **Full** | Reviews completed features | Parallel agents + parallel worktrees, auto-merge on green | Mature project, well-defined stories |

Default to **Standard** unless the user specifies otherwise.

### Pipeline Entry Guard (Early Exit)

Before loading any plan, validating tasks, or dispatching subagents, check
`.pipeline/task-status.json`:

```
jq -e 'all(.tasks[]; .status == "completed" or .status == "skipped")' .pipeline/task-status.json
```

If every task is already `completed` or `skipped`, write a one-line note to
`.pipeline/progress.log` ("pipeline entry: all N tasks already complete, exiting") and
return immediately — do NOT load plan text, dispatch the evaluator, or run any
subagent. The conductor's completion gate will read the JSON and advance.

This guard exists because a crashed session resumed against a fully-completed pipeline
otherwise loads the full skill text, dispatches the Plan-Validation step, and burns tokens
rediscovering there is nothing to do. Auto-heal (engine-side) handles drift between git
and the JSON; this guard handles the happy-path where the JSON is already correct.

### Per-Task Execution

The conductor marks the task as `in_progress` in `.pipeline/task-status.json`, then sends
one prompt to Claude. Claude orchestrates the task through these steps:

```
PLAN VALIDATION (at pipeline start):
  - Verify all task IDs from the plan exist in task-status.json
  - Flag missing tasks as errors before dispatching any work
  - Parse the Task Dependency Graph from `.docs/plans/` and build topological order

DEPENDENCY ORDER — Dispatch tasks in topological order respecting declared dependencies.
  Never skip a task unless its acceptance criteria are already satisfied (verified by test run).

0. UPDATE STATUS — Conductor marks task "in_progress" in .pipeline/task-status.json
1. DECOMPOSE    — Read task, identify files to touch, check dependencies met
2. DISPATCH     — Send task to a TDD subagent via Agent tool with model="sonnet" (scoped context only)
                  Subagent runs full TDD cycle: RED → DOMAIN → GREEN → DOMAIN → COMMIT
3. VERIFY       — Run the full test suite to confirm the subagent's work
4. FIX          — If tests fail, VERIFY failure first (see below), then dispatch subagent with error context
5. UPDATE       — Mark task as "completed" in .pipeline/task-status.json
6. REPORT       — Return PASS or FAIL with reason to the conductor
```

**Pre-completion scan (at pipeline start):** Before dispatching any tasks, check each task's
acceptance criteria against existing code and test coverage (git log, test files). Mark tasks
as `pre-completed` if criteria are already satisfied. Batch-verify in one pass — do not
dispatch individual subagents to discover "already done." If Task N's implementation was a
side effect of Task N-1 (verified by passing tests), auto-complete Task N with a note
referencing the completing task.

**Dependency checking (step 1):** Before dispatching the subagent, verify that all tasks
listed in the task's `**Dependencies:**` field are marked as completed in
`.pipeline/task-status.json`. If a dependency is not met, report BLOCKED to the conductor.

**Failure verification (step 4):** Before re-dispatching a failed task, run the test suite to
confirm the failure is real. If tests pass and commits exist for the task, mark as completed —
do not trust JSON state alone. JSON state can become stale after connection interruptions or
subagent context loss.

**Task status tracking is mandatory — write directly to `.pipeline/task-status.json`.**

Do NOT rely on conversation-level task tools (TaskCreate/TaskUpdate) for persistence — those
are ephemeral and lost between sessions. Write to the JSON file at each task boundary:
- Mark `in_progress` before dispatching the subagent
- Mark `completed` after tests pass and commit is confirmed

**Subagent context scoping:** The subagent receives ONLY:
- The task description and acceptance criteria (from the plan)
- File paths to modify (from the plan's "Files likely touched")
- The TDD skill instructions

The subagent does NOT receive the full plan, all stories, or prior task history.
The subagent handles the commit as part of the TDD COMMIT phase.

**Context efficiency:** Do not inline file contents in subagent prompts. Provide: file path,
line range of interest, and method signature. The subagent reads files as needed. For
sequential tasks on the same files, reuse the existing subagent via SendMessage instead of
spawning a new agent — this preserves file cache and avoids redundant reads.

**Scope discipline:** Subagents MUST only modify lines directly related to their assigned task.
Changes to unrelated code in the same file (e.g., changing a CI command while fixing a service
definition, or "improving" a method signature while adding a validation) are scope violations.
The evaluator should flag scope violations as IMPORTANT severity.

### Quality Gates

**HARD GATE: Evaluator dispatch is mandatory at required batch boundaries.**

**Rate limit cooldown: sleep 15 seconds before dispatching the evaluator** to avoid stacking
on top of the just-completed TDD agent's API usage.

At batch boundaries, dispatch an evaluator agent (see the model table below for the right
model per tier and batch position) with **fresh, scoped context** (no shared state with the
generator). Provide the evaluator with:
- The **git diff** for this batch only (not the full codebase)
- The **acceptance criteria** for this batch's tasks (extracted from stories, not full story files)
- The **test output summary** (pass/fail counts + failure snippets, not full verbose output)
- The tech-context review checklist if loaded in session
- **Prior known issues** (batch 2+) — collect findings from previous `audit-trail/batch-*/review.json`
  files and pass as a deduplicated list. This prevents the evaluator from re-raising the same
  finding across batches. Findings that appear in 2+ consecutive reviews auto-escalate in severity.

Do NOT send full story files, full plan files, or unrelated source files. The evaluator
runs the full 3-stage review from the `code-review` skill on this scoped context.

**Evaluator frequency + model scaling by complexity tier:**

| Tier | Intermediate batches | Final batch | Intermediate model | Final model |
|------|---------------------|-------------|--------------------|-------------|
| **Small** | Skipped | Always | — | Sonnet |
| **Medium** | Every 8 tasks | Always | **Sonnet** | **Opus** |
| **Large (>15 tasks)** | Every 4 tasks | Always | Sonnet | Opus |

Rationale: intermediate-batch reviews check compliance against a narrow diff + a handful
of acceptance criteria — a task Sonnet handles well. The final batch review evaluates
cross-batch integration and the full architectural picture, which is where Opus's deeper
reasoning pays off. Retro on the 2026-04-17 Medium run (31 tasks, 7 batches) showed all
4 intermediate evaluators could have run on Sonnet without verdict drift — they were the
largest single token line item in that run.

Pre-batch verification (full test suite, linter, `/simplify`) still runs at EVERY boundary
regardless of tier.

**Evaluator diff scope:** Always scope the evaluator to the **current batch's diff only**
(`git diff <batch-start-commit>..HEAD`), not the full branch diff. For the final batch,
add a lightweight integration check (full branch stat summary) but do NOT re-review earlier
batches line by line — they already passed their own evaluator gate.

**Enforcement — orchestrator writes, not the subagent.** After the evaluator agent
returns, the orchestrator (not the evaluator subagent) MUST perform these three actions
atomically before advancing one single token further:

1. `mkdir -p .pipeline/audit-trail/batch-N`
2. Write the full evaluator return (verdict, findings, severity, diff scope) to
   `.pipeline/audit-trail/batch-N/review.json`
3. Stat-check `test -s .pipeline/audit-trail/batch-N/review.json` — non-empty file must
   exist before the next batch starts

A missing or empty `review.json` is a hard gate: the pipeline MUST halt and dispatch the
evaluator again rather than advancing. Do NOT trust "the evaluator ran successfully in
the transcript" as evidence — only the file on disk counts. Past runs have silently
bypassed 4+ evaluator gates because the subagent result was summarized back to the
orchestrator but the write step was skipped; the file check is the only reliable
safeguard.

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

### Halt-and-Escalate (Explicit User-Input Required)

When pipeline detects a state that NO automated retry could resolve — a scope
mismatch between the complexity tier and the task list, an ambiguous requirement
that needs user judgement, a decision between two approaches where the plan
doesn't specify, etc. — do NOT output a rhetorical question like "here are
three options, what would you prefer?" as a wrap-up. Autonomous retries will
re-dispatch Claude against the same unresolved question and burn the retry
budget without producing new task completions.

Instead, write a marker file and exit:

```bash
mkdir -p .pipeline
echo "Need user decision: <one-line summary of the blocker>" > \
  .pipeline/halt-user-input-required
```

The conductor's build-retry loop checks for this file after each attempt. When
present, it:

1. Emits a `build_stall` event (reason: `halt_marker`).
2. Clears the marker (ack).
3. Opens an interactive Claude REPL scoped to the build step, so the user
   can discuss the blocker with Claude and take action.
4. Re-checks the completion predicate once the REPL exits.
5. Either succeeds (user + Claude resolved enough tasks) or falls into the
   normal recovery menu.

**Also triggered implicitly** when two consecutive build attempts produce zero
new task completions (measured via `.pipeline/task-status.json` resolved count).
So even if you forget to write the marker, the circuit breaker catches the
stall — but writing the marker is the polite contract: it labels the reason
and prevents a speculative second retry.

### Retry Pre-Check (Connection Interruption Recovery)

Before re-dispatching a task after a connection interruption or session resume:
1. Check for uncommitted changes (`git status`) — work may exist but not be committed
2. Check recent commits (`git log --oneline -3`) — subagent may have committed before disconnect
3. If work exists, verify it (run tests) before re-doing — do not blindly re-dispatch

This prevents wasting a full subagent dispatch to redo work that was already completed.

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
- Dispatch the `worktree-manager` agent with `model="haiku"` to create parallel worktrees under `.worktrees/`
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
- Verify architecture diagrams are current (if structural files changed in this batch, run `/architecture-diagram` in verification mode)
- Run a **micro-retro** (see below)
- Append to `.pipeline/progress.log` — a chronological narrative of what was done, what was
  tried, what worked, and what's next (see Progress Log below)
- Report batch status as a single line: `Batch N: X/Y PASS, Z rework`
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

**GATE: At final-task completion, write `.pipeline/summary.json` before marking the
pipeline done.** The retro skill reads this file; if it is missing, retro has to spawn an
Explore agent to recompute stats from git log + task-status.json. That is wasted tokens.

Required fields (all numeric unless noted):

```json
{
  "plan_ref": "<relative path to plan file>",
  "complexity_tier": "S|M|L",
  "autonomy_level": "conservative|standard|full",
  "tasks_total": 0,
  "tasks_completed": 0,
  "tasks_skipped": 0,
  "batches_total": 0,
  "batches_with_evaluator": 0,
  "rework_cycles_used": 0,
  "human_interventions": 0,
  "started_at": "<ISO-8601>",
  "completed_at": "<ISO-8601>",
  "elapsed_seconds": 0,
  "first_commit": "<SHA>",
  "last_commit": "<SHA>"
}
```

Counts come from `.pipeline/task-status.json` and `.pipeline/audit-trail/`. Timestamps
come from `session-created` (start) and the write time (end). Commit SHAs come from
`git log --format=%H --reverse <plan-ref-commit>..HEAD` (first + last).

Do NOT defer this to the `/retro` skill — by retro time the session may have compacted
mid-task telemetry. Write the file while the data is still in context.

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
