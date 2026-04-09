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
goes through a five-step cycle with subagent isolation — the RED agent only sees tests, the
GREEN agent only sees source, and the DOMAIN reviewer has veto authority over both.

## Practices

### The Cycle

```
RED → DOMAIN → GREEN → DOMAIN → COMMIT
 │       │        │        │        │
 │       │        │        │        └─ Full suite green, clean tree, commit
 │       │        │        └─ Review implementation for domain integrity
 │       │        └─ Implement minimally (scope check: ~20 lines, 1 file, 1 function)
 │       └─ Review test for primitive obsession, invalid states
 └─ Write ONE failing test, watch it fail
```

### Phase 1: RED

**Agent:** Generator (test-files-only context) — dispatch with `model="sonnet"`
**Goal:** Write exactly one failing test that captures the next behavior.

1. Choose the next acceptance criterion from the plan (or the most obvious next behavior)
2. Write one test with one assertion
3. Run the test — **watch it fail**
4. Paste the failure output

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
violations, domain language. Has veto authority to send back to RED.

### Phase 3: GREEN

**Agent:** Generator (source-files-only context) — dispatch with `model="sonnet"`
**Goal:** Write the simplest code that makes the failing test pass.

1. **Scope check BEFORE writing code:**
   - Will this change touch ~20 lines or fewer? → Proceed
   - Will it touch more than 1 file? → Consider drill-down
   - Will it touch more than 1 function? → Consider drill-down
   - If scope check fails → Write a unit test for the smaller piece and run a nested TDD cycle

2. Write the minimum code to pass the test
3. Run the test — **watch it pass**
4. Run the full test suite — ensure nothing else broke

**Rules:**
- Simplest code that passes. Not the "best" code — that's for refactoring.
- Don't implement behavior not required by a failing test.
- Don't fix other things you notice. Note them for a future task.
- If tech-context loaded: follow stack conventions (e.g., Rails model/controller patterns)

See `references/green.md` for detailed GREEN phase guidance.
See `references/drill-down.md` for nested TDD cycle instructions.

### Phase 4: DOMAIN (Post-GREEN)

**Agent:** Domain Reviewer (see `agents/domain-reviewer.md` for full criteria)
**Goal:** Review the implementation for domain integrity — primitive obsession, leaky
abstractions, missing domain types, naming. Has veto authority to send back to GREEN.

### Phase 5: COMMIT

**Hard gate — all conditions must be met:**

1. Full test suite passes (not just the new test)
2. Linter passes (if tech-context specifies one — e.g., `bundle exec standardrb` for Rails)
3. Working tree is clean (no uncommitted changes outside this task)
4. Commit with descriptive message referencing the behavior added

**After commit:** Return to RED for the next cycle, or stop if all criteria for the current
task are covered.

### Memory Checkpoint (Per-Cycle, Conditional)

After COMMIT, if this TDD cycle revealed any of the following, persist immediately:
- **Category: `gotchas/`** — An unexpected framework/library behavior that caused the test to fail for the wrong reason
- **Category: `patterns/`** — A new pattern established in this cycle that future cycles should follow

Most cycles will NOT trigger a memory write — that is correct. Only persist genuinely surprising discoveries.

### Refactoring Principle: Dry Business Logic, Not Dry Code

**Refactoring does NOT happen during GREEN.** GREEN writes the simplest passing code — nothing
more. Refactoring happens at **batch boundaries** (after completing a group of related tasks),
as a distinct step between batches.

At batch boundaries, run `/simplify` and check for:

1. **Duplicated business logic** — same authorization check, same event recording pattern,
   same calculation appearing in 2+ places. Extract on the **second** occurrence, don't wait
   for a third.
2. **Complex methods** — any method >15 lines or >3 conditional branches should be extracted
   to a service object.
3. **Do NOT over-abstract** — similar-looking code that serves different purposes is fine.
   Three controllers with similar `before_action` patterns are not duplication if they
   authorize differently. Only extract shared *behavior*, not shared *shape*.

Refactoring gets its own commit(s) — separate from feature commits. Tests must still pass after.

### Structural Enforcement

When using the Agent tool for subagent dispatch, **inline the relevant context directly in the
prompt** rather than giving broad file access. This keeps each dispatch focused and token-efficient.

| Phase | Agent | Provide in Prompt | Do NOT Provide |
|-------|-------|-------------------|----------------|
| RED | Generator | Task description, acceptance criterion text, test dir path, factory file path | Implementation files, other stories, full plan |
| DOMAIN (post-RED) | Domain Reviewer | New/changed test code (inline), list of existing domain types | Full file tree, `.memory/` files, other test files |
| GREEN | Generator | Failing test output (inline), source dir path, 1-2 specific source files to modify | Test files, stories, plan |
| DOMAIN (post-GREEN) | Domain Reviewer | New/changed implementation code (inline), the test it satisfies (inline) | Full file tree, `.memory/` files, other source files |
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
- **Reuse subagents for sequential tasks on same files.** When consecutive tasks modify the
  same files, use SendMessage to continue the existing subagent instead of spawning a new
  one — this preserves the file cache and avoids redundant reads.

This isolation prevents the RED agent from peeking at implementation (biasing the test)
and the GREEN agent from over-engineering beyond what the test requires.

### Domain Reviewer Model Selection

Right-size the model to the diff size to reduce API cost and rate limit pressure:

- **Diffs under 50 lines:** dispatch with `model="sonnet"` — sufficient for focused domain checks
- **Diffs of 50+ lines:** dispatch with `model="opus"` — deep analysis for larger changes

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
- [ ] Full test suite passes before commit
- [ ] Linter passes before commit
- [ ] Working tree clean at commit
- [ ] One behavior per cycle (not multiple changes lumped together)
- [ ] Every `app/` file has a corresponding spec file (unit + request where applicable)
- [ ] Non-obvious gotchas or new patterns persisted to `.memory/` (if encountered this cycle)
