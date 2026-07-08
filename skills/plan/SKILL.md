---
name: plan
description: "Use after stories are written and conflict-check has passed clean. Converts user stories into a step-by-step implementation plan with 2-5 minute task granularity."
enforcement: gating
phase: decide
standalone: false
requires: [".docs/stories/ with both paths", ".docs/conflicts/ clean pass or no blocking conflicts", verify-claims]
---

## Purpose

The **technical implementation plan** (`HOW`) that `build` ships from — the bridge between the
behavioral stories (`WHAT`) and shipped code. Stories say *what* the system should do; the plan
decides *how*: the technical approach, which files change, the 2–5 min TDD tasks, and their
dependencies/sequencing. Any agent can execute it with zero additional context.

This is **not** a re-listing of the stories. It adds the engineering layer they don't carry:
architecture/approach, file-level changes, task ordering, and dependencies. Traceability runs
PRD `FR-N` → story → task. Every acceptance criterion maps to at least one task; negative-path
stories become explicit test tasks — not afterthoughts.

**Correctness gate:** a plan encodes technical assumptions (which files change, how a subsystem
behaves, what an API accepts). Apply the `/verify-claims` protocol before finalizing tasks —
prefer one cheap `Read`/`grep` over a guess, attach a grounded confidence % to claims you cannot
cheaply verify, and HARD-BLOCK (operator approval interactive, HALT if autonomous) on any
unconfirmed assumption that changes the technical approach or task breakdown.

Open with a short **Technical Approach** (a paragraph or few bullets: the design decisions,
key modules/files, and sequencing) before the task list, so `build` has the shape of the work
before the steps.

## Practices

### 1. Validate Preconditions

**GATE: Refuse to produce a plan without these artifacts:**

- [ ] Stories exist in `.docs/stories/` for the feature being planned
- [ ] Every story has both happy and negative paths
- [ ] Conflict-check has passed (check `.docs/conflicts/` for recent clean pass, or no blocking conflicts)

If preconditions are not met, state which are missing and suggest the appropriate skill.

### 2. Read All Stories

**Skip redundant exploration:** If exploration was already performed in this session (e.g.,
during explore), use the existing exploration results. Do not re-explore the same scope —
pass the summary to the Plan agent instead of dispatching new Explore agents.

Load every story for the feature from `.docs/stories/`. For each story, extract:
- All happy path acceptance criteria
- All negative path acceptance criteria
- Any dependencies between stories (shared entities, sequencing)

### 3. Generate Implementation Tasks

Break stories into tasks at **2-5 minute granularity**. Each task follows the TDD cycle:

```markdown
### Task [N]: [Descriptive title]
**Story:** [Reference to story and specific acceptance criterion]
**Type:** happy-path | negative-path | infrastructure | refactor

**Steps:**
1. Write failing test: [Specific test description with expected assertion]
2. Verify test fails (RED)
3. Implement: [Specific implementation description]
4. Verify test passes (GREEN)
5. Commit with message: "[descriptive message]"

**Files likely touched:**
- [file path] — [what changes]

Write file paths **repo-relative** (e.g. `src/conductor/src/engine/foo.ts`, not
`foo.ts`): the build evidence gate corroborates each task's commits against these
paths. Basename/suffix forms are tolerated (matched at `/` boundaries, #425), but
repo-relative paths corroborate precisely and never collide.

**Dependencies:** [Task N that must complete first, or "none"]
```

The `**Files:**` line is authoritative for the build evidence gate: each task's
commits are corroborated against exactly these paths (#424). Paths may be
plain text or backticked, `;`/`,` separated, on the line or as bullets under
it. `same` inherits the previous task's set, `same as Task N` inherits task
N's, and `none` means the task's commit trailer alone corroborates. Backticked
file names elsewhere in the task (Steps prose) are only used when no Files
line exists.

### 4. Task Ordering Rules

1. **Infrastructure first** — Database migrations, model definitions, route setup
2. **Happy paths before negative paths** — Build the working flow, then test failure modes
3. **Negative paths are explicit tasks** — Each negative path scenario gets its own task, not a "clean up error handling" catch-all
4. **Integration points identified** — Mark tasks where components connect for the first time
5. **Dependencies declared** — If Task 5 requires Task 3's model, say so

### 5. Plan Format

```markdown
# Implementation Plan: [Feature Name]

**Date:** YYYY-MM-DD
**Design:** [link to .docs/specs/ file]
**Stories:** [link to .docs/stories/ file]
**Conflict check:** Clean as of YYYY-MM-DD

## Summary
[1-2 sentences: what this plan builds and how many tasks]

## Technical Approach
[The HOW, before the steps: key design decisions, the modules/files involved, data shapes,
and the sequencing rationale. A paragraph or a few bullets — enough that `build` understands
the shape of the work before reading individual tasks.]

## Prerequisites
- [Any setup, migrations, or dependencies that must exist before task 1]

## Tasks

### Task 1: [Title]
...

### Task 2: [Title]
...

## Task Dependency Graph
[Simple text diagram showing which tasks block which]

## Integration Points
- After Task [N]: [What can be tested end-to-end at this point]

## Verification
- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies are explicit and acyclic
```

### 5b. Task Header Format and ID Grammar

**Task ID Grammar:** Task ids can be:
- **Numeric:** `1`, `18`, `100` (legacy, still supported)
- **Dotted:** `1.2`, `2.1.3` (for subtask notation)
- **Alphanumeric with separators:** `task_1`, `rem-adr-001`, `task-name-02`
- **Characters allowed:** `[A-Za-z0-9._-]` (letters, digits, dots, underscores, hyphens)

Examples:
```markdown
### Task 1: Basic feature
### Task 1.2: Subtask of task 1
### Task rem-adr-001: Remediation for ADR-001
### Task task_setup_1: Project setup
```

**Trailer matching:** Commit trailers use the same id grammar for consistency:
```
Task: 1.2
Task: rem-adr-001
```

The parser and trailer matcher use identical grammar to ensure deterministic round-trip:
parse plan → extract ids → emit trailers → re-parse → identical ids.

### 6. Scope Sanity Check

After generating tasks, check the total count:

| Task Count | Action |
|---|---|
| 1-20 | Normal — proceed |
| 21-40 | Warning — surface to user: "This plan has N tasks (~X hours). Consider splitting into multiple features." |
| 41+ | Hard stop — this is likely multiple features bundled together. Break into separately plannable features and run `/stories` + `/plan` for each. |

If the user explicitly confirms a large plan, proceed — but record the decision in `.memory/decisions/`.

### 7. Coverage Check

**GATE: Every story acceptance criterion (happy AND negative) must map to at least one task.**

After generating the plan, cross-reference:
- For each acceptance criterion in `.docs/stories/`, find the task(s) that cover it
- If any criterion is uncovered, add a task
- Present the coverage mapping to the user

### 8. Save and Suggest

Save the plan to `.docs/plans/YYYY-MM-DD-<feature>.md`

### 8b. Update Architecture Diagrams

After saving the plan, run `/architecture-diagram` in plan-update mode to update existing
diagrams in place with the planned changes. Diagrams are mutated directly — no separate
proposed-state files are created.

### 8c. Suggest Next Step

`/architecture-review` — the plan must pass architecture review before
any code is written. The full flow from here is:

```
/plan (you are here)
  → /architecture-diagram (generate/update current-state diagrams)
  → /architecture-review (feasibility, alignment, risks — consumes diagrams, may BLOCK)
  → /writing-system-tests (failing acceptance specs from stories)
  → /pipeline or /tdd (implement until all tests pass)
```

## Verification

- [ ] Preconditions validated (stories exist, both paths, conflict-check clean)
- [ ] Every acceptance criterion maps to at least one task
- [ ] Negative paths are explicit tasks (not grouped into catch-alls)
- [ ] Tasks are 2-5 minute granularity
- [ ] Each task has specific test and implementation descriptions
- [ ] Dependencies are declared and acyclic
- [ ] Plan saved to `.docs/plans/`
- [ ] Coverage mapping presented to user
