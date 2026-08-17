---
name: pipeline
description: "Use when executing an implementation plan with multiple tasks. Factory orchestration with three autonomy levels, quality gates, rework budgets, and audit trails."
enforcement: structural
phase: build
standalone: false
requires: [".docs/plans/ with implementation plan"]
---

## Purpose

Orchestrates execution of an implementation plan through quality-gated stages. The configured
harness runner drives the task loop — it parses the plan, iterates tasks, and sends one prompt
per task. The selected host agent orchestrates each task by dispatching implementers through its
available subagent facility. Subagent
context is isolated and discarded after completion, keeping the orchestrator's context lean.

## Execution Model

```
Harness runner              Host agent (orchestrator)    Subagent (implementer)
──────────────              ─────────────────────         ──────────────────────
Parse plan, extract task →  Receive task context    →     Full TDD cycle
                            Dispatch subagent       →     RED → DOMAIN → GREEN
                            Verify result           ←     → DOMAIN → COMMIT
Check task-status.json  ←   Report PASS/FAIL              (context discarded)
Next task or evaluator
```

**Key constraint:** The selected host agent MUST dispatch implementers through its available
subagent facility. It must NOT implement directly in the orchestration session. This keeps the orchestrator's
context bounded to ~2-3 summary lines per task regardless of feature size.

**Host mechanics:** Claude Code uses its Agent tool and Claude model labels for this delegation.
Other supported hosts use their native equivalent. These mechanics may differ, but they MUST
preserve the shared task scope, TDD cycle, task attribution, verification, review, and gate
contracts below.

## Practices

### Autonomy Levels

| Level | Human Role | Agent Authority | When to Use |
|-------|-----------|----------------|-------------|
| **Conservative** | Approves each task before execution | Sequential only, proposes before executing | First time using the harness, unfamiliar domain |
| **Standard** | Reviews at batch boundaries | Parallel agents on non-overlapping files, quality gates | Known domain, trusted test suite |
| **Full** | Reviews completed features | Parallel agents + parallel worktrees, auto-merge on green | Mature project, well-defined stories |

Default to **Standard** unless the user specifies otherwise.

### Per-Task Execution

Task stamping is engine machinery, not an orchestrator instruction. In Claude Code, a
Claude Code session PreToolUse hook, installed into the build worktree at provisioning time (see
`adr-2026-07-10-session-hook-task-stamping.md`), inspects **line 1 only** of every
subagent dispatch prompt. `Task: <id>` (id = bare plan header id, e.g. `Task: 9`, never
`task-9`) flips that row to `in_progress` in `.pipeline/task-status.json` and writes
`.pipeline/current-task`; `Task: none` passes through untouched. A missing or malformed
line-1 marker, or an id not present in `task-status.json`, is BLOCKED (hook exit 2) with
instructive stderr — fix the dispatch prompt's first line and redispatch. If a different
task's stamp is already present (overlap), the hook still flips the new row but clears
the stamp file, so the commit-msg hook abstains from attribution rather than guessing —
never a wrong stamp. A symmetric PostToolUse hook removes `.pipeline/current-task` on
subagent return iff its content still matches that dispatch's id. Other supported hosts use their
native task-attribution mechanism to preserve the same marker, state, and recovery contract.
The selected host agent orchestrates
the task through these steps:

```
PLAN VALIDATION (at pipeline start):
  - Verify all task IDs from the plan exist in task-status.json
  - Flag missing tasks as errors before dispatching any work
  - Parse the Task Dependency Graph from `.docs/plans/` and build topological order

DEPENDENCY ORDER — Dispatch tasks in topological order respecting declared dependencies.
  Never skip a task unless its acceptance criteria are already satisfied (verified by test run).

0. DISPATCH MARKER — Before dispatching, ensure the implementer prompt's FIRST LINE will be
                   `Task: <id>` (bare plan header id, e.g. `Task: 9`, never `task-9`). This is
                   the contract the session hook enforces mechanically (see above) — you do not
                   run any CLI command for this step. If the hook blocks the dispatch (exit 2,
                   stderr names the fix), correct the prompt's line 1 and redispatch; if
                   `.pipeline/current-task` doesn't show the expected id after a successful
                   dispatch, treat it as a configuration issue (forward-progress check will halt).
                   Crash recovery: if a session restarts mid-task, manually reset the task back to
                   `pending` in .pipeline/task-status.json (same approach as before).
1. DECOMPOSE    — Read task, identify files to touch, check dependencies met
2. DISPATCH     — Send task to a TDD implementer through the selected host's available subagent facility
                  with scoped context only. In Claude Code, dispatch through the Agent tool with
                  Claude Code model="sonnet"; other supported hosts use their native model-selection mechanism.
                  Dispatch template's line 1 MUST be exactly `Task: <id>` — <id> is the bare PLAN header id (e.g. 9, not task-9).
                  Implementer includes it as a trailer in all commits (including refactors); implementer amends before PASS
                  if the trailer is malformed. Implementer runs full TDD cycle: RED → DOMAIN → GREEN → DOMAIN → COMMIT
3. VERIFY       — Run `conduct-ts scoped-run <selectors...>` for the scoped affected-test set (see Scoped VERIFY below) to confirm the implementer's work
4. FIX          — If tests fail, VERIFY failure first (see below), then dispatch implementer with error context
5. COMMIT       — Verify the implementer's commit carries the `Task: <id>` trailer with <id> as the bare plan id
                  (e.g. Task: 9, not Task: task-9). The trailer is non-authoritative routing
                  telemetry: it routes the build→build_review handoff, but `build_review`
                  judges/derives actual completion from a plan-vs-diff comparison (union of
                  trailer-tagged and diff-resolved tasks); the orchestrator never writes
                  `completed` itself. If the trailer uses task-N format, report FAIL and dispatch for fix
6. DONE         — After the implementer's commit lands on the branch, the host-native attribution mechanism
                  (the Claude Code PostToolUse hook uses the same matcher as step 0/2) removes `.pipeline/current-task` once the implementer
                  returns, iff its content still matches this dispatch's id — no CLI invocation
                  needed. It never writes `completed`; the `Task: <id>` trailer verified in step 5
                  only routes the handoff to `build_review`, which is the actual completion
                  authority. If state ever needs manual correction (e.g. after a crash),
                  `conduct-ts task start/done` remain available as operator/recovery commands,
                  but are not part of the normal per-task flow.
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

**Failure branches:**

- If the `**Files:**` declaration omits a rename-map-implied target, fail the copy task and name
  that undeclared target. Do not write it or any other path outside the declaration.
- If a source is unreadable at copy time, fail closed and name that source. Because preflight
  completes before any write, write no copy target and leave no partially copied target set.
- If a copy task has no resolved `**Pattern-source:**` / `**Rename-map:**` declaration, fail the
  copy task naming the absent declaration; do not infer a source or proceed with a copy.

The copy task remains an ordinary declared plan task: it retains its `Task: <id>` attribution and
commit ownership, and existing scoped verification, build review, and all lifecycle gates remain
enabled. The copy establishes a baseline only; each subsequent task retains its complete scope and
ownership unless its whole task is independently proven satisfied by the existing completion rules.

### Delta-only Execution and Whole-Task Satisfaction

After the declared copy commits, evaluate each later task against **every acceptance criterion** as
one task. When the copied commit satisfies the whole task, including its scoped verification, close
it with the existing empty-commit form `Evidence: satisfied-by <copy-sha>` plus `Task: <id>`; the
normal completeness rubric still evaluates that task against the plan.

This is not a new evidence form or a shortcut around evidence derivation. The cited SHA must
resolve to an existing commit and be an ancestor of `HEAD`. A nonexistent or unresolvable SHA, or
a SHA that is not an ancestor of `HEAD`, fails derivation: the task remains incomplete and cannot
close through `Evidence: satisfied-by`.

If the copy satisfies only part of a task, or whether it satisfies a criterion is ambiguous, the
whole task is a delta task. Do not split its satisfied and unsatisfied criteria into separate
build-time tasks, and do not close any portion with `Evidence: satisfied-by`; run the complete,
unmodified TDD cycle — RED → DOMAIN → GREEN → DOMAIN → COMMIT — for that task. Ambiguity always
resolves toward the full cycle.

**Pre-completion scan (at pipeline start):** Before dispatching any tasks, check each task's
acceptance criteria against existing code and test coverage (git log, test files). Mark tasks
as `pre-completed` if criteria are already satisfied. Batch-verify in one pass — do not
dispatch individual subagents to discover "already done." If Task N's implementation was a
side effect of Task N-1 (verified by passing tests), auto-complete Task N with a note
referencing the completing task.

**Dependency checking (step 1):** Before dispatching the subagent, verify that all tasks
listed in the task's `**Dependencies:**` field are marked as completed in
`.pipeline/task-status.json`. If a dependency is not met, report BLOCKED to the conductor.

**Design-conformance check (step 1):** Before dispatching the subagent, confirm the task builds
toward — not against — the governing APPROVED design (the relevant ADR in `.docs/decisions/`
and the FR in the approved PRD). This is the BUILD-phase instance of the harness-wide
**design-conformance-before-effort** convention in the repository harness documentation. If a task would
implement or harden a code path that a current APPROVED ADR/PRD supersedes or forbids, do NOT
dispatch it — report BLOCKED and escalate as a conformance finding. Writing code slated for
deletion is wasted effort; the cheapest check (one ADR/PRD read) precedes the most expensive
action (a full TDD subagent dispatch + review cycle).

**Failure verification (step 4):** Before re-dispatching a failed task, run the **task's scoped set** (the same set used in step 3 VERIFY, or the full suite if a fallback trigger fired in step 3) to confirm the failure is real. Running the same scope ensures comparable signal — same false-positive/false-negative risk. If tests pass and commits exist for the task, mark as completed — do not trust JSON state alone. JSON state can become stale after connection interruptions or subagent context loss.

**Superseded-symbol check (step 5 — replacement tasks):** Before marking a task `completed`
whose plan says it **replaces or supersedes** an existing symbol/behavior ("replace X",
"supersede Y", "swap the old path for the new"), grep that the superseded symbol has **zero
non-test callers** in production source:

```bash
grep -rn 'oldSymbol' src/ | grep -vE '\.test\.|/test/|/__tests__/'
```

If any production caller remains, the new code shipped **orphaned** — the live path still runs
the OLD behavior while green unit tests pass against the new function (the orphaned-primitive
escape that recurred across ~5 consecutive Phase-9 features, each caught late by the
fresh-context evaluator). Report the task FAIL with the surviving call sites; do NOT mark it
complete. This is a cheap mechanical gate that runs **before** the expensive batch-evaluator
dispatch, so the class fails fast. Pair it with the real-entry-point acceptance test required by
`/writing-system-tests` (§3b): the acceptance test proves the new path runs; this grep proves
the old one is gone.

### Attribution telemetry

Task stamping and `Task:` commit trailers are telemetry only. They help the engine
display progress and diagnose unattributed dispatches, but they never authorize a
mutation, reject a commit, decide task completion, halt a build, or park work. The
fresh `build_review` plan-versus-diff judgment is the BUILD completion authority.

Before every BUILD dispatch, the engine best-effort seeds
`.pipeline/task-status.json` from the selected plan. Missing or unwritable telemetry
warns and continues; it is never a lifecycle gate. The retired
`attribution_enforcement_cutover` and `attribution_judge_cutover` config keys are no
longer accepted — a config file still setting either fails to load with an unknown
top-level key error.

**Task status tracking:** `.pipeline/task-status.json` is owned entirely by the engine and its
session hooks — you (the orchestrator) do NOT hand-edit this file, and you do NOT run
`conduct-ts task start/done` as part of normal per-task flow. The PreToolUse session
hook stamps `in_progress` on dispatch, keyed off the dispatch prompt's line-1
`Task: <id>` / `Task: none` marker (see Per-Task Execution above). The
CLI verbs still exist for operator/recovery use (e.g. resetting a task after a crash), never as a
step you invoke mid-pipeline. You report the subagent's result (PASS/FAIL) to inform the
conductor's logging and audit trail.

**Subagent context scoping:** The implementer receives ONLY:
- The task description and acceptance criteria (from the plan)
- File paths to modify (from the plan's "Files likely touched")
- The TDD skill instructions
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
branches. It commits only to the current feature branch. Mid-build fetch/rebase is how a feature
branch silently auto-rebased onto a moved `origin/main` and stalled in a CHANGELOG conflict that
blocked the commit. The **only** sanctioned rebase is the daemon's finish-time rebase-onto-latest
(9.0, with conflict → HALT + CHANGELOG auto-resolver); it is daemon-gated and runs outside the
per-task loop. Implementation agents never integrate upstream themselves.

**Context efficiency:** Do not inline file contents in subagent prompts. Provide current-checkout
paths, stable symbol or role hints, and the relevant semantic traits; never use line ranges as a
handoff contract. The subagent reads the current HEAD files as needed. For sequential tasks on the
same files, reuse the existing host-native implementer session instead of spawning a new agent —
this preserves file cache and avoids redundant reads.

**Scope discipline:** Implementers MUST only modify lines directly related to their assigned task.
Changes to unrelated code in the same file (e.g., changing a CI command while fixing a service
definition, or "improving" a method signature while adding a validation) are scope violations.
The evaluator should flag scope violations as IMPORTANT severity.

**Scoped VERIFY (step 3):** Per-task VERIFY runs only the affected-test set, not the full suite.
Scoping logic:
1. Collect the task's diff (`git diff <pre-task-commit>..HEAD`) to identify new/modified production files.
2. Build the scoped test set: (a) all new/modified test files in the diff, plus (b) existing test
   files covering the modified production modules. Discover these by naming convention (e.g.,
   `src/foo/bar.ts` → `test/foo/bar.test.ts`) and by grepping test files for imports of or
   references to modified modules.
3. The agent derives the selectors from that scoped set and runs `conduct-ts scoped-run <selectors...>`.
4. Retain the named affected-test set for the batch-boundary union described below.

**Broad fallback:**
- A shared/core module has 3+ production importers.
- The diff touches config, migrations, dependency manifests, or test infrastructure.
- The scoped/affected set is empty.
- Module-to-test mapping is low-confidence and cannot be made confidently.

For per-task VERIFY, uncertainty resolves toward this fallback scope — scoping is an
optimization, never a gate change.

When a trigger fires, state `Aggregate fallback: <exact trigger and reason>` and invoke the
repository-configured aggregate verifier interface. Do not call the project's aggregate command
directly. The task REPORT names the trigger and fallback scope.

**Batch affected-test union:** At each batch boundary, compute one named
`BATCH_AFFECTED_TESTS` union by deduplicating every task's scoped affected-test set, then run
that union once to catch regressions from task interactions.

Batch verification MUST run only the named `BATCH_AFFECTED_TESTS` union.
The evaluator MUST receive that same `BATCH_AFFECTED_TESTS` union and its result set.
Only when `BATCH_AFFECTED_TESTS` cannot be determined with confidence MUST the full test suite run instead.

**REPORT requirement (step 6):** The task's step 6 REPORT must list the files included in the
scoped test set (or, if a fallback trigger fired, state the trigger and fallback scope).
This provides audit-trail visibility into the scoping decision.

### Quality Gates

**HARD GATE: Evaluator dispatch is mandatory at required batch boundaries.**

**Rate limit cooldown: sleep 15 seconds before dispatching the evaluator** to avoid stacking
on top of the just-completed TDD agent's API usage.

At batch boundaries, dispatch an evaluator through the selected host's available subagent facility (see the model table below for the right
model per tier and batch position) with **fresh, scoped context** (no shared state with the
generator). The evaluator dispatch prompt's FIRST LINE MUST be exactly `Task: none` — the
host-native attribution mechanism (the Claude Code session hook on Agent-tool dispatches) enforces
this marker; a missing or malformed line 1 blocks the dispatch. Provide the evaluator with:
- The **git diff** for this batch only (not the full codebase)
- The **acceptance criteria** for this batch's tasks (extracted from stories, not full story files)
- The named **`BATCH_AFFECTED_TESTS` union and its result summary** (pass/fail counts + failure
  snippets, not full verbose output), or the full-suite fallback result when the union was indeterminate
- The tech-context review checklist if loaded in session
- The same focused **current-HEAD pattern basis** supplied to each affected task's implementer:
  current-checkout paths, stable symbol or role hints, and the relevant semantic traits. The
  evaluator reads those files at current HEAD and applies the same staleness rule: locate and
  verify a moved exemplar's semantic equivalent; if none can be verified and the review approach
  would materially change, return `NEEDS_CONTEXT` rather than guessing, relying on obsolete code,
  or widening the review scope.
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

Pre-batch verification (`BATCH_AFFECTED_TESTS` or its indeterminate-scope fallback, linter,
`/simplify`) still runs at EVERY boundary regardless of tier.

**Evaluator diff scope:** Always scope the evaluator to the **current batch's diff only**
(`git diff <batch-start-commit>..HEAD`), not the full branch diff. For the final batch,
add a lightweight integration check (full branch stat summary) but do NOT re-review earlier
batches line by line — they already passed their own evaluator gate.

**Enforcement — orchestrator writes, not the evaluator.** After the evaluator
returns, the orchestrator (not the evaluator) MUST perform these actions
atomically before advancing one single token further:

1. `mkdir -p .pipeline/audit-trail/batch-N`
2. Write the full evaluator return (verdict, findings, severity, diff scope) to
   `.pipeline/audit-trail/batch-N/review.json`
3. Stat-check `test -s .pipeline/audit-trail/batch-N/review.json` — non-empty file must
   exist before the next batch starts
4. Record the completed `evaluator` closeout obligation with
   `conduct-ts closeout-event evaluator <started-at-ms> <ended-at-ms>`, then verify that
   `.pipeline/pipeline-events.jsonl` contains a parseable `pipeline_closeout` record whose
   `obligation` is exactly `evaluator`. An event for another obligation does not satisfy this check.

A missing or empty `review.json` remains an independent hard gate: the pipeline MUST halt and
dispatch the evaluator again rather than advancing. A missing, malformed, or non-matching
closeout record is a second hard gate: the pipeline MUST halt with
`Batch N blocked: missing recorded closeout event for evaluator` and record the matching event
before advancing. Do NOT trust "the evaluator ran successfully in the transcript" as evidence —
only the required files on disk count. Past runs have silently bypassed 4+ evaluator gates
because the subagent result was summarized back to the orchestrator but the write step was
skipped; the file checks are the only reliable safeguard.

Evaluate both gates independently: a valid evaluator closeout record cannot cure an empty
`review.json`, and a non-empty review cannot cure an absent or mismatched evaluator record.

This closeout-event gate applies only to pipeline sessions started after the closeout-event
emitter is available. A build already in flight when that emitter ships is exempt: do not
retroactively block it for an event that its running session had no way to write. The existing
`review.json` gate still applies to every session.

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

**Interactive mode (unchanged):** The conductor's build-retry loop checks for this file after each attempt. When
present, it:

1. Emits a `build_stall` event (reason: `halt_marker`).
2. Clears the marker (ack).
3. Opens the selected host's native interactive session scoped to the build step; in Claude Code,
   this is an interactive Claude REPL, so the user can discuss the blocker and take action.
4. Re-checks the completion predicate once the REPL exits.
5. Either succeeds (user + host agent resolved enough tasks) or falls into the
   normal recovery menu.

This REPL escalation path is unaffected by daemon-mode routing below — it applies only
when the conductor is attached to an interactive terminal.

**Daemon mode (ADR-2026-07-10):** The daemon's build-retry loop has no interactive REPL to
fall back to, so it routes the halt marker through a single bounded `/remediate` pass before
escalating to a human:

1. **Capture first.** The marker content (the question) is read and written verbatim to
   `.pipeline/build-stall-question.md` *before* the halt marker itself is cleared
   (`clearHaltMarker`) — the question is durably captured on disk before the ack, so it can
   never be lost between detection and dispatch.
2. Dispatches the `/remediate` skill once with `hintSource: { source: 'build_stall',
   evidenceFile: '.pipeline/build-stall-question.md' }`. This is a single bounded attempt —
   daemon mode does not loop `/remediate` against the same stall.
3. **If answerable** — the planner returns a `build` disposition with the answer in `rationale`
   and `tasks: []`. The conductor resumes the retry loop (no retry burned) with the answer
   as context, and the build proceeds with the agent's question resolved.
4. **If unanswerable** — the planner returns a `halt` disposition (category: `architectural-clarity`,
   `product-scope`, or `unanswerable`). The conductor writes `.pipeline/HALT` with the original
   question preserved verbatim and escalates for human triage.
5. **Fail-safe** — if remediation fails, the budget is exhausted, or `/remediate` returns
   `none`, the conductor writes `.pipeline/HALT` **carrying the question verbatim** and stops.
   The operator never loses sight of what the agent needed.

**Budget:** Stall remediations share the existing `MAX_KICKBACKS_PER_GATE` remediation budget
(not a separate counter). Multiple stalls in one run consume the shared budget; once exhausted,
subsequent stalls go straight to HALT without remediation dispatch. This prevents ask→answer→ask
loops while keeping the fallback path safe.

**Also triggered implicitly** when a build attempt produces zero new task
completions (the attributed count from `.pipeline/task-status.json`/`Task:`
trailers doesn't move) AND HEAD doesn't move that same attempt — the
attributed count alone is advisory routing/telemetry and can never by itself
kill a build; commit movement is the liveness authority
(adr-2026-07-23-commit-movement-liveness-floor). An attempt that lands real,
committed work without a `Task:` trailer is never misread as a stall. So even
if you forget to write the marker, the circuit breaker catches a genuine
wedge — but writing the marker is the polite contract: it labels the reason
and prevents a speculative second retry.

### User-requested exit during a run

If the user explicitly asks to "exit to the harness", "stop and continue
later", "pause", or anything equivalent at any point in the run, treat it
as a halt — **not** as a successful exit. Before exiting, you MUST:

1. Write `.pipeline/halt-user-input-required` with a one-line summary of the
   next action (e.g. `"user requested exit; 1 regression in test_X pending fix"`).
2. If a task is currently in-flight (marked `in_progress` by the session hook's dispatch
   stamp), reset it back to `pending` in `.pipeline/task-status.json` so the conductor's
   build gate will re-enter the task on resume rather than treating it as
   completed (crash-recovery pattern: manually edit the JSON if a session
   restarts mid-task).
3. Do NOT mark unfinished tasks as `completed` or `skipped`. Only tasks
   that genuinely passed all TDD gates this run get `completed`.

This contract is mandatory. Without the marker, the conductor reads
`task-status.json`, sees nothing in flight, and concludes the build step
is done — silently cascading through `manual-test` / `retro` / `finish`
to mark the entire feature complete while the user's actual blocker is
still open. The build-completion predicate in
the build-completion predicate checks for the
halt marker on every attempt; a marker present at gate-check time fails
the gate.

### Retry Pre-Check (Connection Interruption Recovery)

The engine mechanically evaluates the working tree before BUILD completion and before an
exhausted build may route on commit movement. When its status probe reports dirty paths, the
tree is not eligible to complete or route; the halt names those paths until they are committed or
discarded. A missing or failed probe preserves the legacy fail-open behavior.

For connection interruption or session-resume diagnosis, inspect recent commits
(`git log --oneline -3`) and verify existing work before redoing it. Do not rely on an implementer
remembering a prompt-level dirty-tree check: the engine enforces the condition.

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

Standard and Full autonomy MUST schedule work by **ready frontier**, not by walking the plan one
task at a time. At pipeline start and after every join, build the ready frontier from pending tasks
whose declared dependencies are completed, then exclude any pair with overlapping likely-touched
files. Dependent or overlapping-file tasks stay sequential and move to the next frontier after the
earlier task completes. Conservative autonomy remains sequential and does not require fan-out.

When a Standard or Full ready frontier contains two or more independent tasks, use one host-native
fan-out operation to dispatch up to 3 independent tasks concurrently. Do not emit one dispatch,
wait for it, and then emit the next. The provider-specific seams are explicit:

- Claude Code performs one response containing multiple Agent tool dispatches, one per selected
  task, then waits for all dispatched agents to return.
- Codex performs one response containing multiple `collaboration.spawn_agent` calls, one per
  selected task, then waits for all dispatched agents to return with `collaboration.wait_agent`.

Before the first Standard or Full fan-out, verify that the selected host exposes its native
concurrent-dispatch facility. If native fan-out is unavailable or unsupported, fail closed before
task mutation: report the selected provider, the missing fan-out capability, and the recovery action
(use a supported host or explicitly restart in Conservative autonomy). Never silently serialize a
Standard or Full frontier.

Parallel agents may share the same directory only when their file sets are non-overlapping. Full
autonomy may instead isolate those same independent tasks in separate worktrees, but worktree
isolation does not make dependent or overlapping-file tasks eligible for the same frontier.

**When to parallelize:**
- Tasks touch different files (check `**Files likely touched:**` in the plan)
- Tasks have `Dependencies: none` or depend only on already-completed tasks
- Tasks follow the same pattern (e.g., "add validation to Model X" for 5 models)

**How to parallelize:**
1. Build the ready frontier from dependency and likely-touched-file metadata
2. Select at most 3 mutually independent tasks
3. Dispatch all selected tasks in one host-native fan-out operation
4. Each agent receives: the task description, the test directory, the source directory
5. Wait for every concurrent dispatch to complete before verification
6. Compute `BATCH_AFFECTED_TESTS` from every task's scoped affected-test set and run that union
   once to verify no conflicts; use the full-suite fallback only if the union is indeterminate
7. If tests fail: identify the conflict, fix sequentially, re-run

**Worktree-based parallelism (Full autonomy only):**
For mutually independent tasks that need stronger isolation:
- In Claude Code, dispatch the `worktree-manager` agent with `model="haiku"` to create parallel
  worktrees under `.worktrees/`; other supported hosts use the native equivalent with the same
  isolated-worktree responsibility.
- Each worktree gets its own task batch
- After completion, merge results back sequentially
- The worktree-manager handles merge order, conflict resolution, and post-merge testing
- Never place dependent or overlapping-file tasks in the same ready frontier; defer them even when
  separate worktrees could be created.

**Conservative autonomy:** All tasks run sequentially. No parallel execution.

### Batch Boundaries

At natural batch boundaries (after completing a group of related tasks):

**Pre-batch verification (before starting next batch):**
- Compute `BATCH_AFFECTED_TESTS` as the union of every task's scoped affected-test set and run
  the named union once. If ANY test fails that is NOT an expected RED test, stop and fix before
  proceeding. If the union cannot be determined confidently, run the full suite instead.
  Previous session bugs must not accumulate.
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
- Run a **micro-retro** (see below)
- Append to `.pipeline/progress.log` — a chronological narrative of what was done, what was
  tried, what worked, and what's next (see Progress Log below)
- Report batch status as a single line: `Batch N: X/Y PASS, Z rework`
- In Conservative mode: get explicit approval to continue
- In Standard mode: continue unless the user intervenes
- In Full mode: continue automatically

### Micro-Retros (Per-Phase)

At each batch boundary, perform a lightweight retro: spec compliance, duplication, complexity, gate accuracy, and autonomy friction. Record findings in `.pipeline/audit-trail/batch-N-retro.md`. These feed the full `/retro` with phase-level granularity. If dispatched through the selected host's available subagent facility, the micro-retro dispatch prompt's first line MUST be `Task: none` (session-hook marker contract, see Per-Task Execution).

### Memory Checkpoint (Per-Batch)

**GATE: Every batch must persist at least one `.memory/` entry before proceeding.**

Persist decisions, patterns, gotchas, or context learned during the batch. Update `.memory/index.md` after each write. If dispatched through the selected host's available subagent facility, the memory-checkpoint dispatch prompt's first line MUST be `Task: none` (session-hook marker contract, see Per-Task Execution).

### Progress Log

Append to `.pipeline/progress.log` at every batch boundary — a chronological narrative for cross-session continuity. The `session-start-context.sh` hook reads the last 30 lines at session start.

```
## Batch 1 — 2026-03-28 14:30
- Completed: 1 (User model), 2 (registration endpoint) | Rework: 0 cycles
- Issue: PostgreSQL JSONB casting needed explicit type (wrote .memory/gotchas/)
- Next: 3 (authentication) | State: 2/13 tasks, all tests passing, merge-ready
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
- [ ] Every subagent dispatch's line 1 is exactly `Task: <id>` (bare plan id) so the session
      hooks stamp `.pipeline/current-task` and commits auto-carry the trailer
- [ ] No `completed` status was ever hand-written — completion derives solely from
      commit-anchored evidence (trailers / `Evidence:` forms / engine stamps)
- [ ] Quality gates enforced after each task
- [ ] Rework budget tracked (escalate at 3 cycles)
- [ ] State tracked in `.pipeline/` with audit trail
- [ ] Conflict check re-run if stories changed
- [ ] Batch summaries presented at natural boundaries
- [ ] Pipeline summary available for retro
