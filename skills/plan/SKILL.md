---
name: plan
description: "Use after stories are written and conflict-check has passed clean. Converts user stories into a step-by-step implementation plan with 2-5 minute task granularity."
enforcement: gating
phase: decide
standalone: false
requires: ["docs/stories/ with both paths", "docs/conflicts/ clean pass or no blocking conflicts"]
---

## Purpose

Converts approved, conflict-free user stories into a detailed implementation plan that any
agent can execute with zero additional context. Every acceptance criterion maps to at least
one task. Negative path stories become explicit test tasks — not afterthoughts.

## Practices

### 1. Validate Preconditions

**GATE: Refuse to produce a plan without these artifacts:**

- [ ] Stories exist in `docs/stories/` for the feature being planned
- [ ] Every story has both happy and negative paths
- [ ] Conflict-check has passed (check `docs/conflicts/` for recent clean pass, or no blocking conflicts)

If preconditions are not met, state which are missing and suggest the appropriate skill.

### 2. Read All Stories

Load every story for the feature from `docs/stories/`. For each story, extract:
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

**Dependencies:** [Task N that must complete first, or "none"]
```

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
**Design:** [link to docs/specs/ file]
**Stories:** [link to docs/stories/ file]
**Conflict check:** Clean as of YYYY-MM-DD

## Summary
[1-2 sentences: what this plan builds and how many tasks]

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
- For each acceptance criterion in `docs/stories/`, find the task(s) that cover it
- If any criterion is uncovered, add a task
- Present the coverage mapping to the user

### 8. Save and Suggest

Save the plan to `docs/plans/YYYY-MM-DD-<feature>.md`

Suggest next steps:
- For small features: invoke `tdd` skill and work through tasks manually
- For larger features: invoke `pipeline` skill for automated execution with quality gates

## Verification

- [ ] Preconditions validated (stories exist, both paths, conflict-check clean)
- [ ] Every acceptance criterion maps to at least one task
- [ ] Negative paths are explicit tasks (not grouped into catch-alls)
- [ ] Tasks are 2-5 minute granularity
- [ ] Each task has specific test and implementation descriptions
- [ ] Dependencies are declared and acyclic
- [ ] Plan saved to `docs/plans/`
- [ ] Coverage mapping presented to user
