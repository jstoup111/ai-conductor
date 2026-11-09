---
name: pipeline
disable-model-invocation: true
description: "Use when executing an implementation plan with multiple tasks. Factory orchestration with ready-frontier parallelism, quality gates, rework budgets, and audit trails."
enforcement: structural
phase: build
standalone: false
requires: [".docs/plans/ with implementation plan"]
---

## Purpose

Orchestrates execution of an implementation plan. The host agent dispatches each task to a TDD
implementer through its available subagent facility; subagent context is discarded after each task.

## Execution Model

**Key constraint:** The selected host agent MUST dispatch implementers through its available
subagent facility. It must NOT implement directly in the orchestration session. This keeps the orchestrator's
context bounded to ~2-3 summary lines per task regardless of feature size.

**Host mechanics:** Claude Code uses its Agent tool and Claude model labels for this delegation.
Pi has no native facility; with `llm_providers.pi.subagents: true` the engine loads the
`pi-subagents` extension, and the orchestrator delegates each task with one
`subagent({ agent: "delegate", task: <dispatch prompt>, async: false })` call. Never shell out to
`pi` to delegate: a nested process runs outside the engine's model, sandbox, and accounting.
Other supported hosts use their native equivalent. These mechanics may differ, but they MUST
preserve the shared task scope, TDD cycle, task attribution, verification, review, and gate
contracts below.

## Practices

### Per-Task Execution

Line 1 of every subagent dispatch prompt MUST be `Task: <id>` (the bare plan header id, e.g.
`Task: 9`, never `task-9`), or `Task: none` for work that is not a plan task.
In Claude Code a PreToolUse session hook reads that line to stamp the task; if it blocks the
dispatch (exit 2), fix line 1 as its stderr says and redispatch. Other hosts use their native
attribution mechanism.

**Hosts without a session hook (Codex and Pi today) stamp through the CLI.** Neither has a PreToolUse
hook, so nothing writes `.pipeline/current-task` or flips the row to `in_progress` when a task is
dispatched. On such a host the orchestrator MUST run `conduct task start <id>` immediately before
each dispatch; that writes the stamp and marks the row `in_progress` as the hook would have done.
If a close is stampless, `conduct task done <id>` still applies the Done when close contract: it
records evidence for every declared check, or refuses and names a missing check. A completed or
skipped row may be re-closed without evidence and remains unchanged. After every `conduct task
done`, read `.pipeline/task-status.json` and confirm the row reads `completed` before reporting
the task done. Never report a task as "marked completed" on the strength of an exit code alone.

The selected host agent orchestrates
the task through these steps:

```
PLAN VALIDATION (at pipeline start):
  - Verify all task IDs from the plan exist in task-status.json
  - Flag missing tasks as errors before dispatching any work
  - Parse the Task Dependency Graph from `.docs/plans/` and build topological order

DEPENDENCY ORDER — Dispatch tasks in topological order respecting declared dependencies.
  Never skip a task unless its acceptance criteria are already satisfied (verified by test run).

0. DISPATCH MARKER — Line 1 of the implementer prompt is `Task: <id>` (see above). On a host
                   without the session hook, run `conduct task start <id>` first.
1. DECOMPOSE    — Read task, identify files to touch, check dependencies met
2. DISPATCH     — Send task to a TDD implementer through the selected host's available subagent facility
                  with scoped context only. In Claude Code, dispatch through the Agent tool with
                  Claude Code model="sonnet"; other supported hosts use their native model-selection mechanism.
                  Dispatch template's line 1 MUST be exactly `Task: <id>`. Implementer runs the full
                  TDD cycle: RED → DOMAIN → GREEN → DOMAIN → COMMIT.
                  Removal-shaped task (the task deletes a file, seam, flag, symbol, or code path)? The
                  implementer runs `/code-removal` for that task instead of opening a RED cycle — a
                  deletion has no failing test to write, and an absence assertion is never the subject.
                  `/code-removal` carries the survivor method, test triage, and completeness sweep; the
                  evidence is the deletion diff plus scoped survivor-test evidence;
                  `test_suite` owns configured suite verification.
3. VERIFY       — Inspect the implementer's scoped test evidence (see Scoped VERIFY below); run only a minimal targeted check if the evidence is missing or a concrete defect needs reproduction
4. FIX          — If tests fail, VERIFY failure first (see below), then dispatch implementer with error context
5. COMMIT       — The implementer commits. `Task:` trailers are telemetry (see Attribution
                  telemetry); a malformed trailer is never a reason to FAIL a task.
6. DONE         — Before reporting PASS, use the normal BUILD task-close path. For a task with a
                  declared `Done when:` block, close it with `conduct task done <id> --done-when <n>=<evidence>`
                  once for every declared check; the engine records the evidence through
                  `completeTaskDoneWhen` before it clears `.pipeline/current-task`. If a declared
                  `[test]` check is closed, use `--done-when <n>=test:<path>::<title>` for a committed
                  covering test, or `--unverified <n>=<reason>` when it cannot be verified. A missing
                  test for a tagged check is never `--plan-gap`. A check that needs a file the task's
                  `**Files:**` omits (a call site, union member, registry, or test) is not a plan gap:
                  change it and add `Scope: <repo-relative path> — <why>` beside the `Task:` trailer.
                  In a parallel batch, if another running task lists that file, return FAIL so the
                  orchestrator runs the two in sequence. Use
                  `conduct task done <id> --plan-gap <n> --reason <text>` and report the HALT only when no code
                  change can meet an untagged check or meeting it would contradict a story, the plan, or an ADR.
                  A `[test]` citation whose title cannot be provenance-verified as added since the
                  task began closes as `pending-judgement`; the conductor judges it when the BUILD session ends.
                  A refused citation returns as a retry hint naming the check and the judge's reason. Repair it by
                  writing or citing a test that asserts the check, or close that check with
                  `--unverified <n>=<reason>` when it cannot be verified.
                  For a legacy task with no `Done when:` block, close with `conduct task done <id>`.
                  Then read `.pipeline/task-status.json` and confirm the row reads `completed`.
7. REPORT       — Return PASS or FAIL with reason to the conductor
```

### Declared Replication Copy Task

When the plan has a resolved `**Pattern-source:**` / `**Rename-map:**` declaration, it MUST
contain exactly one declared copy task. That task is mechanical: it establishes the declared
source as the target's baseline and identifies the target's remaining delta; it does not decide
that a later task is complete or take ownership of that later task's acceptance criteria.

Before writing anything, derive every source-to-target pair from the resolved declaration and
validate the copy task's `**Files:**` declaration. It MUST list every target path the rename map
implies, and the copy task MUST write only those declared targets. An implied but undeclared path
is a failure: halt the task naming the undeclared path rather than writing outside its scope. A
copy task on a plan with no declaration likewise fails closed, naming the absent declaration.

Read every source and prepare every renamed target before modifying the worktree. If any source is
unreadable or any preparation fails, fail closed naming that file and leave no partial copied target
set behind. Only after that preflight may the task atomically write each declared target with the
source content transformed by the rename map. It consumes zero LLM turns or dispatches for the
copy itself.

The copy task remains an ordinary declared plan task: it retains its `Task: <id>` attribution and
commit ownership, and existing scoped verification, build review, and all lifecycle gates remain
enabled. The copy establishes a baseline only; each subsequent task retains its complete scope and
ownership unless its whole task is independently proven satisfied by the existing completion rules.

### Delta-only Execution and Whole-Task Satisfaction

After the declared copy commits, evaluate each later task against **every acceptance criterion** as
one task. When the copied commit satisfies the whole task, including its scoped verification, close
it with the existing empty-commit form `Evidence: satisfied-by <copy-sha>` plus `Task: <id>`;
`prd_audit` still judges that task's completion against the plan.

This is not a new evidence form or a shortcut around evidence derivation. The cited SHA must
resolve to an existing commit and be an ancestor of `HEAD`. A nonexistent or unresolvable SHA, or
a SHA that is not an ancestor of `HEAD`, fails derivation: the task remains incomplete and cannot
close through `Evidence: satisfied-by`.

If the copy satisfies only part of a task, or whether it satisfies a criterion is ambiguous, the
whole task is a delta task. Do not split its satisfied and unsatisfied criteria into separate
build-time tasks, and do not close any portion with `Evidence: satisfied-by`; run the complete,
unmodified TDD cycle — RED → DOMAIN → GREEN → DOMAIN → COMMIT — for that task. Ambiguity always
resolves toward the full cycle.

**Pre-completion scan (first BUILD entry only, never on a retry):** Before dispatching any tasks, check each task's
acceptance criteria against existing code and test coverage (git log, test files). Batch-verify in
one pass. A task already satisfied — including as a side effect of an earlier task, verified by
passing tests — closes with the `Evidence: satisfied-by <sha>` empty commit (see `/tdd`), not a
dispatch.

**Dependency checking (step 1):** Before dispatching the subagent, verify that all tasks
listed in the task's `**Dependencies:**` field are marked as completed in
`.pipeline/task-status.json`. If a dependency is not met, report BLOCKED to the conductor.

**Design-conformance check (step 1):** Before dispatching the subagent, confirm the task builds
toward — not against — the governing APPROVED design (the relevant ADR in `.docs/decisions/`
and the FR in the approved PRD). If a task would implement or harden a code path that a current
APPROVED ADR/PRD supersedes or forbids, do NOT dispatch it — report BLOCKED and escalate as a
conformance finding.

**Failure verification (step 4):** Before re-dispatching a failed task, run the **task's scoped
set** from step 3 VERIFY to confirm the failure is real. On a suite-failure kickback, include
the affected tests identified by the engine's failure evidence; never run the full suite.
If no scoped set can be identified, record that limitation rather than claiming verification
passed. If the scoped tests pass, required task evidence exists, and commits exist for the
task, mark it completed; aggregate proof remains pending at `test_suite`. Do not trust JSON
state alone: it can become stale after connection interruptions or subagent context loss.

**Superseded-symbol check (step 5 — replacement tasks):** Before marking a task `completed`
whose plan says it **replaces or supersedes** an existing symbol/behavior ("replace X",
"supersede Y", "swap the old path for the new"), grep that the superseded symbol has **zero
non-test callers** in production source:

```bash
grep -rn 'oldSymbol' src/ | grep -vE '\.test\.|/test/|/__tests__/'
```

If any production caller remains, the new code shipped **orphaned**: report the task FAIL with the
surviving call sites; do NOT mark it complete. Pair it with the real-entry-point test required by
`/writing-system-tests` (§3b).

### Attribution telemetry

Task stamping and `Task:` commit trailers are telemetry only. They help the engine
display progress and diagnose unattributed dispatches, but they never authorize a
mutation, reject a commit, decide task completion, halt a build, or park work. The
fresh `build_review` plan-versus-diff judgment is the BUILD completion authority.

Before every BUILD dispatch, the engine best-effort seeds `.pipeline/task-status.json` from the
selected plan.

**Task status tracking:** `.pipeline/task-status.json` is owned by the engine, its session hooks,
and `conduct task` — never hand-edit it. At ordinary BUILD closure, use
`conduct task done <id> --done-when <n>=<evidence>` for every declared check so the engine-owned
`completeTaskDoneWhen` writer records the task-level proof; use `conduct task done <id> --plan-gap <n> --reason <text>`
when step 6 requires it. Report each subagent's result (PASS/FAIL) to the conductor.

**SHIP validator verdict artifacts are read-only during BUILD.** `.pipeline/prd-audit.json` is the
typed PRD verdict authority (ADR D2.2), and `.pipeline/prd-audit.md` is its derived human report.
`.pipeline/architecture-review-as-built.md`, `.pipeline/architecture-review-as-built.json`,
`.pipeline/prd-audit-code-stamp.json`, and
`.pipeline/architecture-review-as-built-code-stamp.json` are owned by their SHIP validators and
the engine. BUILD sessions, including remediation retries that cite them, must never write, delete,
rename, or recreate them. Reading `.pipeline/remediation.json` and the cited verdict artifact remains allowed.
Only the validator's own next dispatch produces a new verdict. A BUILD session that fixes a finding
records its task-level proof through `conduct task done <id> --done-when <n>=<evidence>` instead of
editing a verdict artifact.

**Subagent context scoping:** The implementer receives ONLY:
- The task description, its `Done when:` checks, and the verbatim text of every story criterion
  and ADR decision mapped to it (SHIP grades that text, not the plan's paraphrase)
- File paths to modify (from the plan's "Files likely touched")
- The TDD skill instructions
- Every implementer dispatch prompt MUST carry this SHIP verdict read-only rule.
- A focused **current-HEAD pattern basis** when the task affects an established local pattern:
  current-checkout paths for the relevant target and exemplar, stable symbol or role hints that
  locate the behavior despite code movement, and the semantic traits the task must preserve or
  change. This basis covers only the affected task; it does not include the full plan, unrelated
  stories, or prior-task history. The implementer reads the named files at the current HEAD before
  acting.

The implementer does NOT receive the full plan, all stories, or prior task history.
The implementer handles the commit as part of the TDD COMMIT phase.

**Pattern-basis staleness:** A path, symbol, or exemplar named by the handoff is a locating aid,
not frozen source text. If the exemplar has moved, find and verify the semantic equivalent in the
current checkout. If no equivalent can be verified and that uncertainty would change the approach,
return `NEEDS_CONTEXT` to the orchestrator. Do not guess, copy obsolete code, or widen the task's
scope. This rule governs ordinary semantic pattern reuse only; it does not alter the declared
replication copy task's resolved source, rename-map, preflight, or exact-copy requirements.

**No branch hygiene by the implementer — stay on the branch as-is.** Every dispatch prompt MUST
instruct the implementer to NOT run `git fetch`, `git pull`, `git rebase`, or switch
branches. It commits only to the current feature branch. The only sanctioned rebase is the
daemon's finish-time rebase, outside the per-task loop.

**Context efficiency:** Do not inline file contents in subagent prompts. Provide current-checkout
paths, stable symbol or role hints, and the relevant semantic traits; never use line ranges as a
handoff contract. The subagent reads the current HEAD files as needed. For sequential tasks on the
same files, reuse the existing host-native implementer session instead of spawning a new agent —
this preserves file cache and avoids redundant reads.

**Scope discipline:** Implementers MUST only modify lines directly related to their assigned task.
Changes to unrelated code in the same file (e.g., changing a CI command while fixing a service
definition, or "improving" a method signature while adding a validation) are scope violations.
`prd_audit` grades them OVER_SCOPE. A file the task needs but its Files list omits is not a
violation; record it with a `Scope:` trailer.

**Scoped VERIFY (step 3):** Inspect the implementer's scoped evidence without routine reruns.
Missing evidence or a concrete suspected defect may require a minimal targeted check, never a suite.
Scoping logic:
1. Collect the task's diff (`git diff <pre-task-commit>..HEAD`) to identify new/modified production files.
2. Build the scoped test set: (a) all new/modified test files in the diff, plus (b) existing test
   files covering the modified production modules. Discover these by naming convention (e.g.,
   `src/foo/bar.ts` → `test/foo/bar.test.ts`) and by grepping test files for imports of or
   references to modified modules.
3. Match the supplied results to the changed behavior. If a targeted check is needed, derive
   minimal selectors from that set and use `ai-conductor scoped-run <selectors...>`.
4. Retain the named affected-test set for the batch-boundary union described below.

**Broad fallback:**
- A shared/core module has 3+ production importers.
- The diff touches config, migrations, dependency manifests, or test infrastructure.
- The scoped/affected set is empty.
- Module-to-test mapping is low-confidence and cannot be made confidently.

For per-task VERIFY, uncertainty defers aggregate proof; it does not waive known scoped
failures or the task's required RED/GREEN evidence.

When a trigger fires, state `Aggregate fallback: <exact trigger and reason>` in the task REPORT
and DEFER aggregate verification to the engine's dedicated aggregate gate (the `test_suite`
step), which owns whole-suite execution and its evidence. Never run the full suite — and never
invoke the aggregate verifier — inside the build session; the dedicated step will surface any
cross-cutting regression and route it back.

**Suite-failure kickback:** Read the engine's retry diagnostics and referenced
`.pipeline/test-suite-evidence.json`. Pass the relevant failure evidence and affected-test
selectors to repair subagents. Fix the failure, verify the scoped affected-test union
through `ai-conductor scoped-run <selectors...>`, then commit and leave the aggregate rerun to
`test_suite`. A scoped PASS does not establish an aggregate PASS.

**Build-review work order:** A retry carrying a `Build-review remediation work order` is the job
even when every task already reads completed. Each listed repair ends in a commit under its admitted
task id, or, if you judge it done or wrong, in `Need user decision: case <caseId> — <evidence>`
written to `.pipeline/halt-user-input-required`.

**Batch affected-test union:** At each batch boundary, compute one named
`BATCH_AFFECTED_TESTS` union by deduplicating every task's scoped affected-test set and retain
the supplied results. Do not rerun the union routinely. A concrete task-interaction risk or
changed behavior may justify a minimal targeted check through `ai-conductor scoped-run <selectors...>`.
When `BATCH_AFFECTED_TESTS` cannot be determined with confidence, record that in the REPORT and defer aggregate proof to the engine's dedicated aggregate gate — the build session never runs the full test suite.

**REPORT requirement (step 6):** The task's step 6 REPORT must list the files included in the
scoped test set (or, if a fallback trigger fired, state the trigger, the tests actually run, and the deferred aggregate proof).
This provides audit-trail visibility into the scoping decision.

### Halt-and-Escalate (Explicit User-Input Required)

When pipeline detects a state that NO automated retry could resolve — a scope
mismatch between the complexity tier and the task list, an ambiguous requirement
that needs user judgement, a decision between two approaches where the plan
doesn't specify, etc. — do NOT output a rhetorical question like "here are
three options, what would you prefer?" as a wrap-up. Autonomous retries will
re-dispatch the host agent against the same unresolved question and burn the retry
budget without producing new task completions.

If you're tempted to ask "resolve now or exit to the harness?", you must
instead write the halt marker — the user picking "exit" is a halt, not a
successful exit. See "User-requested exit during a run" below.

Instead, write a marker file and exit:

```bash
mkdir -p .pipeline
echo "Need user decision: <one-line summary of the blocker>" > \
  .pipeline/halt-user-input-required
```

In interactive runs the conductor then opens a session so the user can resolve the blocker. In
daemon runs it routes the question once to `/remediate`, which either answers it (the build resumes
with the answer) or escalates it to a human with your question verbatim — so make the one-line
question self-contained.

### User-requested exit during a run

If the user explicitly asks to "exit to the harness", "stop and continue
later", "pause", or anything equivalent at any point in the run, treat it
as a halt — **not** as a successful exit. Before exiting, you MUST:

1. Write `.pipeline/halt-user-input-required` with a one-line summary of the
   next action (e.g. `"user requested exit; 1 regression in test_X pending fix"`).
2. Do NOT mark unfinished tasks as `completed` or `skipped`.

Without the marker the conductor can read the build as done and cascade into SHIP.

### Retry Pre-Check (Connection Interruption Recovery)

After a connection interruption or session resume, inspect recent commits
(`git log --oneline -3`) and verify existing work before redoing it. The engine refuses to complete
BUILD with a dirty tree.

### Rework Budget

Each task gets **3 rework cycles** per quality gate. If it still fails after the third, write the
halt marker (see Halt-and-Escalate) naming what the evaluator found, what was tried, and what still
fails.

### Parallel Execution

Every plan MUST schedule work by **ready frontier**, not by walking the plan one task at a time. At
pipeline start and after every join, build the ready frontier from pending tasks whose declared
dependencies are completed, then exclude any pair with overlapping likely-touched files. Dependent
or overlapping-file tasks stay sequential and move to the next frontier after the earlier task
completes.

**The parallel cap X.** Dispatch at most 3 independent tasks concurrently, and never more than the
host can run at once. Before each fan-out, set X = min(3, free sub-agent slots on this host):

- **Codex** states its capacity in its multi-agent instructions ("There are N available
  concurrency slots… including you"). Free slots are N − 1 (this session) minus any sub-agents
  already active. The operator raises N with `[agents] max_threads` in `~/.codex/config.toml`.
- **Claude Code** allows `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS` concurrent Agent-tool sub-agents
  per session (default 20). Free slots are that limit minus sub-agents already running, so X is
  normally 3.
- A host with no native concurrent-dispatch facility has 0 free slots.

When X = 1 (one free slot, none, or a frontier of one task), run the frontier sequentially, one at a
time, in this session. That is a normal schedule, not a failure: never halt or ask the operator to choose
a mode because fewer slots are free. Record X for each frontier in the batch-boundary report so the
reduced parallelism is visible.

Daemon concurrency does not change X. Each daemon dispatch is its own host session with its own
slots.

When X ≥ 2 and the ready frontier holds two or more independent tasks,
use one host-native fan-out operation to dispatch up to X of them concurrently. Do not emit one
dispatch, wait for it, and then emit the next. The provider-specific seams are explicit:

- Claude Code performs one response containing multiple Agent tool dispatches, one per selected
  task, then waits for all dispatched agents to return.
- Codex performs one response containing multiple `collaboration.spawn_agent` calls, one per
  selected task, then waits for all dispatched agents to return with `collaboration.wait_agent`.

Parallel agents share the same directory, so their file sets must not overlap.

### Batch Boundaries

At natural batch boundaries (after completing a group of related tasks):

**Pre-batch verification (before starting next batch):**
- Inspect the supplied results for `BATCH_AFFECTED_TESTS`; do not rerun the union as a ritual.
  If ANY test fails that is NOT an expected RED test, stop and fix before proceeding.
- Verify the current branch is merge-ready: no WIP commits, no TODO-fixme code added this batch,
  all new code has tests. The branch should be shippable at any batch boundary, even if the
  feature is incomplete.

**Post-batch checks:**
- Run the linter (if tech-context specifies one)
- Run the `simplify` workflow to check for accumulated duplication (dry business logic, not dry
  code; Claude `/simplify`; Codex `$simplify`).
  If dispatched through the selected host's available subagent facility, the `/simplify` dispatch prompt's first line MUST be
  `Task: none` (session-hook marker contract, see Per-Task Execution).
- Verify architecture diagrams are current (if structural files changed in this batch, run the
  `architecture-diagram` workflow in verification mode; Claude `/architecture-diagram`; Codex
  `$architecture-diagram`)
- Append to `.pipeline/progress.log` — a chronological narrative of what was done, what was
  tried, what worked, and what's next (see Progress Log below)
- Report batch status as a single line: `Batch N: <passed>/<total> PASS, <rework> rework, cap X`
- Continue unless the user intervenes

### Memory Checkpoint (Per-Batch)

**GATE: Every batch must persist at least one `.memory/` entry before proceeding.**

Persist decisions, patterns, gotchas, or context learned during the batch. Update `.memory/index.md` after each write. If dispatched through the selected host's available subagent facility, the memory-checkpoint dispatch prompt's first line MUST be `Task: none` (session-hook marker contract, see Per-Task Execution).

### Progress Log

Append to `.pipeline/progress.log` at every batch boundary — a chronological narrative for cross-session continuity.

### Git Revert Recovery

When the rework budget is exhausted, consider reverting to the last clean batch boundary commit (`git revert --no-commit HEAD~N..HEAD`) and re-approaching rather than continuing to patch. Each batch boundary is a merge-ready state, so reverting never loses unrelated work.

### Pipeline Summary

**At final-task completion, write `.pipeline/summary.json` before marking the pipeline done:**
`{"plan_ref": "<plan path>", "tasks_total": N, "tasks_completed": N, "tasks_skipped": N}`, counted
from `.pipeline/task-status.json`. The engine reads `tasks_completed` as completion evidence.

## Verification

- [ ] Parallel cap X computed from free host slots before each fan-out
- [ ] Each task followed the TDD cycle (or `/code-removal` for a removal task)
- [ ] Every subagent dispatch's line 1 is exactly `Task: <id>` or `Task: none`
- [ ] No `completed` status was hand-written
- [ ] Rework budget tracked (halt marker at 3 cycles)
- [ ] `.pipeline/summary.json` written at final-task completion
