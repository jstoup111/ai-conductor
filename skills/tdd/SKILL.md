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

**Agent:** Generator (test-files-only context)
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

**Agent:** Domain Reviewer
**Goal:** Review the test for domain integrity before implementation begins.

Check for:
- **Primitive obsession:** Is the test using raw strings/integers where a domain type should exist?
  - `user_id: "abc123"` → Should this be a `UserId` type?
  - `status: "active"` → Should this be an enum?
- **Invalid state representability:** Could the test's setup create an impossible business state?
- **Boundary violations:** Is the test reaching across domain boundaries it shouldn't?
- **Naming:** Do test names use domain language, not technical jargon?

**Veto authority:** The domain reviewer can reject the test and send it back to RED with
specific feedback on what to change.

See `references/domain-review.md` for domain review criteria.

### Phase 3: GREEN

**Agent:** Generator (source-files-only context)
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

**Agent:** Domain Reviewer
**Goal:** Review the implementation for domain integrity.

Check for:
- **Primitive obsession in production code:** Raw types where domain types should be
- **Leaky abstractions:** Implementation details exposed across boundaries
- **Missing domain types:** Should a new value object or entity be introduced?
- **Naming:** Do method/variable names use domain language?

**Veto authority:** Can reject and send back to GREEN with feedback.

### Phase 5: COMMIT

**Hard gate — all conditions must be met:**

1. Full test suite passes (not just the new test)
2. Linter passes (if tech-context specifies one — e.g., `bundle exec standardrb` for Rails)
3. Working tree is clean (no uncommitted changes outside this task)
4. Commit with descriptive message referencing the behavior added

**After commit:** Return to RED for the next cycle, or stop if all criteria for the current
task are covered.

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

When using the Agent tool for subagent dispatch:

| Phase | Agent | Context Provided | Files Visible |
|-------|-------|-----------------|---------------|
| RED | Generator | Test files, story/plan for this task | `spec/` or `test/` only |
| DOMAIN | Domain Reviewer | Domain types, current test or impl | Domain models + current file |
| GREEN | Generator | Source files, failing test output | `app/` or `src/` only |
| COMMIT | (main agent) | Full context | All files |

This isolation prevents the RED agent from peeking at implementation (biasing the test)
and the GREEN agent from over-engineering beyond what the test requires.

### Spec Coverage Rule: Every File Gets a Spec

**Every file in `app/` (or `src/`) must have a corresponding spec file.** This is a hard gate.

| Source File | Spec File | Spec Type |
|---|---|---|
| `app/models/card.rb` | `spec/models/card_spec.rb` | **Unit** — validations, associations, enums, callbacks, business logic |
| `app/controllers/cards_controller.rb` | `spec/requests/cards_spec.rb` | **Request** — HTTP contract, auth, response format, status codes |
| `app/services/cards/move_service.rb` | `spec/services/cards/move_service_spec.rb` | **Unit** — business logic in isolation |
| `app/jobs/cleanup_job.rb` | `spec/jobs/cleanup_job_spec.rb` | **Unit** — job behavior, retry, idempotency |

**Unit specs** test logic in isolation — validations fire, associations exist, methods return
correct values, state transitions work. Fast, no HTTP stack.

**Request specs** test the HTTP contract — correct status codes, response envelopes match the
API contract (if one exists), auth is enforced, error formats are consistent. These are the
BDD/acceptance layer.

**Both are required.** Request specs alone miss model-level logic. Unit specs alone miss
integration issues (routing, middleware, serialization).

During RED phase: if the task creates or modifies a file in `app/`, verify the corresponding
spec file exists. If not, create it as part of this TDD cycle.

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
