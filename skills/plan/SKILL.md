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
- [ ] Every task carries a `**Dependencies:**` line (use `none` when independent) or the plan
      includes a `## Task Dependency Graph` section — daemon discovery refuses merged specs
      whose plans lack a dependency tree
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

**Wired-into:** [where the new production surface is called from, or an inheritance/waiver form — see below]

**Verify-only:** [yes, or omit — see 5d below]

**Dependencies:** [Task N that must complete first, or "none"]
```

The `**Files:**` line is authoritative for the build evidence gate: each task's
commits are corroborated against exactly these paths (#424). Paths may be
plain text or backticked, `;`/`,` separated, on the line or as bullets under
it. `same` inherits the previous task's set, `same as Task N` inherits task
N's, and `none` means the task's commit trailer alone corroborates. Backticked
file names elsewhere in the task (Steps prose) are only used when no Files
line exists.

### 5c. `Wired-into:` Grammar and Derivation

Every task that introduces a new production surface (exported function/module, hook
script, config key, emitted event, scheduled job, CLI subcommand, etc.) carries a
`**Wired-into:**` line. This is the plan-level contract that the §12 As-Built
Compliance Gate later checks against real `file:line` callers after implementation.

**The four forms:**

1. **Declared call site(s):** `path#symbol` — repo-relative path plus the calling
   symbol, comma-separated for multiple call sites:
   `src/conductor/src/engine/loop.ts#dispatchStep, src/conductor/bin/conduct-ts#commandTable`
2. **Inheritance:** `same as Task N` — this task's surface is wired in by the same
   call site(s) declared for Task N (e.g. a follow-up task adding a branch to
   already-wired dispatch logic).
3. **No new surface:** `none (no new production surface)` — the task only touches
   tests, docs, or refactors existing wired code without adding a new call target.
4. **Deferred/waived:** `none (inert until <ref>)` — the surface is intentionally
   not yet reachable, where `<ref>` is either a repo-relative path (path-form,
   e.g. `none (inert until src/conductor/src/engine/loop.ts)`) or a tracked issue
   (issue-form, e.g. `none (inert until #431)`) naming where/when it will be wired.

**Repo-relative paths only:** as with `**Files:**`, every path used in a
`Wired-into:` line must be repo-relative and must not escape the repo via `../`.
Paths that climb outside the repo root are malformed and must be rejected.

**Derivation for Medium/Large tier:** for Medium/Large tier features,
architecture-review's `## Wiring Surface` section (see `skills/architecture-review/SKILL.md`)
is authored first, at design time, naming where each new production surface will be
called from. `/plan` reads that section and DERIVES each task's `Wired-into:` line
from it — the call sites named there become the `path#symbol` (or inheritance/waiver)
forms on the corresponding tasks. Do not invent `Wired-into:` values ad hoc when a
`## Wiring Surface` section exists; transcribe/refine what it already states.

**Small-tier fallback:** Small-tier features skip architecture-review entirely (see
its Lightweight Mode section), so there is no `## Wiring Surface` section to derive
from. In that case `/plan` self-authors reasonable `Wired-into:` lines directly,
using the same four-form grammar above, based on its own knowledge of where the
task's surface will be called from.

### 5d. `Verify-only:` Marker

A task block MAY include a `**Verify-only:** yes` line to declare that the task is
expected to prove existing behavior already satisfies its acceptance criteria, rather
than land new code. The match is exact (case-insensitive) on the literal value `yes`;
any other value, or the line's absence, means the task is NOT verify-only.

Verify-only tasks preferably complete via an empty commit rather than a code commit:
carry a `Task: <id>` trailer and an `Evidence: skipped <reason>` trailer (see
`skills/tdd/SKILL.md`'s "Commit-less Completions: Evidence Trailers" section for the
exact commit form and the sibling `Evidence: satisfied-by <sha>` form). Do not force a
throwaway code change onto a task just to produce a corroborating commit when the task's
own acceptance criteria are already met.

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

### 8a. Advisory Overlap Scan

Before the plan is committed, run `conduct-ts overlap-scan --files <comma-separated
Files set>` over the union of every task's `**Files:**` paths (add `--source-ref
<issue ref>` when the feature's originating issue/intake ref is known). Surface the
rendered report to the author as-is.

This check is **advisory only — it never blocks plan authoring.** Unmerged overlap
is a heads-up for sequencing/coordination, not a precondition; proceed to save the
plan regardless of what the scan reports.

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
- [ ] Every task that touches new production-surface files carries a `**Wired-into:**`
      line (declared call site(s), `same as Task N`, or a `none (...)` form) — BLOCKS
      the plan's own verification if missing
- [ ] Plan saved to `.docs/plans/`
- [ ] Coverage mapping presented to user
