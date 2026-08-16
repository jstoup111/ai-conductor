---
name: tdd
description: "Use when implementing any feature or bugfix. Five-step cycle: RED → DOMAIN → GREEN → DOMAIN → COMMIT. Enforces test-first development with domain integrity review at every phase boundary."
enforcement: structural
phase: build
standalone: true
requires: []
---

## Purpose

Enforces test-driven development with domain integrity as a first-class concern. Every change
goes through a five-step cycle with implementer isolation — the RED agent only sees tests, the
GREEN agent only sees source, and the DOMAIN reviewer has veto authority over both.

**Host mechanics:** Delegate RED, GREEN, and DOMAIN work through the selected host's available
subagent facility. Claude Code uses its Agent tool and Claude model labels; other supported hosts
use their native equivalents. The host mechanism may differ, but it MUST preserve this cycle's
RED → DOMAIN → GREEN → DOMAIN → COMMIT order, scoped verification, review vetoes, and commit gates.

### Documentation boundary

Do not start a RED/GREEN cycle for ordinary human-facing documentation, and do not add tests that
assert documentation wording, headings, formatting, placement, links, or repository explanations.
Documentation-only requests are delivered from `/explore`. Keep tests for machine-consumed documents
only when they assert generated or runtime behavior (for example OpenAPI contracts or generated
repository-harness functionality), never prose shape.

## Practices

### The Cycle

```
RED → DOMAIN → GREEN → DOMAIN → COMMIT
 │       │        │        │        │
 │       │        │        │        └─ Scoped affected-test union green, clean tree, commit
 │       │        │        └─ Review implementation for domain integrity
 │       │        └─ Implement minimally (scope check: ~20 lines, 1 file, 1 function)
 │       └─ Review test for primitive obsession, invalid states
 └─ Write ONE failing test, watch it fail
```

### Declared Replication Does Not Change the Cycle

A declared replication's copy task establishes a baseline; it never shortens or changes the
cycle for a later delta task. A task that introduces behavior the source lacks runs the full RED → DOMAIN → GREEN → DOMAIN → COMMIT cycle, with the same scoped verification and review gates,
whether the plan declares replication or not.

`Evidence: satisfied-by <copy-sha>` may close a later task only when the copied commit satisfies
that task's **whole** scope: every acceptance criterion and its required scoped verification. A
copy commit cannot close a task merely because it supplies some of the behavior, and cannot close
a task that introduces behavior absent from the source. Do not split a partly covered task into a
copy-satisfied portion and a delta portion. If whole-task satisfaction is ambiguous, resolve the
ambiguity toward the full cycle.

For a delta task, a first test that passes immediately does not permit implementation. Investigate
whether the test only restates copied behavior or is otherwise wrong;
then write a failing test for the task's uncovered behavior. Only a separate proof that the copy
satisfies the whole task may use the existing `Evidence: satisfied-by` closure.

### No Legitimate RED for Already-Existing Behavior

This boundary applies only when there is no behavior left to add, change, or fix. It never applies
to a task that adds, changes, or fixes behavior; those tasks run the full RED → DOMAIN → GREEN →
DOMAIN → COMMIT cycle.

For a plan-declared verify-only/verification task, author at most the documenting test explicitly
asked for by the plan. Do not invent unrelated assertions to manufacture a RED result.

If investigation discovers that the behavior already exists but the sealed plan did not declare the
task verify-only/verification, do not author a test that cannot fail. Delete any redundant test
authored during this lap, do not amend the sealed plan, and close the task with the existing
`Evidence: skipped <reason>` empty-commit form in **Commit-less Completions: Evidence Trailers**.

### Phase 1: RED

**Agent:** Generator (test-files-only context).
**Goal:** Write exactly one failing test that captures the next behavior.

**Advisory model selection:** Before dispatching RED or GREEN, read
`.ai-conductor/config.yml`. If `steps.build.tdd.red.model` or
`steps.build.tdd.green.model` is configured, dispatch that phase's generator with the
configured `model`. The config validator guarantees the model belongs to the selected
`llm_provider`'s native family. If a phase is not configured, retain the build session's
normal model. This is an orchestration instruction, not a separate conductor step.

1. Choose the next acceptance criterion from the plan (or the most obvious next behavior)
2. Write one test with one assertion
3. The agent derives selectors, retains the test under change as an expected failing member,
   and runs the scoped union of affected tests through `conduct-ts scoped-run <selectors...>`
4. Confirm that the test under change fails for the expected reason and every
   other affected test passes
5. Paste the expected failure output

Any unrelated scoped test failure blocks the current RED phase; fix that
failure before proceeding to DOMAIN. If one of the repository's documented
intermediate fallback triggers makes the affected set genuinely unsafe, name
the exact trigger and reason and invoke the configured aggregate verifier.
Never call a raw project aggregate command directly.

**Rules:**
- One test, one behavior, one assertion
- Test must fail for the RIGHT reason (not syntax error, not missing import)
- Test name describes the behavior: `test_expired_token_returns_401`, not `test_auth`
- If tech-context loaded: follow stack test conventions (e.g., RSpec `describe`/`context`/`it`)

**If the test passes immediately:** The behavior already exists. Either the test is wrong
(testing something already implemented) or the criterion is already met. Investigate — don't
move to GREEN.

See `references/red.md` for detailed RED phase guidance.

### Phase 2: DOMAIN (Post-RED)

**Agent:** Domain Reviewer (see `agents/domain-reviewer.md` for full criteria)
**Goal:** Review the test for domain integrity — primitive obsession, invalid states, boundary
violations, domain language, and **adversarial-derivation coverage** (a failing spec per
production call site of any security/correctness derivation, with real adversarial input — see
`/writing-system-tests` §3d). Has veto authority to send back to RED.

> When the task touches a security/correctness derivation (redaction, auth/permission predicate,
> path/identity check, state guard), the dispatcher MUST include the derivation's production
> call-site list (`file:line`) in this reviewer's prompt — the reviewer is told not to scan, so
> without the list it cannot check call-site coverage.

### Phase 3: GREEN

**Agent:** Generator (source-files-only context) — use
`steps.build.tdd.green.model` when configured (see RED's advisory model selection rule).
**Goal:** Write the simplest code that makes the failing test pass.

1. **Scope check BEFORE writing code:**
   - Will this change touch ~20 lines or fewer? → Proceed
   - Will it touch more than 1 file? → Consider drill-down
   - Will it touch more than 1 function? → Consider drill-down
   - If scope check fails → Write a unit test for the smaller piece and run a nested TDD cycle

2. Write the minimum code to pass the test
3. Run the test — **watch it pass**
4. The agent derives the selectors for the affected/scoped test set (the task's own tests + the files this change touches) and runs `conduct-ts scoped-run <selectors...>`. The dedicated pre-SHIP gate and CI own broad verification, not each TDD cycle.

A known failure in that scoped set blocks the current GREEN phase; fix it here
rather than deferring it to a later gate. If one of the repository's documented
intermediate fallback triggers makes the affected set genuinely unsafe, name
the exact trigger and invoke the configured aggregate verifier. Never call a
raw project aggregate command directly.

**Rules:**
- Simplest code that passes. Not the "best" code — that's for refactoring.
- Don't implement behavior not required by a failing test.
- Don't fix other things you notice. Note them for a future task.
- If tech-context loaded: follow stack conventions (e.g., Rails model/controller patterns)

**When GREEN won't go green — escalate to debugging, do not thrash.**
If the target test still fails after a bounded attempt (≈2 edits), or step 4 shows the change
broke other tests and the cause is not immediately obvious, STOP editing. A generator guessing
at a non-obvious failure burns tokens and risks masking the bug rather than fixing it. Dispatch
the `/debugging` protocol in a fresh sub-session. In Claude Code, use **`model="opus"** for this
reasoning-heavy root-cause analysis (see the repository's model table); other supported hosts use
their native high-reasoning equivalent. Hand it the failing test, the current
diff, and the full failure output. Return to GREEN only once debugging has produced an
evidence-backed root cause.

See `references/green.md` for detailed GREEN phase guidance.
See `references/drill-down.md` for nested TDD cycle instructions.

### Phase 4: DOMAIN (Post-GREEN)

**Mechanical pre-check (before dispatching the reviewer):** If tech-context defines a type-check
command for a statically-typed stack (e.g. `tsc --noEmit` / `npm run typecheck` for TypeScript),
run it now. A type error returns straight to GREEN — do NOT dispatch the domain reviewer (or
advance to COMMIT) against code that does not type-check. This catches stale imports, renamed
properties, and signature drift introduced by the GREEN agent at the cheapest point — the cycle
boundary — instead of at batch, PR, or CI time. Skip silently for stacks with no compile step
(e.g. Rails — the linter at COMMIT covers static checks there).

**Agent:** Domain Reviewer (see `agents/domain-reviewer.md` for full criteria)
**Goal:** Review the implementation for domain integrity — primitive obsession, leaky
abstractions, missing domain types, naming, and **derivation-reached-at-every-call-site** (every
call site actually routes through the security/correctness derivation, handling real boundary
inputs without failing open or closed). Has veto authority to send back to GREEN.

### Phase 5: COMMIT

**Hard gate — all conditions must be met:**

1. Scoped affected-test set passes (the engine's dedicated aggregate gate and CI own broad verification, not each task)
2. Linter passes (if tech-context specifies one — e.g., `bundle exec standardrb` for Rails)
3. Type-check passes (if tech-context specifies a type-checker — e.g., `tsc --noEmit` /
   `npm run typecheck` for TypeScript). Already run as the Phase 4 pre-check; re-confirm clean here.
4. Working tree is clean (no uncommitted changes outside this task)
5. **Commit immediately** — do not defer commits to end of cycle or batch. Connection
   interruptions lose uncommitted work. Commit as soon as GREEN passes and linter is clean.
6. Commit with descriptive message referencing the behavior added
7. **Commit includes Task trailer** — All commits (feature, refactor, fixups) in this TDD
   cycle must include `Task: <id>` as a trailer in the commit body. This anchors commits
   to their implementation task and enables task-status tracking.

   **Grammar Rule:** The trailer ID MUST match the plan header ID exactly. For example:
   - Plan header: `### Task 7:` → Trailer must be: `Task: 7` (NOT `Task: task-7`)
   - Forbidden: `Task: task-7`, `Task: task-N`, `task-7` (incorrect spellings)
   - Required: `Task: 7`, `Task: 42` (bare numeric ID only)

   **Subject ⇒ Trailer Discipline:** If the commit subject line references a task ID
   (e.g., `fix: resolve Task 7 token rejection`), the commit MUST include the matching
   `Task: <id>` trailer. A commit whose subject names a task but lacks the corresponding
   trailer FAILS this gate — amend the commit before proceeding. This ensures
   bidirectional traceability: commits identify their task, and tasks can find their commits.

   Example (good):
   ```
   feat(auth): reject expired tokens at request boundary

   Validates token expiry before processing request body. Stores expiry
   time in secure cookie (not in header). Rejects with 401 if expired.

   Task: 42
   ```

   Refactor commits within the same task also carry the same Task: <id> so the task
   is atomically marked complete when the final commit lands.

8. **Commit only to the current feature branch — never integrate upstream.** Do NOT run
   `git fetch`, `git pull`, `git rebase`, or switch branches during the cycle. Mid-build
   rebase onto a moved `origin/<default>` rewrites history under active work. The only
   sanctioned rebases are the daemon's finish-time rebase-onto-latest and the `/rebase`
   resolver — both outside this loop. See the repository's rebase policy.

**After commit:** Return to RED for the next cycle, or stop if all criteria for the current
task are covered.

### Commit-less Completions: Evidence Trailers

Not all tasks require code commits. Some tasks verify that existing behavior meets acceptance
criteria, and some have no implementation work (architectural decisions, etc.). Ordinary
documentation maintenance is not a TDD task; `/explore` delivers it directly.
When a task completes without code changes, emit an empty commit with Evidence trailers.

A plan task may carry a `**Verify-only:** yes` marker (see `skills/plan/SKILL.md` §5d)
declaring up front that it is expected to prove existing behavior already satisfies its
acceptance criteria. Such tasks preferably complete via one of the two empty-commit
Evidence forms below — `Evidence: satisfied-by <sha>` when a prior commit already
satisfies the criteria, or `Evidence: skipped <reason>` when there is no applicable
satisfying commit — rather than a code commit.

The engine reads commits only — it does not inspect task reports or summary lines. Evidence
forms MUST be emitted as `git commit --allow-empty` with the Evidence trailer in the commit
body. This ensures the conductor can track task completion by reading the commit log, achieving
bidirectional traceability: tasks identify their commits via trailers, and commits carry proof
of completion.

**Form 1: `Evidence: satisfied-by <sha>`**
Use when a task's acceptance criteria are already met by existing code (discovered during
pre-completion scan). Emit a no-op commit carrying the satisfying commit SHA:
```
git commit --allow-empty -m "chore(evidence): task criteria met" \
  -m "Task: 7" \
  -m "Evidence: satisfied-by abc123def456"
```

**Form 2: `Evidence: skipped <reason>`**
Use when a task has no implementation work or is intentionally deferred. Emit a no-op commit
with a concise reason:
```
git commit --allow-empty -m "chore(evidence): task deferred" \
  -m "Task: 12" \
  -m "Evidence: skipped awaiting_stakeholder_input"
```

Each empty commit carries `Task: <id>` (the task ID) plus `Evidence: satisfied-by <sha>` OR
`Evidence: skipped <reason>` (the evidence form). The conductor recognizes these commits and
marks the task `completed` without requiring ordinary code changes. This enables honest tracking:
a task that "completes" via verification is marked differently from one that completes via code
delivery, supporting retro analysis and pipeline audits.

### Memory Checkpoint (Per-Cycle, Conditional)

After COMMIT, if this TDD cycle revealed any of the following, persist immediately:
- **Category: `gotchas/`** — An unexpected framework/library behavior that caused the test to fail for the wrong reason
- **Category: `patterns/`** — A new pattern established in this cycle that future cycles should follow

Most cycles will NOT trigger a memory write — that is correct. Only persist genuinely surprising discoveries.

### Refactoring Principle: Dry Business Logic, Not Dry Code

**Refactoring does NOT happen during GREEN.** GREEN writes the simplest passing code — nothing
more. Refactoring happens at **batch boundaries** (after completing a group of related tasks),
as a distinct step between batches.

At batch boundaries, run the `simplify` workflow (Claude `/simplify`; Codex `$simplify`) and check for:

1. **Duplicated business logic** — same authorization check, same event recording pattern,
   same calculation appearing in 2+ places. Extract on the **second** occurrence, don't wait
   for a third.
2. **Complex methods** — any method >15 lines or >3 conditional branches should be extracted
   to a service object.
3. **Do NOT over-abstract** — similar-looking code that serves different purposes is fine.
   Three controllers with similar `before_action` patterns are not duplication if they
   authorize differently. Only extract shared *behavior*, not shared *shape*.

Refactoring gets its own commit(s) — separate from feature commits. Tests must still pass after.

### User-Requested Exit During TDD

If the user explicitly requests to stop, pause, or exit to the harness at any point during
a TDD cycle (RED, GREEN, DOMAIN, or COMMIT), the orchestrator MUST:

1. **Do NOT commit incomplete work.** If the cycle is mid-flight (test written but no code,
   or code written but domain review not passed), do not attempt to force a commit.

2. **Reset the task to `pending`** in `.pipeline/task-status.json` if you marked it `in_progress`.
   The next session will re-enter this task and resume the cycle.

3. **Write a halt marker** (`.pipeline/halt-user-input-required`) with a one-line summary
   of the in-flight cycle state (e.g., "user requested exit; RED phase complete, awaiting GREEN").

This contract ensures that user interruption is non-destructive: the task cleanly resets,
and the next session resumes from the known state without losing work or creating orphaned
commits.

### Structural Enforcement

When dispatching through the selected host's available subagent facility, **inline the relevant
context directly in the prompt** rather than giving broad file access. This keeps each dispatch
focused and token-efficient. In Claude Code, this applies to Agent tool dispatches.

| Phase | Agent | Provide in Prompt | Do NOT Provide |
|-------|-------|-------------------|----------------|
| RED | Generator | Task description, acceptance criterion text, test dir path, factory file path | Implementation files, other stories, full plan |
| DOMAIN (post-RED) | Domain Reviewer | New/changed test code (inline), list of existing domain types, **call-site list (`file:line`) for any security/correctness derivation in scope** | Full file tree, `.memory/` files, other test files |
| GREEN | Generator | Failing test output (inline), source dir path, 1-2 specific source files to modify | Test files, stories, plan |
| DOMAIN (post-GREEN) | Domain Reviewer | New/changed implementation code (inline), the test it satisfies (inline), **call-site list (`file:line`) for any security/correctness derivation in scope** | Full file tree, `.memory/` files, other source files |
| COMMIT | (main agent) | Full context | All files |

**Context budget rules:**
- **Provide file paths and metadata, not full contents.** Give subagents file paths, line
  counts, and key method names/signatures. Subagents read files themselves — copying full
  file contents into prompts wastes tokens (40-50K per feature observed in retros).
- **For domain review: inline the diff only.** Paste the specific new/changed code (the diff)
  into the domain reviewer prompt — this is typically small (<50 lines). Do NOT inline entire files.
- **Name domain types that exist** (e.g., "Domain types: Contact, Tag, ContactTag") so the
  domain reviewer doesn't scan the codebase.
- **One criterion per RED dispatch** — the generator prompt contains exactly the acceptance
  criterion being implemented, not the full story.
- **Cap GREEN file access** — name the 1-2 files to modify, not the full source tree.
- **Pre-gather decisions** — the TDD orchestrator checks `.memory/decisions/` for relevant
  prior decisions and includes them in the domain reviewer prompt. The reviewer does not
  search `.memory/` itself.
- **Reuse host-native implementer sessions for sequential tasks on same files.** When consecutive
tasks modify the same files, continue the existing host-native session instead of spawning a new
one — this preserves the file cache and avoids redundant reads.

This isolation prevents the RED agent from peeking at implementation (biasing the test)
and the GREEN agent from over-engineering beyond what the test requires.

### Domain Reviewer Model Selection

Right-size the model to the diff size to reduce API cost and rate limit pressure:

- **In Claude Code, diffs under 50 lines:** dispatch with `model="sonnet"` — sufficient for focused domain checks
- **In Claude Code, diffs of 50+ lines:** dispatch with `model="opus"` — deep analysis for larger changes
- **Other supported hosts:** select the native equivalent of the same focused versus deep-review
  capability; do not weaken the review boundary or veto authority.

Most TDD diffs are small (under 20 lines), so the majority of domain reviews will use Sonnet.

### Orchestrator Output Discipline

Between TDD phases, the orchestrator outputs ONLY:
- The dispatch (silently — no announcement)
- The subagent's structured response
- A one-line status: `RED: FAIL (expected)` / `GREEN: PASS` / `DOMAIN: APPROVED` / `DOMAIN: VETO — [reason]`

No narration, no explanation of what just happened, no preview of what comes next.

### Spec Coverage Rule: Every File Gets a Spec

**Every file in `app/` (or `src/`) must have a corresponding spec file.** Hard gate.

- Models/services/jobs → unit specs (`spec/models/`, `spec/services/`, `spec/jobs/`)
- Controllers → request specs (`spec/requests/`)
- Both layers required. During RED: if the task creates/modifies a file in `app/`, verify the
  corresponding spec exists. If not, create it as part of this TDD cycle.

## Verification

- [ ] Test written BEFORE implementation (no exceptions)
- [ ] Test failed for the right reason (not syntax/import error)
- [ ] Domain review ran after RED (test reviewed for domain integrity)
- [ ] Implementation is minimal (passes scope check)
- [ ] Domain review ran after GREEN (implementation reviewed)
- [ ] Scoped affected-test set passes before commit (the engine's dedicated aggregate gate owns
      broad pre-SHIP verification, not each task)
- [ ] Commit carries the `Task: <id>` trailer (bare plan id — auto-stamped from
      `.pipeline/current-task` when dispatched correctly; verify it parsed, never paragraph-split)
- [ ] Linter passes before commit
- [ ] Type-check passes before commit (typed stacks — run as the Phase 4 pre-check; skipped for stacks with no compile step)
- [ ] Working tree clean at commit
- [ ] One behavior per cycle (not multiple changes lumped together)
- [ ] Every `app/` file has a corresponding spec file (unit + request where applicable)
- [ ] Non-obvious gotchas or new patterns persisted to `.memory/` (if encountered this cycle)
